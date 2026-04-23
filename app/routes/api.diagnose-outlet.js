import { json } from "@remix-run/node";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });
const ADMIN_KEY = process.env.CUSTOMER_LOOKUP_API_KEY;
const monitorUrl = process.env.MONITOR_URL;
const monitorCompany = process.env.MONITOR_COMPANY;
const OUTLET_GROUP_ID = "1229581166640460381";

let _client = null;
async function getClient() {
  if (!_client) {
    const { MonitorClient } = await import("../utils/monitor.server.js");
    _client = new MonitorClient();
  }
  return _client;
}

async function checkProductGroup(monitorId) {
  const client = await getClient();
  let session = await client.getSessionId();

  const url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts?$filter=Id eq '${monitorId}'&$select=Id,PartNumber,ProductGroupId,Status&$expand=ProductGroup`;
  let res = await fetch(url, {
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Monitor-SessionId": session },
    agent,
  });

  if (res.status === 401) {
    await client.login();
    session = await client.getSessionId();
    res = await fetch(url, {
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Monitor-SessionId": session },
      agent,
    });
  }

  if (res.status !== 200) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return { notFound: true };

  return {
    partNumber: data[0].PartNumber,
    productGroupId: data[0].ProductGroupId,
    productGroupName: data[0].ProductGroup?.Description || "unknown",
    status: data[0].Status,
    isOutletInMonitor: data[0].ProductGroupId === OUTLET_GROUP_ID,
  };
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shop = process.env.ADVANCED_STORE_DOMAIN;
    const token = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    // 1. Fetch all variants with outlet=true from Shopify
    const outletVariants = [];
    let cursor = null;

    while (true) {
      const afterClause = cursor ? `, after: "${cursor}"` : "";
      const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({
          query: `{
            productVariants(first: 100${afterClause}) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id
                  sku
                  displayName
                  metafield_outlet: metafield(namespace: "custom", key: "outlet") { value }
                  metafield_monitor_id: metafield(namespace: "custom", key: "monitor_id") { value }
                  product {
                    title
                    collections(first: 15) {
                      edges { node { handle title } }
                    }
                  }
                }
              }
            }
          }`
        }),
      });
      const result = await res.json();
      const data = result.data?.productVariants;
      if (!data) break;

      for (const edge of data.edges) {
        const n = edge.node;
        if (n.metafield_outlet?.value === "true") {
          const collections = n.product.collections.edges.map(e => e.node.handle);
          outletVariants.push({
            sku: n.sku,
            name: n.displayName,
            monitorId: n.metafield_monitor_id?.value,
            inOutletCollection: collections.some(h => h === 'outlet' || h.startsWith('outlet-')),
          });
        }
      }

      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }

    // 2. Check each against Monitor
    const correct = [];
    const mismatch = [];
    const notFound = [];
    const noMonitorId = [];

    for (const v of outletVariants) {
      if (!v.monitorId) {
        noMonitorId.push(v);
        continue;
      }

      const monitor = await checkProductGroup(v.monitorId);
      if (!monitor || monitor.notFound) {
        notFound.push(v);
      } else if (monitor.isOutletInMonitor) {
        correct.push({ ...v, productGroup: monitor.productGroupName, status: monitor.status });
      } else {
        mismatch.push({ ...v, productGroup: monitor.productGroupName, status: monitor.status, partNumber: monitor.partNumber });
      }

      await new Promise(r => setTimeout(r, 200));
    }

    return json({
      summary: {
        totalOutletInShopify: outletVariants.length,
        correct: correct.length,
        mismatch: mismatch.length,
        notFoundInMonitor: notFound.length,
        noMonitorId: noMonitorId.length,
      },
      mismatches: mismatch,
      notFound,
      noMonitorId,
    });

  } catch (error) {
    console.error("[diagnose-outlet] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
