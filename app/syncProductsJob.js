import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import { fetchProductsFromMonitor } from "./utils/monitor.js";
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
// Use Node.js global object directly
if (!global.Shopify) global.Shopify = {};
global.Shopify.config = shopifyConfig.config;

async function syncProducts() {
  const prisma = (await import("./db.server.js")).default;
  const session = await prisma.session.findFirst();
  if (!session) {
    console.log("No Shopify session found. Cannot sync products.");
    return;
  }
  // Use the low-level GraphQL client from @shopify/shopify-api
  try {
    console.log("About to instantiate GraphqlClient");
    const admin = new shopifyConfig.clients.Graphql({
      session: {
        shop: session.shop,
        accessToken: session.accessToken,
      },
      apiVersion: "2024-01", // or your current ApiVersion
    });
    console.log("GraphqlClient instantiated successfully");
    let products;
    try {
      products = await fetchProductsFromMonitor();
      console.log("Fetched products", JSON.stringify(products), null, 2);
      if (!Array.isArray(products) || products.length === 0) {
        console.log("No products found to sync.");
        return;
      }
    } catch (err) {
      console.error("Error fetching products", err);
      return;
    }
    const mutation = "mutation productCreate($input: ProductInput!) { productCreate(input: $input) { product { id title status } userErrors { field message } } }";
    for (const product of products) {
      if (!product.name || product.name.trim() === "") {
        console.warn("Skipping product with blank name:", product);
        continue;
      }
      try {
        const variables = {
          input: {
            // id: product.id, // Use the product ID from Monitor, @TODO Is it to long?
            title: product.description,
            status: "ACTIVE", // @TODO What is status 4 in Monitor?
            vendor: product.vendor || "Default Vendor",
            // options: ["Title"],
            variants: [
              {
                price: product.price != null ? product.price.toString() : "0",
                sku: product.sku || "",
                weight: product.weight != null && !isNaN(Number(product.weight)) ? Number(product.weight) : 0,
                barcode: product.barcode || "",
              },
            ],
          },
        };
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
        if (json.errors) {
          console.error("Shopify GraphQL errors:", JSON.stringify(json.errors, null, 2));
        }
        if (json.data && json.data.productCreate && json.data.productCreate.product) {
          console.log(`Synced: ${json.data.productCreate.product.title}`);
        } else if (json.data && json.data.productCreate && json.data.productCreate.userErrors) {
          console.log(`User error: ${json.data.productCreate.userErrors.map(e => e.message).join(", ")}`);
        } else {
          console.log("Unknown error:", JSON.stringify(json));
        }
      } catch (err) {
        if (err && err.response && err.response.body) {
          console.error("GraphQL error (raw response):", err.response.body);
        } else {
          console.error("GraphQL error:", err);
        }
      }
    }
  } catch (err) {
    console.error("Failed to instantiate GraphqlClient:", err);
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
