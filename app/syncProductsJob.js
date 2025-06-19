import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import { fetchProductsFromThirdParty } from "./utils/thirdPartyApi.js";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
dotenv.config();

const shopifyConfig = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(","),
  hostName: process.env.SHOPIFY_APP_URL.replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});
// Polyfill for global object
var _globalThis = (function() {
  try {
    // eslint-disable-next-line no-new-func
    return Function('return this')();
  } catch (e) {
    if (typeof self !== 'undefined') return self;
    if (typeof window !== 'undefined') return window;
    if (typeof global !== 'undefined') return global;
    throw new Error('Unable to locate global object');
  }
})();

if (!_globalThis.Shopify) _globalThis.Shopify = {};
_globalThis.Shopify.config = shopifyConfig.config;

// This function will be called every hour
async function syncProducts() {
  const prisma = (await import("./db.server.js")).default;
  const session = await prisma.session.findFirst();
  if (!session) {
    console.log("No Shopify session found. Cannot sync products.");
    return;
  }
  // Use the low-level GraphQL client from @shopify/shopify-api
  try {
    console.log("[DEBUG] About to instantiate GraphqlClient");
    // Use the static factory method from shopifyConfig
    const admin = new shopifyConfig.clients.Graphql({
      session: {
        shop: session.shop,
        accessToken: session.accessToken,
      },
      apiVersion: "2024-01", // or your current ApiVersion
    });
    console.log("[DEBUG] GraphqlClient instantiated successfully");
    let products;
    try {
      products = await fetchProductsFromThirdParty();
    } catch (err) {
      console.error("Error fetching products from third party:", err);
      return;
    }
    if (!Array.isArray(products)) {
      console.error("Third-party product fetch failed or returned unexpected data.");
      return;
    }
    // Inline the mutation string to avoid line breaks
    const mutation = "mutation productCreate($input: ProductInput!) { productCreate(input: $input) { product { id title status } userErrors { field message } } }";
    for (const product of products) {
      try {
        const variables = {
          input: {
            title: product.name,
            status: "ACTIVE",
            vendor: product.vendor || "Default Vendor",
            options: ["Title"], // Add options at the product level
            variants: [
              {
                price: product.price.toString(),
                // Remove option1, not valid in ProductVariantInput
              },
            ],
          },
        };
        // Log the mutation and variables for debugging
        console.log("Attempting mutation with variables:", JSON.stringify(variables, null, 2));
        // Log the outgoing request body for debugging
        console.log("Outgoing request body:", JSON.stringify({ query: mutation, variables }, null, 2));
        let response, json;
        try {
          // Try Shopify API client first
          response = await admin.request({
            query: mutation,
            variables,
          });
          json = response;
        } catch (clientErr) {
          console.error("[Fallback] Shopify API client failed, trying fetch directly.");
          // Fallback to fetch if client fails
          const fetch = (await import('node-fetch')).default;
          const shop = session.shop;
          const accessToken = session.accessToken;
          const fetchRes = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ query: mutation, variables }),
          });
          json = await fetchRes.json();
        }
        // The response is already parsed JSON
        // Print the full raw response for debugging
        // console.log("Raw Shopify response:", JSON.stringify(json, null, 2));
        if (json.errors) {
          console.error("❌ Shopify GraphQL errors:", JSON.stringify(json.errors, null, 2));
        }
        if (json.data && json.data.productCreate && json.data.productCreate.product) {
          console.log(`✅ Synced: ${json.data.productCreate.product.title}`);
        } else if (json.data && json.data.productCreate && json.data.productCreate.userErrors) {
          console.log(`❌ User error: ${json.data.productCreate.userErrors.map(e => e.message).join(", ")}`);
        } else {
          console.log("❌ Unknown error:", JSON.stringify(json));
        }
      } catch (err) {
        if (err && err.response && err.response.body) {
          console.error("GraphQL error (raw response):", err.response.body);
          console.error("GraphQL error (detailed):");
        } else {
          console.error("GraphQL error:", err);
        }
      }
    }
  } catch (err) {
    console.error("[ERROR] Failed to instantiate GraphqlClient:", err);
    throw err;
  }
}

// Schedule to run every hour
cron.schedule("0 * * * *", () => {
  console.log("[CRON] Syncing products to Shopify...");
  syncProducts();
});

// Run once on startup as well
syncProducts();
