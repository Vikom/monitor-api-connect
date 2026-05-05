/**
 * Read-only diagnostic: compare ARTTRDMRK (trademark) in Monitor vs Shopify.
 *
 * Reports:
 *   1. Monitor: how many products have ARTTRDMRK extra field
 *   2. Shopify: how many variants have custom.trademark metafield
 *   3. Comparison: which are missing in Shopify
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/diagnose-trademarks.js
 */

import "dotenv/config";

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;
const MONITOR_URL = process.env.MONITOR_URL;
const MONITOR_USER = process.env.MONITOR_USER;
const MONITOR_PASS = process.env.MONITOR_PASS;
const MONITOR_COMPANY = process.env.MONITOR_COMPANY;

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

async function fetchMonitorTrademarksViaExtraFields(sessionId) {
  // Query ExtraFields directly for all ARTTRDMRK entries
  const all = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const url =
      `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Common/ExtraFields` +
      `?$filter=Identifier eq 'ARTTRDMRK'` +
      `&$expand=SelectedOption` +
      `&$top=${top}&$skip=${skip}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": sessionId,
      },
    });
    if (!res.ok) throw new Error(`Monitor ExtraFields fetch failed at skip=${skip}: ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < top) break;
    skip += top;
    process.stdout.write(`  Monitor ARTTRDMRK: ${all.length} fetched...\r`);
  }
  return all;
}

// ── Shopify ──────────────────────────────────────────────────────────

async function fetchShopifyVariantsWithTrademark() {
  const all = [];
  let cursor = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      productVariants(first: 250${afterClause}) {
        edges {
          cursor
          node {
            id
            sku
            displayName
            product { id title }
            metafield(namespace: "custom", key: "trademark") {
              value
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
      console.error("Shopify GraphQL error:", JSON.stringify(json.errors));
      break;
    }
    const edges = json.data?.productVariants?.edges || [];
    for (const e of edges) {
      all.push({
        id: e.node.id,
        sku: e.node.sku || "",
        displayName: e.node.displayName || "",
        productTitle: e.node.product?.title || "",
        trademark: e.node.metafield?.value || null,
      });
    }
    process.stdout.write(`  Shopify variants: ${all.length} fetched...\r`);
    if (!json.data?.productVariants?.pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
  return all;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Trademark (ARTTRDMRK) Diagnostics (read-only) ===\n");

  // 1. Monitor
  console.log("Logging in to Monitor...");
  const sessionId = await monitorLogin();

  console.log("Fetching ARTTRDMRK extra fields from Monitor...");
  const monitorTradmarks = await fetchMonitorTrademarksViaExtraFields(sessionId);
  console.log(`\n  Total ARTTRDMRK entries in Monitor: ${monitorTradmarks.length}`);

  // Build map: ParentId → trademark value
  const monitorMap = new Map();
  for (const ef of monitorTradmarks) {
    const value = ef.SelectedOption?.Description || ef.StringValue || null;
    if (value) {
      monitorMap.set(ef.ParentId, value);
    }
  }
  console.log(`  With actual value (not empty): ${monitorMap.size}`);

  // Count unique values
  const valueCounts = {};
  for (const v of monitorMap.values()) {
    valueCounts[v] = (valueCounts[v] || 0) + 1;
  }
  console.log(`  Unique trademark values: ${Object.keys(valueCounts).length}`);
  const sorted = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]);
  console.log("  Top 15:");
  for (const [val, count] of sorted.slice(0, 15)) {
    console.log(`    ${String(count).padStart(5)}  ${val}`);
  }
  console.log();

  // 2. Shopify
  console.log("Fetching Shopify variants...");
  const shopifyVariants = await fetchShopifyVariantsWithTrademark();
  console.log(`\n  Total Shopify variants: ${shopifyVariants.length}`);

  const withTrademark = shopifyVariants.filter((v) => v.trademark);
  const withoutTrademark = shopifyVariants.filter((v) => !v.trademark);
  console.log(`  With trademark metafield: ${withTrademark.length}`);
  console.log(`  Without trademark metafield: ${withoutTrademark.length}`);

  // Count Shopify trademark values
  const shopifyValueCounts = {};
  for (const v of withTrademark) {
    shopifyValueCounts[v.trademark] = (shopifyValueCounts[v.trademark] || 0) + 1;
  }
  const shopifySorted = Object.entries(shopifyValueCounts).sort((a, b) => b[1] - a[1]);
  if (shopifySorted.length > 0) {
    console.log(`  Unique trademark values: ${shopifySorted.length}`);
    console.log("  Top 15:");
    for (const [val, count] of shopifySorted.slice(0, 15)) {
      console.log(`    ${String(count).padStart(5)}  ${val}`);
    }
  }
  console.log();

  // 3. Summary
  console.log("════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  Monitor products with ARTTRDMRK:   ${monitorMap.size}`);
  console.log(`  Shopify variants with trademark:    ${withTrademark.length}`);
  console.log(`  Shopify variants without trademark: ${withoutTrademark.length}`);
  console.log(`  Gap (rough):                        ${monitorMap.size - withTrademark.length}`);
  console.log();
  console.log("  Note: Monitor count is per Part (product), Shopify count is per variant.");
  console.log("  A product with 5 variants = 1 in Monitor, 5 in Shopify.");
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
