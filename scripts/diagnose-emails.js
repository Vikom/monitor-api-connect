/**
 * Read-only diagnostic: find email addresses with whitespace or other issues
 * in both Monitor (WEB-ACCOUNT refs) and Shopify.
 *
 * Reports:
 *   1. Monitor emails with leading/trailing whitespace (fix in Monitor)
 *   2. Shopify customers whose email has whitespace (already mis-synced)
 *   3. Cross-check: whitespace emails from Monitor that exist in Shopify
 *
 * Usage:
 *   node scripts/diagnose-emails.js
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

// ── Monitor helpers ──────────────────────────────────────────────────

async function monitorLogin() {
  const url = `${MONITOR_URL}/${MONITOR_COMPANY}/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Username: MONITOR_USER, Password: MONITOR_PASS, ForceRelogin: true }),
  });
  if (!res.ok) throw new Error(`Monitor login failed: ${res.status}`);
  const sessionId = res.headers.get("x-monitor-sessionid");
  if (!sessionId) throw new Error("Monitor login: no session ID in response header");
  return sessionId;
}

async function fetchAllMonitorCustomers(sessionId) {
  const all = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const url =
      `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Sales/Customers` +
      `?$top=${top}&$skip=${skip}&$expand=References`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    if (!res.ok) throw new Error(`Monitor fetch failed at skip=${skip}: ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < top) break;
    skip += top;
  }
  return all;
}

// ── Shopify helpers ──────────────────────────────────────────────────

async function fetchAllShopifyCustomers() {
  const all = [];
  let cursor = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      customers(first: 250${afterClause}) {
        edges {
          cursor
          node {
            id
            email
            metafields(first: 5, namespace: "custom") {
              edges {
                node { key value }
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
    const edges = json.data?.customers?.edges || [];
    for (const e of edges) {
      const mf = {};
      for (const m of e.node.metafields?.edges || []) {
        mf[m.node.key] = m.node.value;
      }
      all.push({
        id: e.node.id,
        email: e.node.email || "",
        monitorId: mf.monitor_id || "",
      });
    }
    if (!json.data?.customers?.pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }
  return all;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Email Diagnostics (read-only) ===\n");

  // 1. Monitor
  console.log("Logging in to Monitor...");
  const sessionId = await monitorLogin();
  console.log("Fetching all Monitor customers...");
  const monitorCustomers = await fetchAllMonitorCustomers(sessionId);
  console.log(`  Total Monitor customers: ${monitorCustomers.length}`);

  // Extract WEB-ACCOUNT refs with email issues
  const monitorIssues = []; // { code, name, email, trimmed, refName }
  const monitorAllRefs = []; // all valid refs for cross-check

  for (const c of monitorCustomers) {
    if (!c.References) continue;
    for (const ref of c.References) {
      if (!ref.Category?.includes("WEB-ACCOUNT")) continue;
      const email = ref.EmailAddress || "";
      if (!email) continue;

      monitorAllRefs.push({
        code: c.Code,
        name: c.Name,
        email,
        trimmed: email.trim().toLowerCase(),
      });

      if (email !== email.trim()) {
        monitorIssues.push({
          code: c.Code,
          name: c.Name,
          email,
          trimmed: email.trim(),
          refName: ref.Name || "",
          issue: "whitespace",
        });
      }
    }
  }

  console.log(`  WEB-ACCOUNT refs with email: ${monitorAllRefs.length}`);
  console.log(`  Emails with whitespace: ${monitorIssues.length}\n`);

  // 2. Shopify
  console.log("Fetching all Shopify customers...");
  const shopifyCustomers = await fetchAllShopifyCustomers();
  console.log(`  Total Shopify customers: ${shopifyCustomers.length}`);

  const shopifyIssues = [];
  for (const sc of shopifyCustomers) {
    if (sc.email && sc.email !== sc.email.trim()) {
      shopifyIssues.push(sc);
    }
  }
  console.log(`  Shopify emails with whitespace: ${shopifyIssues.length}\n`);

  // 3. Cross-check: whitespace Monitor emails that exist in Shopify (with whitespace intact)
  const shopifyEmailSet = new Set(shopifyCustomers.map((c) => c.email.toLowerCase()));
  const shopifyTrimmedSet = new Set(shopifyCustomers.map((c) => c.email.trim().toLowerCase()));

  const misSynced = []; // whitespace email from Monitor found as-is in Shopify
  const wouldCollide = []; // trimmed version already exists under different entry

  for (const mi of monitorIssues) {
    const rawLower = mi.email.toLowerCase();
    const trimLower = mi.trimmed.toLowerCase();

    if (shopifyEmailSet.has(rawLower)) {
      misSynced.push(mi);
    }
    if (shopifyTrimmedSet.has(trimLower) && !shopifyEmailSet.has(rawLower)) {
      wouldCollide.push(mi);
    }
  }

  // ── Report ───────────────────────────────────────────────────────

  console.log("════════════════════════════════════════════════════════");
  console.log("  MONITOR: Emails with whitespace to fix");
  console.log("════════════════════════════════════════════════════════");
  if (monitorIssues.length === 0) {
    console.log("  (none)\n");
  } else {
    console.log(`  ${"Kundnr".padEnd(10)} ${"Kundnamn".padEnd(35)} ${"Kontakt".padEnd(20)} E-post (visas med quotes)`);
    console.log(`  ${"─".repeat(10)} ${"─".repeat(35)} ${"─".repeat(20)} ${"─".repeat(40)}`);
    for (const mi of monitorIssues) {
      console.log(
        `  ${String(mi.code).padEnd(10)} ${mi.name.substring(0, 34).padEnd(35)} ${mi.refName.substring(0, 19).padEnd(20)} "${mi.email}" → "${mi.trimmed}"`
      );
    }
    console.log();
  }

  console.log("════════════════════════════════════════════════════════");
  console.log("  SHOPIFY: Customers with whitespace in email");
  console.log("════════════════════════════════════════════════════════");
  if (shopifyIssues.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const si of shopifyIssues) {
      console.log(`  ID: ${si.id}  Monitor: ${si.monitorId}  Email: "${si.email}"`);
    }
    console.log();
  }

  console.log("════════════════════════════════════════════════════════");
  console.log("  CROSS-CHECK: Whitespace emails synced to Shopify as-is");
  console.log("════════════════════════════════════════════════════════");
  if (misSynced.length === 0) {
    console.log("  (none — whitespace emails were NOT synced to Shopify)\n");
  } else {
    for (const ms of misSynced) {
      console.log(`  ${ms.code} ${ms.name} — "${ms.email}" exists in Shopify with whitespace`);
    }
    console.log();
  }

  console.log("════════════════════════════════════════════════════════");
  console.log("  COLLISION CHECK: Trimmed version already in Shopify");
  console.log("════════════════════════════════════════════════════════");
  if (wouldCollide.length === 0) {
    console.log("  (none — safe to trim, no duplicates would be created)\n");
  } else {
    for (const wc of wouldCollide) {
      console.log(`  ${wc.code} ${wc.name} — "${wc.email}" trimmed → "${wc.trimmed}" already exists in Shopify`);
    }
    console.log(`\n  ⚠ These ${wouldCollide.length} would cause duplicates if trimmed in Monitor and re-synced!\n`);
  }

  // Summary
  console.log("════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  Monitor whitespace emails:        ${monitorIssues.length}`);
  console.log(`  Shopify whitespace emails:         ${shopifyIssues.length}`);
  console.log(`  Already mis-synced to Shopify:     ${misSynced.length}`);
  console.log(`  Would collide after trim:          ${wouldCollide.length}`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
