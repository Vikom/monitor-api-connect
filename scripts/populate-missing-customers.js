/**
 * One-off script to create missing customers in Shopify from Monitor.
 *
 * Compares all WEB-ACCOUNT references in Monitor against Shopify customers
 * and creates only those that are missing. Skips blocked customers and
 * customers with empty/whitespace-only email.
 *
 * ONLY creates new customers — never updates existing ones.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-missing-customers.js
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-missing-customers.js --apply
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/populate-missing-customers.js --apply --limit 10
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
const DELAY_MS = 500; // ms between Shopify API calls
const LOG_FILE = `scripts/customer-sync-log-${new Date().toISOString().slice(0, 10)}.json`;

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

async function fetchAllMonitorCustomers(sessionIdIn) {
  let sessionId = sessionIdIn;
  const all = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const url =
      `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Sales/Customers` +
      `?$top=${top}&$skip=${skip}&$expand=References,ActiveDeliveryAddress`;
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": sessionId,
      },
    });
    if (!res.ok) {
      console.log(`\n  Monitor returned ${res.status} at skip=${skip}, re-logging in...`);
      sessionId = await monitorLogin();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Monitor-SessionId": sessionId,
        },
      });
      if (!res.ok) throw new Error(`Monitor fetch failed at skip=${skip}: ${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < top) break;
    skip += top;
    process.stdout.write(`  Monitor: ${all.length} customers fetched...\r`);
  }
  console.log(`  Monitor: ${all.length} customers fetched    `);
  return all;
}

function extractWebAccountRefs(monitorCustomers) {
  const refs = [];
  for (const c of monitorCustomers) {
    // Skip blocked customers (BlockedStatus === 2)
    if (c.BlockedStatus === 2) continue;

    if (!c.References) continue;
    for (const ref of c.References) {
      if (!ref.Category?.includes("WEB-ACCOUNT")) continue;
      const rawEmail = ref.EmailAddress || "";
      const email = parseEmail(rawEmail).toLowerCase();
      if (!email) continue;

      // Parse name
      const fullName = (ref.Name || "").trim();
      const nameParts = fullName.split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      // Address from ActiveDeliveryAddress
      const addr = c.ActiveDeliveryAddress;

      refs.push({
        monitorId: c.Id,
        code: c.Code,
        email,
        emailOriginal: parseEmail(rawEmail),
        firstName,
        lastName,
        phone: ref.CellPhoneNumber || ref.PhoneNumber || "",
        company: c.Name || "",
        discountCategory: c.DiscountCategoryId?.toString() || "",
        priceListId: c.PriceListId?.toString() || "",
        address1: addr?.Field1 || "",
        postalCode: addr?.PostalCode || "",
        city: addr?.Locality || "",
        refId: ref.Id,
      });
    }
  }
  return refs;
}

// ── Shopify ──────────────────────────────────────────────────────────

async function fetchAllShopifyCustomers() {
  const emails = new Set();
  const monitorIds = new Set();
  let cursor = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      customers(first: 250${afterClause}) {
        edges {
          cursor
          node {
            email
            metafield(namespace: "custom", key: "monitor_id") { value }
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
    const edges = json.data?.customers?.edges || [];
    for (const e of edges) {
      if (e.node.email) emails.add(e.node.email.trim().toLowerCase());
      if (e.node.metafield?.value) monitorIds.add(e.node.metafield.value);
    }
    process.stdout.write(`  Shopify: ${emails.size} customers fetched...\r`);
    if (!json.data?.customers?.pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
  console.log(`  Shopify: ${emails.size} emails, ${monitorIds.size} monitor_ids fetched    `);
  return { emails, monitorIds };
}

async function createCustomerInShopify(customer) {
  const mutation = `mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        email
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const metafields = [
    { namespace: "custom", key: "monitor_id", value: customer.monitorId.toString(), type: "single_line_text_field" },
    { namespace: "custom", key: "discount_category", value: customer.discountCategory || "", type: "single_line_text_field" },
    { namespace: "custom", key: "pricelist_id", value: customer.priceListId || "", type: "single_line_text_field" },
    { namespace: "custom", key: "company", value: customer.company || "", type: "single_line_text_field" },
  ];

  const input = {
    email: customer.emailOriginal.trim(),
    firstName: customer.firstName || "",
    lastName: customer.lastName || "",
    phone: customer.phone || undefined,
    note: `Monitor Customer ID: ${customer.monitorId}, Reference ID: ${customer.refId}`,
    metafields,
  };

  // Add address if we have any address data
  if (customer.address1 || customer.postalCode || customer.city) {
    input.addresses = [{
      address1: customer.address1 || "",
      zip: customer.postalCode || "",
      city: customer.city || "",
      company: customer.company || "",
    }];
  }

  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query: mutation, variables: { input } }),
    }
  );

  const json = await res.json();
  const errors = json.data?.customerCreate?.userErrors || [];
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => `${e.field}: ${e.message}`).join("; ") };
  }
  const created = json.data?.customerCreate?.customer;
  if (!created) {
    return { ok: false, error: json.errors ? JSON.stringify(json.errors) : "Unknown error" };
  }
  return { ok: true, id: created.id, email: created.email };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse email that might be in "name <email>" format.
 * Returns just the email address.
 */
function parseEmail(raw) {
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  return raw.trim();
}

