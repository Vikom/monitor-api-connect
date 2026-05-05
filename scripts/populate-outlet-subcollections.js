/**
 * Populate outlet sub-collections based on existing product metafields.
 *
 * Reads monitor_part_code_id from products in the main outlet collection
 * and adds them to the correct sub-collection (skivor, byggmaterial, etc.)
 *
 * No Monitor access needed — all data is in Shopify.
 *
 * Usage:
 *   node scripts/populate-outlet-subcollections.js                  # dry-run
 *   node scripts/populate-outlet-subcollections.js --apply          # write
 *   node scripts/populate-outlet-subcollections.js --apply --limit 5
 */

import "dotenv/config";

// Use prod IDs (same as main branch outlet-collections.js)
const PART_CODE_TO_OUTLET_COLLECTION = {
  // 1xxx - Outlet skivor
  "998744361981740489": "gid://shopify/Collection/685232357710",
  "998744361981740491": "gid://shopify/Collection/685232357710",
  "998744361981740493": "gid://shopify/Collection/685232357710",
  "998744361981740495": "gid://shopify/Collection/685232357710",
  "998744361981740529": "gid://shopify/Collection/685232357710",
  "998744361981740531": "gid://shopify/Collection/685232357710",
  "998744361981740533": "gid://shopify/Collection/685232357710",
  "998744361981740535": "gid://shopify/Collection/685232357710",
  "998744361981740537": "gid://shopify/Collection/685232357710",
  "998744361981740539": "gid://shopify/Collection/685232357710",
  "1058494584519258320": "gid://shopify/Collection/685232357710",
  "998744361981740541": "gid://shopify/Collection/685232357710",
  "998744361981740543": "gid://shopify/Collection/685232357710",
  "998744361981740513": "gid://shopify/Collection/685232357710",
  "998744361981740515": "gid://shopify/Collection/685232357710",
  "998744361981740517": "gid://shopify/Collection/685232357710",
  "998744361981740519": "gid://shopify/Collection/685232357710",
  "998744361981740521": "gid://shopify/Collection/685232357710",
  "998744361981740523": "gid://shopify/Collection/685232357710",
  "998744361981740525": "gid://shopify/Collection/685232357710",
  "998744361981740527": "gid://shopify/Collection/685232357710",
  "998744361981740049": "gid://shopify/Collection/685232357710",
  "998744361981740051": "gid://shopify/Collection/685232357710",
  "998744361981740053": "gid://shopify/Collection/685232357710",
  "998744361981740055": "gid://shopify/Collection/685232357710",
  "998744361981740057": "gid://shopify/Collection/685232357710",
  "998744361981740059": "gid://shopify/Collection/685232357710",
  "998744361981740061": "gid://shopify/Collection/685232357710",
  "998744361981740063": "gid://shopify/Collection/685232357710",
  "998744361981740033": "gid://shopify/Collection/685232357710",
  "998744361981740035": "gid://shopify/Collection/685232357710",
  "998744361981740037": "gid://shopify/Collection/685232357710",
  "998744361981740039": "gid://shopify/Collection/685232357710",
  "998744361981740041": "gid://shopify/Collection/685232357710",
  "998744361981740043": "gid://shopify/Collection/685232357710",
  "998744361981740045": "gid://shopify/Collection/685232357710",
  "998744361981740047": "gid://shopify/Collection/685232357710",
  "998744361981740081": "gid://shopify/Collection/685232357710",
  "998744361981740083": "gid://shopify/Collection/685232357710",
  "998744361981740085": "gid://shopify/Collection/685232357710",
  "998744361981740087": "gid://shopify/Collection/685232357710",
  "998744361981740089": "gid://shopify/Collection/685232357710",
  "998744361981740091": "gid://shopify/Collection/685232357710",
  "998744361981740093": "gid://shopify/Collection/685232357710",
  "998744361981740095": "gid://shopify/Collection/685232357710",
  "998744361981740065": "gid://shopify/Collection/685232357710",
  "998744361981740067": "gid://shopify/Collection/685232357710",
  "998744361981740069": "gid://shopify/Collection/685232357710",
  "998744361981740071": "gid://shopify/Collection/685232357710",
  "998744361981740073": "gid://shopify/Collection/685232357710",
  "998744361981740075": "gid://shopify/Collection/685232357710",
  "998744361981740077": "gid://shopify/Collection/685232357710",
  "998744361981740079": "gid://shopify/Collection/685232357710",
  "998744361981740113": "gid://shopify/Collection/685232357710",
  "998744361981740115": "gid://shopify/Collection/685232357710",
  "1066066848136982158": "gid://shopify/Collection/685232357710",
  "998744361981740117": "gid://shopify/Collection/685232357710",
  "998744361981740119": "gid://shopify/Collection/685232357710",
  "998744361981740121": "gid://shopify/Collection/685232357710",
  "998744361981740123": "gid://shopify/Collection/685232357710",
  "998744361981740125": "gid://shopify/Collection/685232357710",
  "998744361981740127": "gid://shopify/Collection/685232357710",
  "998744361981740097": "gid://shopify/Collection/685232357710",
  "998744361981740099": "gid://shopify/Collection/685232357710",
  "998744361981740101": "gid://shopify/Collection/685232357710",
  "998744361981740103": "gid://shopify/Collection/685232357710",
  "998744361981740105": "gid://shopify/Collection/685232357710",
  "998744361981740107": "gid://shopify/Collection/685232357710",
  "998744361981740109": "gid://shopify/Collection/685232357710",
  "998744361981740111": "gid://shopify/Collection/685232357710",
  // 2xxx - Outlet byggmaterial
  "998744361981740145": "gid://shopify/Collection/685232390478",
  "998744361981740147": "gid://shopify/Collection/685232390478",
  "998744361981740149": "gid://shopify/Collection/685232390478",
  "998744361981740151": "gid://shopify/Collection/685232390478",
  "998744361981740153": "gid://shopify/Collection/685232390478",
  "998744361981740155": "gid://shopify/Collection/685232390478",
  "998744361981740157": "gid://shopify/Collection/685232390478",
  "998744361981740159": "gid://shopify/Collection/685232390478",
  "998744361981740129": "gid://shopify/Collection/685232390478",
  "998744361981740131": "gid://shopify/Collection/685232390478",
  "998744361981740133": "gid://shopify/Collection/685232390478",
  "998744361981740135": "gid://shopify/Collection/685232390478",
  "998744361981740137": "gid://shopify/Collection/685232390478",
  "998744361981740139": "gid://shopify/Collection/685232390478",
  "998744361981740141": "gid://shopify/Collection/685232390478",
  "998744361981740143": "gid://shopify/Collection/685232390478",
  "998744361981740177": "gid://shopify/Collection/685232390478",
  "998744361981740179": "gid://shopify/Collection/685232390478",
  "998744361981740181": "gid://shopify/Collection/685232390478",
  "998744361981740183": "gid://shopify/Collection/685232390478",
  "998744361981740185": "gid://shopify/Collection/685232390478",
  "998744361981740187": "gid://shopify/Collection/685232390478",
  "998744361981740189": "gid://shopify/Collection/685232390478",
  "998744361981740191": "gid://shopify/Collection/685232390478",
  "998744361981740161": "gid://shopify/Collection/685232390478",
  "998744361981740163": "gid://shopify/Collection/685232390478",
  "998744361981740165": "gid://shopify/Collection/685232390478",
  "1113038690552645442": "gid://shopify/Collection/685232390478",
  "1113039069583715935": "gid://shopify/Collection/685232390478",
  "1113039173736640788": "gid://shopify/Collection/685232390478",
  "998744361981740167": "gid://shopify/Collection/685232390478",
  "998744361981740169": "gid://shopify/Collection/685232390478",
  "998744361981740171": "gid://shopify/Collection/685232390478",
  "998744361981740173": "gid://shopify/Collection/685232390478",
  // 3xxx - Outlet trävaror
  "998744361981740175": "gid://shopify/Collection/685232456014",
  "998744361981740209": "gid://shopify/Collection/685232456014",
  "1058496860851955356": "gid://shopify/Collection/685232456014",
  "998744361981740211": "gid://shopify/Collection/685232456014",
  "998744361981740213": "gid://shopify/Collection/685232456014",
  "998744361981740215": "gid://shopify/Collection/685232456014",
  "998744361981740217": "gid://shopify/Collection/685232456014",
  "998744361981740223": "gid://shopify/Collection/685232456014",
  "998744361981740221": "gid://shopify/Collection/685232456014",
  "998744361981740219": "gid://shopify/Collection/685232456014",
  "998744361981740195": "gid://shopify/Collection/685232456014",
  "998744361981740193": "gid://shopify/Collection/685232456014",
  "998744361981740197": "gid://shopify/Collection/685232456014",
  "998744361981740199": "gid://shopify/Collection/685232456014",
  "998744361981740201": "gid://shopify/Collection/685232456014",
  "998744361981740203": "gid://shopify/Collection/685232456014",
  "1058496960709944986": "gid://shopify/Collection/685232456014",
  "998744361981740205": "gid://shopify/Collection/685232456014",
  "998744361981740207": "gid://shopify/Collection/685232456014",
  "998744361981740241": "gid://shopify/Collection/685232456014",
  "998744361981740243": "gid://shopify/Collection/685232456014",
  "998744361981740245": "gid://shopify/Collection/685232456014",
  "998744361981740247": "gid://shopify/Collection/685232456014",
  "998744361981740249": "gid://shopify/Collection/685232456014",
  "998744361981740251": "gid://shopify/Collection/685232456014",
  "998744361981740253": "gid://shopify/Collection/685232456014",
  "998744361981740255": "gid://shopify/Collection/685232456014",
  "998744361981740225": "gid://shopify/Collection/685232456014",
  "998744361981740227": "gid://shopify/Collection/685232456014",
  "998744361981740229": "gid://shopify/Collection/685232456014",
  "998744361981740231": "gid://shopify/Collection/685232456014",
  "998744361981740233": "gid://shopify/Collection/685232456014",
  "998744361981740235": "gid://shopify/Collection/685232456014",
  "998744361981740237": "gid://shopify/Collection/685232456014",
  "1094562653826506315": "gid://shopify/Collection/685232456014",
  "1094562853542464583": "gid://shopify/Collection/685232456014",
  "998744361981740239": "gid://shopify/Collection/685232456014",
  "998744361981740273": "gid://shopify/Collection/685232456014",
  "998744361981740275": "gid://shopify/Collection/685232456014",
  "998744361981740277": "gid://shopify/Collection/685232456014",
  "998744361981740279": "gid://shopify/Collection/685232456014",
  "998744361981740281": "gid://shopify/Collection/685232456014",
  "998744361981740283": "gid://shopify/Collection/685232456014",
  "998744361981740287": "gid://shopify/Collection/685232456014",
  "998744361981740257": "gid://shopify/Collection/685232456014",
  "998744361981740259": "gid://shopify/Collection/685232456014",
  "998744361981740261": "gid://shopify/Collection/685232456014",
  "998744361981740263": "gid://shopify/Collection/685232456014",
  "998744361981740265": "gid://shopify/Collection/685232456014",
  "998744361981740267": "gid://shopify/Collection/685232456014",
  "998744361981740285": "gid://shopify/Collection/685232456014",
  "998744361981740269": "gid://shopify/Collection/685232456014",
  "998744361981740271": "gid://shopify/Collection/685232456014",
  "998744361981739793": "gid://shopify/Collection/685232456014",
  "998744361981739795": "gid://shopify/Collection/685232456014",
  "998744361981739797": "gid://shopify/Collection/685232456014",
  "998744361981739799": "gid://shopify/Collection/685232456014",
  "998744361981739801": "gid://shopify/Collection/685232456014",
  "998744361981739803": "gid://shopify/Collection/685232456014",
  "998744361981739805": "gid://shopify/Collection/685232456014",
  "998744361981739807": "gid://shopify/Collection/685232456014",
  "998744361981739777": "gid://shopify/Collection/685232456014",
  "1058497335445842814": "gid://shopify/Collection/685232456014",
  "1190261949622277225": "gid://shopify/Collection/685232456014",
  "998744361981739779": "gid://shopify/Collection/685232456014",
  "998744361981739781": "gid://shopify/Collection/685232456014",
  "998744361981739783": "gid://shopify/Collection/685232456014",
  "998744361981739785": "gid://shopify/Collection/685232456014",
  "998744361981739787": "gid://shopify/Collection/685232456014",
  "998744361981739789": "gid://shopify/Collection/685232456014",
  "998744361981739791": "gid://shopify/Collection/685232456014",
  "998744361981739825": "gid://shopify/Collection/685232456014",
  "998744361981739827": "gid://shopify/Collection/685232456014",
  "998744361981739829": "gid://shopify/Collection/685232456014",
  "998744361981739831": "gid://shopify/Collection/685232456014",
  "998744361981739833": "gid://shopify/Collection/685232456014",
  "998744361981739835": "gid://shopify/Collection/685232456014",
  "998744361981739837": "gid://shopify/Collection/685232456014",
  "998744361981739839": "gid://shopify/Collection/685232456014",
  "998744361981739809": "gid://shopify/Collection/685232456014",
  "998744361981739811": "gid://shopify/Collection/685232456014",
  "998744361981739813": "gid://shopify/Collection/685232456014",
  "998744361981739815": "gid://shopify/Collection/685232456014",
  "998744361981739817": "gid://shopify/Collection/685232456014",
  "998744361981739819": "gid://shopify/Collection/685232456014",
  "998744361981739821": "gid://shopify/Collection/685232456014",
  "998744361981739823": "gid://shopify/Collection/685232456014",
  "998744361981739857": "gid://shopify/Collection/685232456014",
  "998744361981739859": "gid://shopify/Collection/685232456014",
  // 4xxx - Outlet interiör (excl 46xx)
  "998744361981739861": "gid://shopify/Collection/685232619854",
  "998744361981739863": "gid://shopify/Collection/685232619854",
  "998744361981739865": "gid://shopify/Collection/685232619854",
  "998744361981739867": "gid://shopify/Collection/685232619854",
  "1066073233679606439": "gid://shopify/Collection/685232619854",
  "998744361981739869": "gid://shopify/Collection/685232619854",
  "998744361981739871": "gid://shopify/Collection/685232619854",
  "998744361981739841": "gid://shopify/Collection/685232619854",
  "998744361981739843": "gid://shopify/Collection/685232619854",
  "998744361981739845": "gid://shopify/Collection/685232619854",
  "998744361981739847": "gid://shopify/Collection/685232619854",
  "998744361981739849": "gid://shopify/Collection/685232619854",
  "998744361981739851": "gid://shopify/Collection/685232619854",
  "998744361981739853": "gid://shopify/Collection/685232619854",
  "998744361981739855": "gid://shopify/Collection/685232619854",
  "998744361981739889": "gid://shopify/Collection/685232619854",
  "998744361981739891": "gid://shopify/Collection/685232619854",
  "998744361981739893": "gid://shopify/Collection/685232619854",
  "998744361981739895": "gid://shopify/Collection/685232619854",
  "998744361981739897": "gid://shopify/Collection/685232619854",
  "998744361981739899": "gid://shopify/Collection/685232619854",
  "1147216148191365492": "gid://shopify/Collection/685232619854",
  "1147216234090698959": "gid://shopify/Collection/685232619854",
  "998744361981739901": "gid://shopify/Collection/685232619854",
  "998744361981739903": "gid://shopify/Collection/685232619854",
  "998744361981739873": "gid://shopify/Collection/685232619854",
  "1147216278114107517": "gid://shopify/Collection/685232619854",
  "1067877468551669756": "gid://shopify/Collection/685232619854",
  "998744361981739875": "gid://shopify/Collection/685232619854",
  "998744361981739877": "gid://shopify/Collection/685232619854",
  "998744361981739879": "gid://shopify/Collection/685232619854",
  "998744361981739881": "gid://shopify/Collection/685232619854",
  "1147216328579976392": "gid://shopify/Collection/685232619854",
  "1147216460650544086": "gid://shopify/Collection/685232619854",
  "1147216530443755021": "gid://shopify/Collection/685232619854",
  "1147216624933054864": "gid://shopify/Collection/685232619854",
  "1147216736602253326": "gid://shopify/Collection/685232619854",
  "1147216779551916330": "gid://shopify/Collection/685232619854",
  "1147216816059141062": "gid://shopify/Collection/685232619854",
  "998744361981739883": "gid://shopify/Collection/685232619854",
  "998744361981739885": "gid://shopify/Collection/685232619854",
  "998744361981739887": "gid://shopify/Collection/685232619854",
  "998744361981739921": "gid://shopify/Collection/685232619854",
  "998744361981739923": "gid://shopify/Collection/685232619854",
  "998744361981739925": "gid://shopify/Collection/685232619854",
  "998744361981739927": "gid://shopify/Collection/685232619854",
  // 46xx - Outlet kakel & klinker
  "1110138870900252268": "gid://shopify/Collection/685232652622",
  "1110138954652117376": "gid://shopify/Collection/685232652622",
  "1110139039477697825": "gid://shopify/Collection/685232652622",
  "1110139243488638725": "gid://shopify/Collection/685232652622",
  "1110139363747694482": "gid://shopify/Collection/685232652622",
  "1110139475416963195": "gid://shopify/Collection/685232652622",
  "1110139539841478696": "gid://shopify/Collection/685232652622",
  "1110139752442358784": "gid://shopify/Collection/685232652622",
  "1110140308640420751": "gid://shopify/Collection/685232652622",
  // 4xxx cont
  "1232881747615246810": "gid://shopify/Collection/685232619854",
  "1232881769090088728": "gid://shopify/Collection/685232619854",
  "1232881771237570899": "gid://shopify/Collection/685232619854",
  "1232881773385054553": "gid://shopify/Collection/685232619854",
  "1232881776606280055": "gid://shopify/Collection/685232619854",
  "1232881779827505383": "gid://shopify/Collection/685232619854",
  "1232881781974989033": "gid://shopify/Collection/685232619854",
  "1232881785196214509": "gid://shopify/Collection/685232619854",
  "1232881787343698161": "gid://shopify/Collection/685232619854",
  "1281142481819118099": "gid://shopify/Collection/685232619854",
  "998744361981739929": "gid://shopify/Collection/685232619854",
};

