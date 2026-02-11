import { json } from "@remix-run/node";

// Cache for outlet variant count (server-side, shared across requests)
let cachedCount = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Shopify store credentials from environment
const STORE_DOMAIN = process.env.ADVANCED_STORE_DOMAIN;
const STORE_ADMIN_TOKEN = process.env.ADVANCED_STORE_ADMIN_TOKEN;

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Handle OPTIONS request for CORS preflight
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }

  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return json({ error: "Shop parameter is required" }, {
        status: 400,
        headers: corsHeaders()
      });
    }

    // Check cache first
    if (cachedCount !== null && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
      return json({ count: cachedCount, cached: true }, {
        headers: corsHeaders()
      });
    }

    // Use environment credentials for API access
    if (!STORE_DOMAIN || !STORE_ADMIN_TOKEN) {
      return json({ count: 0, error: "Missing store credentials", cached: false }, {
        status: 200,
        headers: corsHeaders()
      });
    }

    // Query variants with outlet metafield
    const adminUrl = `https://${STORE_DOMAIN}/admin/api/2025-01/graphql.json`;
    const accessToken = STORE_ADMIN_TOKEN;

    let totalCount = 0;
    let hasNextPage = true;
    let cursor = null;

    // Paginate through all variants to count those with outlet=true
    while (hasNextPage) {
      const query = `
        query GetOutletVariants($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                outletMetafield: metafield(namespace: "custom", key: "outlet") {
                  value
                }
              }
            }
          }
        }
      `;

      const response = await fetch(adminUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query,
          variables: { cursor }
        })
      });

      if (!response.ok) {
        break;
      }

      const data = await response.json();

      if (data.errors) {
        break;
      }

      const variants = data.data?.productVariants;

      if (variants?.edges) {
        // Count variants where outlet metafield is "true"
        for (const edge of variants.edges) {
          const outletValue = edge.node.outletMetafield?.value;
          if (outletValue === "true" || outletValue === true) {
            totalCount++;
          }
        }
      }

      hasNextPage = variants?.pageInfo?.hasNextPage || false;
      cursor = variants?.pageInfo?.endCursor || null;

      // Safety limit to prevent infinite loops
      if (totalCount > 10000) {
        break;
      }
    }

    // Update cache
    cachedCount = totalCount;
    cacheTimestamp = Date.now();

    return json({ count: totalCount, cached: false }, {
      headers: corsHeaders()
    });

  } catch (error) {
    return json({ error: "Internal server error", details: error.message }, {
      status: 500,
      headers: corsHeaders()
    });
  }
}
