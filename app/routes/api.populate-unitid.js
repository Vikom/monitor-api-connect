import { json } from "@remix-run/node";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });

const ADMIN_KEY = process.env.CUSTOMER_LOOKUP_API_KEY; // reuse existing key for auth

export async function loader({ request }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const limit = parseInt(url.searchParams.get("limit") || "0", 10);
  const apply = url.searchParams.get("apply") === "1";

  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ error: "Unauthorized" }, { status: 401 });
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
              metafield_unitid: metafield(namespace: "custom", key: "unitid") { value }
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
          unitId: edge.node.metafield_unitid?.value || null,
        });
      }
      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }

    const missing = variants.filter(v => v.monitorId && !v.unitId);
    const summary = {
      total: variants.length,
      withUnitId: variants.filter(v => v.monitorId && v.unitId).length,
      missingUnitId: missing.length,
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
    const { MonitorClient } = await import("../utils/monitor.server.js");
    const client = new MonitorClient();
    const { fetchPartStandardUnitId } = await import("../utils/monitor.server.js");

    const toProcess = limit > 0 ? missing.slice(0, limit) : missing;
    const results = [];

    for (const v of toProcess) {
      const unitId = await fetchPartStandardUnitId(v.monitorId);
      if (!unitId) {
        results.push({ name: v.name, monitorId: v.monitorId, status: "skipped", reason: "no StandardUnitId in Monitor" });
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
              key: "unitid",
              type: "single_line_text_field",
              value: unitId,
            }],
          },
        }),
      });
      const writeResult = await writeRes.json();
      const errors = writeResult.data?.metafieldsSet?.userErrors;

      if (errors?.length) {
        results.push({ name: v.name, monitorId: v.monitorId, status: "failed", errors });
      } else {
        results.push({ name: v.name, monitorId: v.monitorId, status: "updated", unitId });
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }

    return json({
      mode: "apply",
      summary,
      processed: toProcess.length,
      results,
    });

  } catch (error) {
    console.error("[populate-unitid] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
