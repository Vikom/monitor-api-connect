/**
 * One-off script to create automated collections for each vendor/trademark.
 *
 * Creates a collection per brand with rule: "Product vendor is equal to X"
 * Skips collections that already exist (matched by handle).
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/create-vendor-collections.js
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 railway run -- node scripts/create-vendor-collections.js --apply
 *
 * Required env vars (from Railway or .env):
 *   ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN
 */

import "dotenv/config";

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;

const DRY_RUN = !process.argv.includes("--apply");

const VENDORS = [
  { title: "Kronospan", vendor: "Kronospan" },
  { title: "Formica", vendor: "Formica" },
  { title: "Lunawood", vendor: "Lunawood" },
  { title: "Valchromat", vendor: "Valchromat" },
  { title: "Egger", vendor: "Egger" },
  { title: "Cleaf", vendor: "Cleaf" },
  { title: "Finsa", vendor: "Finsa" },
  { title: "Viroc", vendor: "Viroc" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyGraphQL(query) {
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
  return res.json();
}

async function collectionExists(handle) {
  const json = await shopifyGraphQL(`{
    collectionByHandle(handle: "${handle}") {
      id
      title
    }
  }`);
  return json.data?.collectionByHandle || null;
}

async function createCollection(vendor) {
  const mutation = `mutation {
    collectionCreate(input: {
      title: "${vendor.title}"
      ruleSet: {
        appliedDisjunctively: false
        rules: [{
          column: VENDOR
          relation: EQUALS
          condition: "${vendor.vendor}"
        }]
      }
    }) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const json = await shopifyGraphQL(mutation);
  const errors = json.data?.collectionCreate?.userErrors || [];
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join("; ") };
  }
  const collection = json.data?.collectionCreate?.collection;
  if (!collection) {
    return { ok: false, error: json.errors ? JSON.stringify(json.errors) : "Unknown error" };
  }
  return { ok: true, id: collection.id, handle: collection.handle };
}

async function main() {
  console.log(`=== Create Vendor Collections ${DRY_RUN ? "(DRY RUN)" : "(APPLY MODE)"} ===\n`);
  if (DRY_RUN) {
    console.log("  ℹ️  Dry run — no changes will be made. Use --apply to write.\n");
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const vendor of VENDORS) {
    const handle = vendor.title.toLowerCase();
    const existing = await collectionExists(handle);

    if (existing) {
      console.log(`  ⏭️  "${vendor.title}" already exists (${existing.id})`);
      skipped++;
    } else if (DRY_RUN) {
      console.log(`  Would create: "${vendor.title}" (rule: vendor = "${vendor.vendor}")`);
    } else {
      const result = await createCollection(vendor);
      if (result.ok) {
        console.log(`  ✅ Created: "${vendor.title}" → /collections/${result.handle} (${result.id})`);
        created++;
      } else {
        console.error(`  ❌ Failed: "${vendor.title}" — ${result.error}`);
        failed++;
      }
      await sleep(500);
    }
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
  if (DRY_RUN) {
    console.log(`  Would create: ${VENDORS.length - skipped}`);
    console.log(`  Already exist: ${skipped}`);
  } else {
    console.log(`  Created:  ${created}`);
    console.log(`  Skipped:  ${skipped} (already existed)`);
    console.log(`  Failed:   ${failed}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