const OUTLET_NAMES = {
  "gid://shopify/Collection/685232357710": "Outlet skivor",
  "gid://shopify/Collection/685232390478": "Outlet byggmaterial",
  "gid://shopify/Collection/685232456014": "Outlet trävaror",
  "gid://shopify/Collection/685232619854": "Outlet interiör",
  "gid://shopify/Collection/685232652622": "Outlet kakel & klinker",
};

const SHOPIFY_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;
const OUTLET_COLLECTION_HANDLE = "outlet";

const DRY_RUN = !process.argv.includes("--apply");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();
const DELAY_MS = 300;

async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function getOutletProducts() {
  // First find the outlet collection GID
  const findRes = await shopifyGraphQL(`{
    collectionByHandle(handle: "${OUTLET_COLLECTION_HANDLE}") { id title }
  }`);
  const collectionGid = findRes.data?.collectionByHandle?.id;
  if (!collectionGid) throw new Error("Outlet collection not found");
  console.log(`Found outlet collection: ${collectionGid}`);

  // Fetch all products in the outlet collection
  const products = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const result = await shopifyGraphQL(`{
      collection(id: "${collectionGid}") {
        products(first: 50${afterClause}) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              partCodeMetafield: metafield(namespace: "custom", key: "monitor_part_code_id") { value }
            }
          }
        }
      }
    }`);

    const data = result.data?.collection?.products;
    if (!data) break;

    for (const edge of data.edges) {
      products.push({
        gid: edge.node.id,
        title: edge.node.title,
        partCodeId: edge.node.partCodeMetafield?.value || null,
      });
    }

    console.log(`  Page ${page}: ${data.edges.length} products (total ${products.length})`);
    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  return products;
}

