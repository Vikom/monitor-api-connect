/**
 * Batch-apply a collection template suffix to multiple collections.
 *
 * Runs directly against Shopify Admin API — no Monitor dependency,
 * no Railway needed. Can run locally.
 *
 * Usage:
 *   node scripts/apply-collection-template.js --suffix variants              # dry-run
 *   node scripts/apply-collection-template.js --suffix variants --apply      # write
 *   node scripts/apply-collection-template.js --suffix variants --apply --limit 5
 *   node scripts/apply-collection-template.js --suffix "" --apply            # reset to default template
 *
 * Options:
 *   --suffix <name>     Template suffix to apply (e.g. "variants" → collection.variants.json)
 *   --apply             Actually write changes (default: dry-run)
 *   --limit <n>         Only process first N collections
 *   --exclude <handles> Comma-separated collection handles to skip (e.g. "outlet,frontpage,all")
 *   --only <handles>    Comma-separated collection handles to include (skip all others)
 *
 * Required env vars (reads from .env):
 *   ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN
 */

import "dotenv/config";

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;

const DRY_RUN = !process.argv.includes("--apply");
const SUFFIX = (() => {
  const idx = process.argv.indexOf("--suffix");
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error("Error: --suffix <name> is required (e.g. --suffix variants)");
    process.exit(1);
  }
  return process.argv[idx + 1];
})();
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();
const EXCLUDE = (() => {
  const idx = process.argv.indexOf("--exclude");
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1].split(",") : [];
})();
const ONLY = (() => {
  const idx = process.argv.indexOf("--only");
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1].split(",") : [];
})();

const DELAY_MS = 200;

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

async function getAllCollections() {
  const collections = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      collections(first: 100${afterClause}) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            templateSuffix
            productsCount { count }
          }
        }
      }
    }`;

    const result = await shopifyGraphQL(query);
    const data = result.data?.collections;
    if (!data) {
      console.error("Unexpected Shopify response:", JSON.stringify(result).slice(0, 500));
      break;
    }

    for (const edge of data.edges) {
      collections.push({
        gid: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
        currentSuffix: edge.node.templateSuffix || "",
        productCount: edge.node.productsCount?.count || 0,
      });
    }

    console.log(`  Page ${page}: ${data.edges.length} collections (total ${collections.length})`);

    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  return collections;
}

async function updateTemplateSuffix(collectionGid, suffix) {
  const mutation = `
    mutation collectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id title templateSuffix }
        userErrors { field message }
      }
    }
  `;
  const result = await shopifyGraphQL(mutation, {
    input: {
      id: collectionGid,
      templateSuffix: suffix,
    },
  });
  const errors = result.data?.collectionUpdate?.userErrors;
  if (errors?.length) {
    console.error(`  Write error:`, errors);
    return false;
  }
  return true;
}

async function main() {
  console.log(`\n=== Apply collection template suffix ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (add --apply to write)" : "APPLY"}`);
  console.log(`Shop: ${SHOPIFY_DOMAIN}`);
  console.log(`Suffix: "${SUFFIX}" → template: collection.${SUFFIX || "default"}.json`);
  if (EXCLUDE.length) console.log(`Exclude: ${EXCLUDE.join(", ")}`);
  if (ONLY.length) console.log(`Only: ${ONLY.join(", ")}`);
  console.log();

  console.log("Fetching all collections...");
  const allCollections = await getAllCollections();
  console.log(`\nTotal collections: ${allCollections.length}\n`);

  // Filter collections
  let toProcess = allCollections.filter(c => {
    if (EXCLUDE.length && EXCLUDE.includes(c.handle)) return false;
    if (ONLY.length && !ONLY.includes(c.handle)) return false;
    return true;
  });

  // Skip collections already on the target suffix
  const alreadyCorrect = toProcess.filter(c => c.currentSuffix === SUFFIX);
  const needsUpdate = toProcess.filter(c => c.currentSuffix !== SUFFIX);

  console.log(`  Already on "${SUFFIX}": ${alreadyCorrect.length}`);
  console.log(`  Needs update:          ${needsUpdate.length}`);
  if (EXCLUDE.length || ONLY.length) {
    console.log(`  Filtered out:          ${allCollections.length - toProcess.length}`);
  }
  console.log();

  if (needsUpdate.length === 0) {
    console.log("Nothing to do — all matching collections already use this template.");
    return;
  }

  // Show what will be changed
  const limited = needsUpdate.slice(0, LIMIT);
  for (const c of limited) {
    const from = c.currentSuffix || "(default)";
    console.log(`  ${c.title} [${c.handle}] — "${from}" → "${SUFFIX}" (${c.productCount} products)`);
  }
  if (LIMIT < needsUpdate.length) {
    console.log(`  ... and ${needsUpdate.length - LIMIT} more (use --limit to control)`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("Dry run complete — run with --apply to write changes.");
    return;
  }

  // Apply changes
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < limited.length; i++) {
    const c = limited[i];
    const progress = `[${i + 1}/${limited.length}]`;

    const ok = await updateTemplateSuffix(c.gid, SUFFIX);
    if (ok) {
      console.log(`${progress} ${c.title} [${c.handle}] → "${SUFFIX}" ✓`);
      updated++;
    } else {
      console.log(`${progress} ${c.title} [${c.handle}] → FAILED`);
      failed++;
    }

    if (i < limited.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed:  ${failed}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
