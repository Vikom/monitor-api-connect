/**
 * One-off script to set product vendor based on ARTTRDMRK (trademark) from Monitor.
 *
 * What it does:
 *   1. Fetches all ARTTRDMRK entries from Monitor (ParentId → trademark value)
 *   2. Fetches all Shopify products with their variants' monitor_id
 *   3. For products where a variant matches an ARTTRDMRK entry and vendor differs:
 *      updates product vendor via productUpdate
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-vendor.js
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-vendor.js --apply --limit 5
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-vendor.js --apply
 *
 * Required env vars (from Railway or .env):
 *   ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN
 *   MONITOR_URL, MONITOR_USER, MONITOR_PASS, MONITOR_COMPANY
 */

import "dotenv/config";
import { writeFileSync } from "fs";

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;
const MONITOR_URL = process.env.MONITOR_URL;
const MONITOR_USER = process.env.MONITOR_USER;
const MONITOR_PASS = process.env.MONITOR_PASS;
const MONITOR_COMPANY = process.env.MONITOR_COMPANY;

const DRY_RUN = !process.argv.includes("--apply");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();
const DELAY_MS = 500;
const LOG_FILE = `scripts/vendor-log-${new Date().toISOString().slice(0, 10)}.json`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Monitor ──────────────────────────────────────────────────────────

async function monitorLogin() {
  const res = await fetch(`${MONITOR_URL}/${MONITOR_COMPANY}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Username: MONITOR_USER, Password: MONITOR_PASS, ForceRelogin: true }),
  });
  if (!res.ok) throw new Error(`Monitor login failed: ${res.status}`);
  const sessionId = res.headers.get("x-monitor-sessionid");
  if (!sessionId) throw new Error("No session ID in response");
  return sessionId;
}

async function fetchAllTrademarks(sessionIdIn) {
  let sessionId = sessionIdIn;
  const all = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const url =
      `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Common/ExtraFields` +
      `?$filter=Identifier eq 'ARTTRDMRK'` +
      `&$expand=SelectedOption` +
      `&$top=${top}&$skip=${skip}`;
    let res = await fetch(url, {
      headers: { Accept: "application/json", "X-Monitor-SessionId": sessionId },
    });
    if (!res.ok) {
      console.log(`\n  Monitor returned ${res.status} at skip=${skip}, re-logging in...`);
      sessionId = await monitorLogin();
      res = await fetch(url, {
        headers: { Accept: "application/json", "X-Monitor-SessionId": sessionId },
      });
      if (!res.ok) throw new Error(`Monitor fetch failed at skip=${skip}: ${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < top) break;
    skip += top;
    process.stdout.write(`  Monitor: ${all.length} ARTTRDMRK entries...\r`);
  }
  console.log(`  Monitor: ${all.length} ARTTRDMRK entries    `);
  return all;
}

// ── Shopify ──────────────────────────────────────────────────────────

