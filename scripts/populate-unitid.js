/**
 * One-off script to populate missing unitid metafields on Shopify variants.
 *
 * Background: The sync job started writing unitid on 27 Jan. Variants synced
 * before that date still lack the field. The batch pricing endpoint needs
 * unitId to fetch prices — without it, variants show "Fråga oss" even when a
 * price exists in Monitor.
 *
 * What it does:
 *   1. Fetches all products from Shopify (paginated via GraphQL)
 *   2. For each variant that has a monitor_id but no unitid → fetches
 *      StandardUnitId from Monitor and writes it back to Shopify.
 *   3. Runs sequentially with a small delay to avoid hammering APIs.
 *
 * Usage:
 *   node scripts/populate-unitid.js              # dry-run (no writes)
 *   node scripts/populate-unitid.js --apply      # actually write metafields
 *
 * Required env vars (reads from .env):
 *   ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN
 *   MONITOR_URL, MONITOR_USER, MONITOR_PASS, MONITOR_COMPANY
 */

import "dotenv/config";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });

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
const DELAY_MS = 1000; // ms between Monitor API calls (~30 min for 1700 variants)

// ── Monitor session ──────────────────────────────────────────────

let monitorSession = null;

async function monitorLogin() {
  const res = await fetch(`${MONITOR_URL}/${MONITOR_COMPANY}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Username: MONITOR_USER, Password: MONITOR_PASS, ForceRelogin: true }),
    agent,
  });
  monitorSession = res.headers.get("x-monitor-sessionid");
  if (!monitorSession) throw new Error("Monitor login failed – no session ID");
  console.log("Monitor login OK");
}

async function fetchStandardUnitId(monitorId) {
  if (!monitorSession) await monitorLogin();

  // Same URL pattern as monitor.js fetchPartStandardUnitId (filter + select)
  const url = `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Inventory/Parts?$filter=Id eq '${monitorId}'&$select=StandardUnitId`;
  let res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Monitor-SessionId": monitorSession,
    },
    agent,
  });

  if (res.status === 401) {
    await monitorLogin();
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": monitorSession,
      },
      agent,
    });
  }

  if (res.status !== 200) return null;
  const data = await res.json();
  // API returns an array — same parsing as monitor.js
  return (Array.isArray(data) && data.length > 0) ? data[0].StandardUnitId?.toString() || null : null;
}

// ── Shopify helpers ──────────────────────────────────────────────

async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function getAllVariants() {
  const variants = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      productVariants(first: 100${afterClause}) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            displayName
            product { title }
            metafield_monitor_id: metafield(namespace: "custom", key: "monitor_id") { value }
            metafield_unitid: metafield(namespace: "custom", key: "unitid") { value }
          }
        }
      }
    }`;

    const result = await shopifyGraphQL(query);
    const data = result.data?.productVariants;
    if (!data) {
      console.error("Unexpected Shopify response:", JSON.stringify(result).slice(0, 500));
      break;
    }

    for (const edge of data.edges) {
      variants.push({
        gid: edge.node.id,
        name: edge.node.displayName || edge.node.product?.title || "?",
        monitorId: edge.node.metafield_monitor_id?.value || null,
        unitId: edge.node.metafield_unitid?.value || null,
      });
    }

    console.log(`  Page ${page}: ${data.edges.length} variants (total ${variants.length})`);

    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  return variants;
}

async function writeUnitId(variantGid, unitId) {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    metafields: [{
      ownerId: variantGid,
      namespace: "custom",
      key: "unitid",
      type: "single_line_text_field",
      value: unitId,
    }],
  };

  const result = await shopifyGraphQL(mutation, variables);
  const errors = result.data?.metafieldsSet?.userErrors;
  if (errors?.length) {
    console.error(`  Write error for ${variantGid}:`, errors);
    return false;
  }
  return true;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Populate missing unitid metafields ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (add --apply to write)" : "APPLY (writing to Shopify)"}`);
  console.log(`Shop: ${SHOPIFY_DOMAIN}`);
  console.log(`Monitor: ${MONITOR_URL}/${MONITOR_COMPANY}\n`);

  // 1. Fetch all variants
  console.log("Fetching all variants from Shopify...");
  const allVariants = await getAllVariants();
  console.log(`\nTotal variants: ${allVariants.length}`);

  // 2. Find variants with monitor_id but no unitid
  const missing = allVariants.filter(v => v.monitorId && !v.unitId);
  const hasUnitId = allVariants.filter(v => v.monitorId && v.unitId);
  const noMonitorId = allVariants.filter(v => !v.monitorId);

  console.log(`  With unitid:      ${hasUnitId.length}`);
  console.log(`  Missing unitid:   ${missing.length}`);
  console.log(`  No monitor_id:    ${noMonitorId.length}\n`);

  if (missing.length === 0) {
    console.log("Nothing to do — all variants with monitor_id already have unitid.");
    return;
  }

  if (DRY_RUN) {
    console.log("Dry run complete — run with --apply to populate missing unitids.");
    return;
  }

  // 3. Fetch and write unitId for each
  const toProcess = missing.slice(0, LIMIT);
  if (LIMIT < Infinity) {
    console.log(`Limiting to first ${toProcess.length} variants (--limit ${LIMIT})\n`);
  }

  await monitorLogin();

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const v = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    const unitId = await fetchStandardUnitId(v.monitorId);
    if (!unitId) {
      console.log(`${progress} ${v.name} (${v.monitorId}) — no StandardUnitId in Monitor, skipping`);
      skipped++;
      continue;
    }

    const ok = await writeUnitId(v.gid, unitId);
    if (ok) {
      console.log(`${progress} ${v.name} (${v.monitorId}) → unitId=${unitId} ✓`);
      updated++;
    } else {
      console.log(`${progress} ${v.name} (${v.monitorId}) → WRITE FAILED`);
      failed++;
    }

    // Small delay to avoid hammering APIs
    if (i < toProcess.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped} (no StandardUnitId in Monitor)`);
  console.log(`  Failed:   ${failed}`);
  if (DRY_RUN) console.log(`\n  (Dry run — run with --apply to write changes)`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