async function addProductToCollection(productGid, collectionGid) {
  const result = await shopifyGraphQL(`
    mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
      collectionAddProducts(id: $id, productIds: $productIds) {
        userErrors { field message }
      }
    }
  `, { id: collectionGid, productIds: [productGid] });

  const errors = result.data?.collectionAddProducts?.userErrors;
  if (errors?.length) {
    console.error(`  Error adding to collection:`, errors);
    return false;
  }
  return true;
}

async function main() {
  console.log(`\n=== Populate outlet sub-collections ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (add --apply to write)" : "APPLY"}`);
  console.log(`Shop: ${SHOPIFY_DOMAIN}\n`);

  console.log("Fetching products from outlet collection...");
  const products = await getOutletProducts();
  console.log(`\nTotal outlet products: ${products.length}`);

  // Map products to sub-collections
  const mappable = [];
  const noPartCode = [];
  const noMapping = [];

  for (const p of products) {
    if (!p.partCodeId) {
      noPartCode.push(p);
      continue;
    }
    const subCollectionGid = PART_CODE_TO_OUTLET_COLLECTION[p.partCodeId];
    if (!subCollectionGid) {
      noMapping.push(p);
      continue;
    }
    mappable.push({ ...p, subCollectionGid, subCollectionName: OUTLET_NAMES[subCollectionGid] });
  }

  // Summary by sub-collection
  const bySub = {};
  for (const p of mappable) {
    bySub[p.subCollectionName] = (bySub[p.subCollectionName] || 0) + 1;
  }

  console.log(`\n  Mappable to sub-collection: ${mappable.length}`);
  for (const [name, count] of Object.entries(bySub)) {
    console.log(`    ${name}: ${count}`);
  }
  console.log(`  No part_code_id:            ${noPartCode.length}`);
  console.log(`  No mapping for part_code:   ${noMapping.length}`);
  if (noMapping.length > 0 && noMapping.length <= 10) {
    noMapping.forEach(p => console.log(`    ${p.title} (partCode: ${p.partCodeId})`));
  }

  if (mappable.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nDry run complete — run with --apply to add products to sub-collections.");
    return;
  }

  // Apply
  const toProcess = mappable.slice(0, LIMIT);
  if (LIMIT < Infinity) console.log(`\nLimiting to ${toProcess.length} products.`);

  let added = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const p = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    const ok = await addProductToCollection(p.gid, p.subCollectionGid);
    if (ok) {
      console.log(`${progress} ${p.title} → ${p.subCollectionName} ✓`);
      added++;
    } else {
      console.log(`${progress} ${p.title} → FAILED`);
      failed++;
    }

    if (i < toProcess.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Added:  ${added}`);
  console.log(`  Failed: ${failed}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
