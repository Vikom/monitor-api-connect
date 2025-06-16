import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import { fetchProductsFromThirdParty } from "./utils/thirdPartyApi.js";
import dotenv from "dotenv";
import { GraphqlClient } from "@shopify/shopify-api";
dotenv.config();

// This function will be called every hour
async function syncProducts() {
  const prisma = (await import("./db.server.js")).default;
  const session = await prisma.session.findFirst();
  if (!session) {
    console.log("No Shopify session found. Cannot sync products.");
    return;
  }
  // Use the low-level GraphQL client from @shopify/shopify-api
  const admin = new GraphqlClient({
    session: {
      shop: session.shop,
      accessToken: session.accessToken,
      isCustomStoreApp: false, // explicitly set to avoid undefined error
    },
    apiVersion: "2024-01", // or your current ApiVersion
  });
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
  const mutation = `
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          title
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  for (const product of products) {
    try {
      const variables = {
        product: {
          title: product.name,
          status: "ACTIVE",
          variants: [
            {
              price: product.price.toString(),
              option1: "Default Title",
            },
          ],
        },
      };
      // Log the mutation and variables for debugging
      console.log("Attempting mutation with variables:", JSON.stringify(variables, null, 2));
      // Use the admin.graphql method
      const response = await admin.query({
        data: {
          query: mutation,
          variables,
        },
      });
      const json = await response.json();
      // Print the full raw response for debugging
      console.log("Raw Shopify response:", JSON.stringify(json, null, 2));
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
        console.error("GraphQL error (detailed):", JSON.stringify(err.response.body, null, 2));
      } else {
        console.error("GraphQL error:", err);
      }
    }
  }
}

// Schedule to run every hour
cron.schedule("0 * * * *", () => {
  console.log("[CRON] Syncing products to Shopify...");
  syncProducts();
});

// Run once on startup as well
syncProducts();