import { writeFileSync } from "fs";

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Populate Missing Customers ${DRY_RUN ? "(DRY RUN)" : "(APPLY MODE)"} ===\n`);
  if (DRY_RUN) {
    console.log("  ℹ️  Dry run — no changes will be made. Use --apply to write.\n");
  }

  // 1. Fetch all Monitor customers with WEB-ACCOUNT refs
  console.log("Logging in to Monitor...");
  const sessionId = await monitorLogin();
  const monitorCustomers = await fetchAllMonitorCustomers(sessionId);
  const monitorRefs = extractWebAccountRefs(monitorCustomers);
  console.log(`  Valid WEB-ACCOUNT refs (not blocked, has email): ${monitorRefs.length}`);

  // Check for whitespace emails
  const whitespaceEmails = monitorRefs.filter(
    (r) => r.emailOriginal !== r.emailOriginal.trim()
  );
  if (whitespaceEmails.length > 0) {
    console.log(`\n  ⚠️  ${whitespaceEmails.length} emails with whitespace found in Monitor:`);
    for (const w of whitespaceEmails) {
      console.log(`     ${w.code} "${w.emailOriginal}" → should be "${w.emailOriginal.trim()}"`);
    }
    console.log(`\n  These should be fixed in Monitor first.`);
    console.log(`  The script will use trimmed versions, but fix the source to avoid future issues.\n`);
  }

  // 2. Fetch all Shopify customer emails + monitor_ids
  console.log("Fetching Shopify customers...");
  const { emails: shopifyEmails, monitorIds: shopifyMonitorIds } = await fetchAllShopifyCustomers();

  // 3. Find missing customers (in Monitor but not in Shopify)
  // Match on BOTH email AND monitor_id — if either matches, customer exists
  // This handles cases where a customer changed their email in Shopify
  const seen = new Set();
  const missing = [];
  let skippedByMonitorId = 0;
  for (const ref of monitorRefs) {
    if (shopifyEmails.has(ref.email)) continue;
    if (shopifyMonitorIds.has(ref.monitorId)) {
      skippedByMonitorId++;
      continue;
    }
    if (seen.has(ref.email)) continue;
    seen.add(ref.email);
    missing.push(ref);
  }

  if (skippedByMonitorId > 0) {
    console.log(`  ℹ️  ${skippedByMonitorId} refs matched by monitor_id (email changed in Shopify)`);
  }

  console.log(`\n  Missing customers to create: ${missing.length}`);
  if (LIMIT < Infinity) console.log(`  Limit: ${LIMIT}`);
  console.log();

  if (missing.length === 0) {
    console.log("  All customers are already in Shopify. Nothing to do.");
    return;
  }

  // Show sample
  console.log("  Sample of first 10:");
  for (const m of missing.slice(0, 10)) {
    console.log(`    ${m.code}  ${m.company.substring(0, 35).padEnd(36)} ${m.email}`);
  }
  if (missing.length > 10) console.log(`    ... and ${missing.length - 10} more`);
  console.log();

  // 4. Create missing customers
  const limited = missing.slice(0, LIMIT);
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];
  const log = []; // Full log of every action for rollback/audit

  for (let i = 0; i < limited.length; i++) {
    const c = limited[i];
    const progress = `[${i + 1}/${limited.length}]`;

    if (DRY_RUN) {
      console.log(`  ${progress} Would create: ${c.email} (${c.company}) — monitor_id: ${c.monitorId}, pricelist: ${c.priceListId}`);
    } else {
      try {
        const result = await createCustomerInShopify(c);
        if (result.ok) {
          created++;
          console.log(`  ${progress} ✅ Created: ${c.email} (${c.company}) → ${result.id}`);
          log.push({
            action: "created",
            shopifyId: result.id,
            email: c.email,
            monitorId: c.monitorId,
            code: c.code,
            company: c.company,
            priceListId: c.priceListId,
            discountCategory: c.discountCategory,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Check if it's a "taken" error (customer was created between our check and now)
          if (result.error.includes("taken") || result.error.includes("has already been taken")) {
            skipped++;
            console.log(`  ${progress} ⏭️  Already exists: ${c.email} — ${result.error}`);
            log.push({ action: "skipped", email: c.email, monitorId: c.monitorId, reason: result.error });
          } else {
            failed++;
            failures.push({ email: c.email, error: result.error });
            console.error(`  ${progress} ❌ Failed: ${c.email} — ${result.error}`);
            log.push({ action: "failed", email: c.email, monitorId: c.monitorId, error: result.error });
          }
        }
        await sleep(DELAY_MS);
      } catch (err) {
        failed++;
        failures.push({ email: c.email, error: err.message });
        console.error(`  ${progress} ❌ Error: ${c.email} — ${err.message}`);
        log.push({ action: "error", email: c.email, monitorId: c.monitorId, error: err.message });
      }
    }
  }

  // Write log file (only in apply mode)
  if (!DRY_RUN && log.length > 0) {
    writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    console.log(`\n  📄 Full log written to: ${LOG_FILE}`);
  }

  // Summary
  console.log("\n════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
  if (DRY_RUN) {
    console.log(`  Would create: ${limited.length} customers`);
    console.log("  Run with --apply to create them.");
  } else {
    console.log(`  Created:  ${created}`);
    console.log(`  Skipped:  ${skipped} (already existed)`);
    console.log(`  Failed:   ${failed}`);
    if (failures.length > 0) {
      console.log("\n  Failed customers:");
      for (const f of failures) {
        console.log(`    ${f.email} — ${f.error}`);
      }
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
