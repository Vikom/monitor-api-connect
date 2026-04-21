import { json } from "@remix-run/node";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });
const ADMIN_KEY = process.env.CUSTOMER_LOOKUP_API_KEY;

const monitorUrl = process.env.MONITOR_URL;
const monitorCompany = process.env.MONITOR_COMPANY;

let _monitorClient = null;
async function getMonitorClient() {
  if (!_monitorClient) {
    const { MonitorClient } = await import("../utils/monitor.server.js");
    _monitorClient = new MonitorClient();
  }
  return _monitorClient;
}

async function fetchTrademark(productMonitorId) {
  const client = await getMonitorClient();
  let session = await client.getSessionId();

  const url = `${monitorUrl}/${monitorCompany}/api/v1/Common/ExtraFields?$filter=ParentId eq '${productMonitorId}' and Identifier eq 'ARTTRDMRK'&$expand=SelectedOption`;

  let res = await fetch(url, {
    headers: { Accept: "application/json", "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Monitor-SessionId": session },
    agent,
  });

  if (res.status === 401) {
    await client.login();
    session = await client.getSessionId();
    res = await fetch(url, {
      headers: { Accept: "application/json", "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Monitor-SessionId": session },
      agent,
    });
  }

  if (res.status !== 200) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  // Try SelectedOption.Description first, then StringValue
  return data[0].SelectedOption?.Description || data[0].StringValue || null;
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const limit = parseInt(url.searchParams.get("limit") || "0", 10);
  const apply = url.searchParams.get("apply") === "1";

  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // Debug mode: list all ExtraField identifiers for a specific product
  const debugMonitorId = url.searchParams.get("debug");
  if (debugMonitorId) {
    try {
      const client = await getMonitorClient();
      let session = await client.getSessionId();
      const efUrl = `${monitorUrl}/${monitorCompany}/api/v1/Common/ExtraFields?$filter=ParentId eq '${debugMonitorId}'&$expand=SelectedOption`;
      let res = await fetch(efUrl, {
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Monitor-SessionId": session },
        agent,
      });
      if (res.status === 401) {
        await client.login();
        session = await client.getSessionId();
        res = await fetch(efUrl, {
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Monitor-SessionId": session },
          agent,
        });
      }
      const data = await res.json();
      const fields = Array.isArray(data) ? data.map(f => ({
        identifier: f.Identifier,
        stringValue: f.StringValue,
        decimalValue: f.DecimalValue,
        selectedOption: f.SelectedOption?.Description || null,
      })) : [];
      return json({ debug: true, monitorId: debugMonitorId, fields });
    } catch (err) {
      return json({ error: err.message }, { status: 500 });
    }
  }

  try {
    const shop = process.env.ADVANCED_STORE_DOMAIN;
    const token = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    // 1. Fetch all variants from Shopify
    const variants = [];
    let cursor = null;

    while (true) {
      const afterClause = cursor ? `, after: "${cursor}"` : "";
      const query = `{
        productVariants(first: 100${afterClause}) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              displayName
              metafield_monitor_id: metafield(namespace: "custom", key: "monitor_id") { value }
              metafield_trademark: metafield(namespace: "custom", key: "trademark") { value }
            }
          }
        }
      }`;

      const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query }),
      });
      const result = await res.json();
      const data = result.data?.productVariants;
      if (!data) break;

      for (const edge of data.edges) {
        variants.push({
          gid: edge.node.id,
          name: edge.node.displayName || "?",
          monitorId: edge.node.metafield_monitor_id?.value || null,
          trademark: edge.node.metafield_trademark?.value || null,
        });
      }
      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }

    const missing = variants.filter(v => v.monitorId && !v.trademark);
    const summary = {
      total: variants.length,
      withTrademark: variants.filter(v => v.trademark).length,
      missingTrademark: missing.length,
      noMonitorId: variants.filter(v => !v.monitorId).length,
    };

    if (!apply) {
      return json({
        mode: "dry-run",
        summary,
        missing: limit > 0 ? missing.slice(0, limit).map(v => ({ name: v.name, monitorId: v.monitorId })) : undefined,
        hint: "Add &apply=1 to write. Add &limit=N to limit.",
      });
    }

    // 2. Process missing variants
    const toProcess = limit > 0 ? missing.slice(0, limit) : missing;
    const results = [];

    for (const v of toProcess) {
      const trademark = await fetchTrademark(v.monitorId);
      if (!trademark) {
        results.push({ name: v.name, monitorId: v.monitorId, status: "skipped", reason: "no ARTTRDMRK in Monitor" });
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      // Write to Shopify
      const mutation = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value }
          userErrors { field message }
        }
      }`;
      const writeRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({
          query: mutation,
          variables: {
            metafields: [{
              ownerId: v.gid,
              namespace: "custom",
              key: "trademark",
              type: "single_line_text_field",
              value: trademark,
            }],
          },
        }),
      });
      const writeResult = await writeRes.json();
      const errors = writeResult.data?.metafieldsSet?.userErrors;

      if (errors?.length) {
        results.push({ name: v.name, monitorId: v.monitorId, status: "failed", errors });
      } else {
        results.push({ name: v.name, monitorId: v.monitorId, status: "updated", trademark });
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return json({
      mode: "apply",
      summary,
      processed: toProcess.length,
      results,
    });

  } catch (error) {
    console.error("[populate-trademark] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
