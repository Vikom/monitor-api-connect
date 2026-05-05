import "dotenv/config";

const states = {};
let cursor = null;
let total = 0;

while (true) {
  const afterClause = cursor ? `, after: "${cursor}"` : "";
  const query = `{
    customers(first: 250${afterClause}) {
      edges {
        cursor
        node {
          emailMarketingConsent {
            marketingState
            consentUpdatedAt
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }`;
  const res = await fetch(`https://${process.env.ADVANCED_STORE_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.ADVANCED_STORE_ADMIN_TOKEN },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) { console.error(JSON.stringify(json.errors)); break; }
  const edges = json.data?.customers?.edges || [];
  for (const e of edges) {
    const state = e.node.emailMarketingConsent?.marketingState || "NULL";
    states[state] = (states[state] || 0) + 1;
    total++;
  }
  if (!json.data?.customers?.pageInfo?.hasNextPage) break;
  cursor = edges[edges.length - 1].cursor;
}

console.log(`Total kunder: ${total}\n`);
for (const [state, count] of Object.entries(states).sort((a, b) => b[1] - a[1])) {
  const pct = ((count / total) * 100).toFixed(1);
  console.log(`  ${state.padEnd(16)} ${String(count).padStart(5)}  (${pct}%)`);
}
