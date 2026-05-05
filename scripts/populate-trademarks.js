/**
 * One-off script to populate missing trademark (ARTTRDMRK) metafields on
 * Shopify variants from Monitor ExtraFields.
 *
 * What it does:
 *   1. Fetches all ARTTRDMRK entries from Monitor
 *   2. Fetches all Shopify variants with their monitor_id and current trademark
 *   3. For variants missing trademark: sets custom.trademark via metafieldsSet
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-trademarks.js
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-trademarks.js --apply
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-trademarks.js --apply --limit 50
 *
 * Required env vars (from Railway or .env):
 *   ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN
 *   MONITOR_URL, MONITOR_USER, MONITOR_PASS, MONITOR_COMPANY
 */

import "dotenv/config";

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
const DELAY_MS = 500; // ms between Shopify writes

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
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": sessionId,
      },
    });
    if (!res.ok) {
      // Retry once with fresh session
      console.log(`\n  Monitor returned ${res.status} at skip=${skip}, re-logging in...`);
      sessionId = await monitorLogin();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Monitor-SessionId": sessionId,
        },
      });
      if (!res.ok) throw new Error(`Monitor ExtraFields fetch failed at skip=${skip}: ${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < top) break;
    skip += top;
    process.stdout.write(`  Monitor: ${all.length} ARTTRDMRK entries fetched...\r`);
  }
  console.log(`  Monitor: ${all.length} ARTTRDMRK entries fetched    `);
  return all;
}

// ── Shopify ──────────────────────────────────────────────────────────

async function fetchAllShopifyVariants() {
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
            displayName
            metafield_monitor: metafield(namespace: "custom", key: "monitor_id") { value }
            metafield_trademark: metafield(namespace: "custom", key: "trademark") { value }
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
        displayName: e.node.displayName || "",
        monitorId: e.node.metafield_monitor?.value || null,
        trademark: e.node.metafield_trademark?.value || null,
      });
    }
    process.stdout.write(`  Shopify: ${all.length} variants fetched...\r`);
    if (!json.data?.productVariants?.pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
  console.log(`  Shopify: ${all.length} variants fetched    `);
  return all;
}

async function setTrademarkMetafield(variantId, value) {
  const mutation = `mutation {
    metafieldsSet(metafields: [{
      ownerId: "${variantId}"
      namespace: "custom"
      key: "trademark"
      value: "${value.replace(/"/g, '\\"')}"
      type: "single_line_text_field"
    }]) {
      metafields { id }
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
  const errors = json.data?.metafieldsSet?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Populate Trademarks ${DRY_RUN ? "(DRY RUN)" : "(APPLY MODE)"} ===\n`);
  if (DRY_RUN) {
    console.log("  ℹ️  Dry run — no changes will be made. Use --apply to write.\n");
  }

  // 1. Monitor trademarks
  console.log("Logging in to Monitor...");
  const sessionId = await monitorLogin();
  const monitorTrademarks = await fetchAllTrademarks(sessionId);

  // Build map: ParentId → trademark value
  const trademarkMap = new Map();
  for (const ef of monitorTrademarks) {
    const value = ef.SelectedOption?.Description || ef.StringValue || null;
    if (value) {
      trademarkMap.set(ef.ParentId, value);
    }
  }
  console.log(`  ${trademarkMap.size} products with trademark value in Monitor\n`);

  // 2. Shopify variants
  const shopifyVariants = await fetchAllShopifyVariants();

  // 3. Find variants that need updating
  const toUpdate = [];
  for (const sv of shopifyVariants) {
    if (!sv.monitorId) continue;
    const trademarkValue = trademarkMap.get(sv.monitorId);
    if (trademarkValue && sv.trademark !== trademarkValue) {
      toUpdate.push({ ...sv, newTrademark: trademarkValue });
    }
  }

  console.log(`\n  Variants to update: ${toUpdate.length}`);
  if (LIMIT < Infinity) console.log(`  Limit: ${LIMIT}`);

  // Group by trademark for summary
  const summary = {};
  for (const u of toUpdate) {
    summary[u.newTrademark] = (summary[u.newTrademark] || 0) + 1;
  }
  console.log("  Breakdown:");
  for (const [val, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(5)}  ${val}`);
  }
  console.log();

  // 4. Apply updates
  const limited = toUpdate.slice(0, LIMIT);
  let success = 0;
  let failed = 0;

  for (let i = 0; i < limited.length; i++) {
    const item = limited[i];
    const progress = `[${i + 1}/${limited.length}]`;

    if (DRY_RUN) {
      console.log(`  ${progress} Would set "${item.newTrademark}" on ${item.displayName} (${item.id})`);
    } else {
      try {
        await setTrademarkMetafield(item.id, item.newTrademark);
        success++;
        console.log(`  ${progress} ✅ Set "${item.newTrademark}" on ${item.displayName}`);
        await sleep(DELAY_MS);
      } catch (err) {
        failed++;
        console.error(`  ${progress} ❌ Failed: ${item.displayName} — ${err.message}`);
      }
    }
  }

  if (!DRY_RUN) {
    console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
  } else {
    console.log(`\nDry run complete. ${limited.length} variants would be updated.`);
    console.log("Run with --apply to write changes.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
