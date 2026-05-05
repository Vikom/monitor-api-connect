/**
 * One-off script to change NOT_SUBSCRIBED customers to SUBSCRIBED.
 * Does NOT touch UNSUBSCRIBED customers (they actively opted out).
 *
 * Only changes emailMarketingConsent — no other customer data is modified.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/subscribe-not-subscribed.js
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/subscribe-not-subscribed.js --apply --limit 5
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/subscribe-not-subscribed.js --apply
 *
 * Required env vars (from Railway or .env):
 *   ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN
 */

import "dotenv/config";
import { writeFileSync } from "fs";

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;

const DRY_RUN = !process.argv.includes("--apply");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();
const DELAY_MS = 300;
const LOG_FILE = `scripts/subscribe-log-${new Date().toISOString().slice(0, 10)}.json`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetch all NOT_SUBSCRIBED customers ───────────────────────────────

async function fetchNotSubscribed() {
  const customers = [];
  let cursor = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      customers(first: 250${afterClause}, query: "email_subscription_status:not_subscribed") {
        edges {
          cursor
          node {
            id
            email
            emailMarketingConsent {
              marketingState
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
    const edges = json.data?.customers?.edges || [];
    for (const e of edges) {
      const state = e.node.emailMarketingConsent?.marketingState;
      if (state === "NOT_SUBSCRIBED") {
        customers.push({ id: e.node.id, email: e.node.email || "" });
      }
    }
    process.stdout.write(`  Fetched ${customers.length} NOT_SUBSCRIBED customers...\r`);
    if (!json.data?.customers?.pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
  console.log(`  Fetched ${customers.length} NOT_SUBSCRIBED customers    `);
  return customers;
}

// ── Update subscription status ───────────────────────────────────────

async function subscribeCustomer(customerId) {
  const mutation = `mutation {
    customerEmailMarketingConsentUpdate(input: {
      customerId: "${customerId}"
      emailMarketingConsent: {
        marketingState: SUBSCRIBED
        marketingOptInLevel: SINGLE_OPT_IN
        consentUpdatedAt: "${new Date().toISOString()}"
      }
    }) {
      customer { id }
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
  const errors = json.data?.customerEmailMarketingConsentUpdate?.userErrors || [];
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Subscribe NOT_SUBSCRIBED Customers ${DRY_RUN ? "(DRY RUN)" : "(APPLY MODE)"} ===\n`);
  if (DRY_RUN) {
    console.log("  ℹ️  Dry run — no changes will be made. Use --apply to write.\n");
  }

  const customers = await fetchNotSubscribed();

  if (customers.length === 0) {
    console.log("  No NOT_SUBSCRIBED customers found. Nothing to do.");
    return;
  }

  const limited = customers.slice(0, LIMIT);
  console.log(`\n  To update: ${limited.length}${LIMIT < Infinity ? " (limited from " + customers.length + ")" : ""}\n`);

  let success = 0;
  let failed = 0;
  const log = [];

  for (let i = 0; i < limited.length; i++) {
    const c = limited[i];
    const progress = `[${i + 1}/${limited.length}]`;

    if (DRY_RUN) {
      console.log(`  ${progress} Would subscribe: ${c.email} (${c.id})`);
    } else {
      try {
        const result = await subscribeCustomer(c.id);
        if (result.ok) {
          success++;
          console.log(`  ${progress} ✅ Subscribed: ${c.email}`);
          log.push({
            action: "subscribed",
            shopifyId: c.id,
            email: c.email,
            previousState: "NOT_SUBSCRIBED",
            timestamp: new Date().toISOString(),
          });
        } else {
          failed++;
          console.error(`  ${progress} ❌ Failed: ${c.email} — ${result.error}`);
          log.push({ action: "failed", shopifyId: c.id, email: c.email, error: result.error });
        }
        await sleep(DELAY_MS);
      } catch (err) {
        failed++;
        console.error(`  ${progress} ❌ Error: ${c.email} — ${err.message}`);
        log.push({ action: "error", shopifyId: c.id, email: c.email, error: err.message });
      }
    }
  }

  // Write log
  if (!DRY_RUN && log.length > 0) {
    writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    console.log(`\n  📄 Log written to: ${LOG_FILE}`);
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
  if (DRY_RUN) {
    console.log(`  Would subscribe: ${limited.length} customers`);
    console.log("  Run with --apply to change them.");
  } else {
    console.log(`  Subscribed: ${success}`);
    console.log(`  Failed:     ${failed}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
