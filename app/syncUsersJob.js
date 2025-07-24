import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
dotenv.config();

const shopifyConfig = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES?.split(","),
  hostName: process.env.SHOPIFY_APP_URL.replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});
if (!global.Shopify) global.Shopify = {};
global.Shopify.config = shopifyConfig.config;

async function syncUsers() {
  const prisma = (await import("./db.server.js")).default;
  const session = await prisma.session.findFirst();
  if (!session) {
    console.log("No Shopify session found. Cannot sync users.");
    return;
  }
  // Log session details for debugging
  console.log("Shopify session found:", {
    shop: session.shop,
    accessToken: session.accessToken ? "[REDACTED]" : null
  });
  if (!session.accessToken || !session.shop) {
    console.error("Shopify session is missing accessToken or shop. Cannot sync users.");
    return;
  }
  let users;
  try {
    const { fetchUsersFromMonitor } = await import("./utils/monitor.js");
    users = await fetchUsersFromMonitor();
    console.log("Fetched users", JSON.stringify(users), null, 2);
    if (!Array.isArray(users) || users.length === 0) {
      console.log("No users found to sync.");
      return;
    }
  } catch (err) {
    console.error("Error fetching users", err);
    return;
  }
  const fetch = (await import('node-fetch')).default;
  const shop = session.shop;
  const accessToken = session.accessToken;

  for (const user of users) {
    if (!user.email || user.email.trim() === "") {
      console.warn("Skipping user with blank email:", user);
      continue;
    }
    // Check if customer exists by email
    const checkQuery = `query {
      customers(first: 1, query: "email:${user.email}") {
        edges {
          node {
            id
            email
          }
        }
      }
    }`;
    const checkRes = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: checkQuery }),
    });
    const checkJson = await checkRes.json();
    const exists = checkJson.data && checkJson.data.customers && checkJson.data.customers.edges.length > 0;
    if (exists) {
      console.log(`Customer with email ${user.email} already exists, skipping.`);
      continue;
    }
    // Create customer mutation
    const mutation = `mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          email
          firstName
          lastName
        }
        userErrors {
          field
          message
        }
      }
    }`;
    const variables = {
      input: {
        email: user.email,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        phone: user.phone || undefined,
        // Add more fields as needed
      },
    };
    const createRes = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const createJson = await createRes.json();
    if (createJson.errors) {
      console.error("Shopify GraphQL errors:", JSON.stringify(createJson.errors, null, 2));
    }
    if (createJson.data && createJson.data.customerCreate && createJson.data.customerCreate.customer) {
      console.log(`Synced customer: ${createJson.data.customerCreate.customer.email}`);
    } else if (createJson.data && createJson.data.customerCreate && createJson.data.customerCreate.userErrors) {
      console.log(`User error: ${createJson.data.customerCreate.userErrors.map(e => e.message).join(", ")}`);
    } else {
      console.log("Unknown error:", JSON.stringify(createJson));
    }
  }
}

// Schedule to run every hour
cron.schedule("0 * * * *", () => {
  console.log("[CRON] Syncing users to Shopify...");
  syncUsers();
});

// Run once on startup as well
syncUsers();