async function fetchAllProducts() {
  const products = [];
  let cursor = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      products(first: 100${afterClause}) {
        edges {
          cursor
          node {
            id
            title
            vendor
            variants(first: 100) {
              edges {
                node {
                  metafield(namespace: "custom", key: "monitor_id") { value }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;

    const res = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        },
        body: JSON.stringify({ query }),
      }
    );
    const json = await res.json();
    if (json.errors) {
      console.error("Shopify error:", JSON.stringify(json.errors));
      break;
    }
    const edges = json.data?.products?.edges || [];
    for (const e of edges) {
      const monitorIds = e.node.variants.edges
        .map((v) => v.node.metafield?.value)
        .filter(Boolean);
      products.push({
        id: e.node.id,
        title: e.node.title,
        vendor: e.node.vendor,
        monitorIds,
      });
    }
    process.stdout.write(`  Shopify: ${products.length} products...\r`);
    if (!json.data?.products?.pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
  console.log(`  Shopify: ${products.length} products    `);
  return products;
}

async function updateProductVendor(productId, vendor) {
  const mutation = `mutation {
    productUpdate(input: {
      id: "${productId}"
      vendor: "${vendor.replace(/"/g, '\\"')}"
    }) {
      product { id vendor }
      userErrors { field message }
    }
  }`;

  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query: mutation }),
    }
  );
  const json = await res.json();
  const errors = json.data?.productUpdate?.userErrors || [];
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Populate Vendor from ARTTRDMRK ${DRY_RUN ? "(DRY RUN)" : "(APPLY MODE)"} ===\n`);
  if (DRY_RUN) {
    console.log("  ℹ️  Dry run — no changes will be made. Use --apply to write.\n");
  }

  // 1. Monitor trademarks
  console.log("Logging in to Monitor...");
  const sessionId = await monitorLogin();
  const monitorTrademarks = await fetchAllTrademarks(sessionId);

  const trademarkMap = new Map();
  for (const ef of monitorTrademarks) {
    const value = ef.SelectedOption?.Description || ef.StringValue || null;
    if (value) {
      trademarkMap.set(ef.ParentId, value);
    }
  }
  console.log(`  ${trademarkMap.size} products with trademark in Monitor\n`);

  // 2. Shopify products
  console.log("Fetching Shopify products...");
  const products = await fetchAllProducts();

  // 3. Find products that need vendor update
  const toUpdate = [];
  for (const p of products) {
    // Find trademark for this product via any of its variants' monitor_ids
    let trademark = null;
    for (const mid of p.monitorIds) {
      if (trademarkMap.has(mid)) {
        trademark = trademarkMap.get(mid);
        break;
      }
    }
    if (trademark && p.vendor !== trademark) {
      toUpdate.push({ ...p, newVendor: trademark });
    }
  }

  console.log(`\n  Products to update: ${toUpdate.length}`);
  if (LIMIT < Infinity) console.log(`  Limit: ${LIMIT}`);

  // Breakdown
  const summary = {};
  for (const u of toUpdate) {
    const key = `${u.vendor} → ${u.newVendor}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  console.log("  Breakdown:");
  for (const [change, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(5)}  ${change}`);
  }
  console.log();

  // 4. Apply
  const limited = toUpdate.slice(0, LIMIT);
  let success = 0;
  let failed = 0;
  const log = [];

  for (let i = 0; i < limited.length; i++) {
    const p = limited[i];
    const progress = `[${i + 1}/${limited.length}]`;

    if (DRY_RUN) {
      console.log(`  ${progress} Would set vendor "${p.newVendor}" on "${p.title}" (was "${p.vendor}")`);
    } else {
      try {
        const result = await updateProductVendor(p.id, p.newVendor);
        if (result.ok) {
          success++;
          console.log(`  ${progress} ✅ "${p.title}" — ${p.vendor} → ${p.newVendor}`);
          log.push({
            action: "updated",
            productId: p.id,
            title: p.title,
            previousVendor: p.vendor,
            newVendor: p.newVendor,
            timestamp: new Date().toISOString(),
          });
        } else {
          failed++;
          console.error(`  ${progress} ❌ "${p.title}" — ${result.error}`);
          log.push({ action: "failed", productId: p.id, title: p.title, error: result.error });
        }
        await sleep(DELAY_MS);
      } catch (err) {
        failed++;
        console.error(`  ${progress} ❌ "${p.title}" — ${err.message}`);
        log.push({ action: "error", productId: p.id, title: p.title, error: err.message });
      }
    }
  }

  if (!DRY_RUN && log.length > 0) {
    writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    console.log(`\n  📄 Log written to: ${LOG_FILE}`);
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
  if (DRY_RUN) {
    console.log(`  Would update: ${limited.length} products`);
    console.log("  Run with --apply to change them.");
  } else {
    console.log(`  Updated: ${success}`);
    console.log(`  Failed:  ${failed}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
