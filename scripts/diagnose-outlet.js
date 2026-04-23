/**
 * Diagnose outlet metafield mismatches.
 *
 * Finds variants with custom.outlet=true in Shopify and checks
 * their current ProductGroupId in Monitor to see if they should
 * still be outlet.
 *
 * Requires Monitor access — run via railway run.
 *
 * Usage:
 *   railway run node scripts/diagnose-outlet.js
 */

import "dotenv/config";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });
const OUTLET_GROUP_ID = "1229581166640460381";

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;
const MONITOR_URL = process.env.MONITOR_URL;
const MONITOR_COMPANY = process.env.MONITOR_COMPANY;
const MONITOR_USER = process.env.MONITOR_USER;
const MONITOR_PASS = process.env.MONITOR_PASS;

let monitorSession = null;

async function monitorLogin() {
  const res = await fetch(`${MONITOR_URL}/${MONITOR_COMPANY}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Username: MONITOR_USER, Password: MONITOR_PASS, ForceRelogin: true }),
    agent,
  });
  monitorSession = res.headers.get("x-monitor-sessionid");
  if (!monitorSession) throw new Error("Monitor login failed");
}

async function checkMonitorProductGroup(monitorId) {
  if (!monitorSession) await monitorLogin();

  const url = `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Inventory/Parts?$filter=Id eq '${monitorId}'&$select=Id,PartNumber,ProductGroupId,Status&$expand=ProductGroup`;
  let res = await fetch(url, {
    headers: { Accept: "application/json", "X-Monitor-SessionId": monitorSession },
    agent,
  });

  if (res.status === 401) {
    await monitorLogin();
    res = await fetch(url, {
      headers: { Accept: "application/json", "X-Monitor-SessionId": monitorSession },
      agent,
    });
  }

  if (res.status !== 200) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    partNumber: data[0].PartNumber,
    productGroupId: data[0].ProductGroupId,
    productGroupName: data[0].ProductGroup?.Description || "unknown",
    status: data[0].Status,
    isOutletInMonitor: data[0].ProductGroupId === OUTLET_GROUP_ID,
  };
}

async function shopifyGraphQL(query) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_TOKEN },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

async function main() {
  console.log(`\n=== Outlet Metafield Diagnostic ===`);
  console.log(`Shop: ${SHOPIFY_DOMAIN}`);
  console.log(`Monitor: ${MONITOR_URL}/${MONITOR_COMPANY}\n`);

  // 1. Find all variants with outlet=true in Shopify
  console.log("Fetching variants with outlet=true from Shopify...");
  const outletVariants = [];
  let cursor = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const result = await shopifyGraphQL(`{
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
    }`);

    const data = result.data?.productVariants;
    if (!data) break;

    for (const edge of data.edges) {
      const n = edge.node;
      if (n.metafield_outlet?.value === "true") {
        const collections = n.product.collections.edges.map(e => e.node.handle);
        const inOutletCollection = collections.some(h => h === 'outlet' || h.startsWith('outlet-'));
        outletVariants.push({
          sku: n.sku,
          name: n.displayName,
          monitorId: n.metafield_monitor_id?.value,
          inOutletCollection,
          collections: collections.filter(h => h === 'outlet' || h.startsWith('outlet-')),
        });
      }
    }

    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  console.log(`Found ${outletVariants.length} variants with outlet=true in Shopify\n`);

  // 2. Check each against Monitor
  console.log("Checking against Monitor...\n");
  await monitorLogin();

  const correct = [];
  const mismatch = [];
  const notFound = [];
  const noMonitorId = [];

  for (let i = 0; i < outletVariants.length; i++) {
    const v = outletVariants[i];
    if (!v.monitorId) {
      noMonitorId.push(v);
      continue;
    }

    const monitor = await checkMonitorProductGroup(v.monitorId);
    if (!monitor) {
      notFound.push(v);
      continue;
    }

    if (monitor.isOutletInMonitor) {
      correct.push({ ...v, monitor });
    } else {
      mismatch.push({ ...v, monitor });
    }

    // Small delay
    if (i < outletVariants.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 3. Report
  console.log(`\n=== Results ===`);
  console.log(`  Correct (outlet in both):     ${correct.length}`);
  console.log(`  MISMATCH (outlet in Shopify, NOT in Monitor): ${mismatch.length}`);
  console.log(`  Not found in Monitor:         ${notFound.length}`);
  console.log(`  No monitor_id:                ${noMonitorId.length}`);

  if (mismatch.length > 0) {
    console.log(`\n--- MISMATCHES (should NOT be outlet) ---`);
    for (const m of mismatch) {
      console.log(`  ${m.sku} | ${m.name}`);
      console.log(`    Monitor: ProductGroup="${m.monitor.productGroupName}" Status=${m.monitor.status}`);
      console.log(`    In outlet collection: ${m.inOutletCollection ? 'YES' : 'NO'}`);
    }
  }

  if (notFound.length > 0) {
    console.log(`\n--- NOT FOUND IN MONITOR ---`);
    for (const n of notFound) {
      console.log(`  ${n.sku} | ${n.name} (monitorId: ${n.monitorId})`);
    }
  }

  console.log(`\n=== Done ===`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
