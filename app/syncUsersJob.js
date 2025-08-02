import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
dotenv.config();

// Get command line arguments to determine which store to sync to
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a');

console.log(`🎯 Target store: ${useAdvancedStore ? 'Advanced Store' : 'Development Store'}`);

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

// Helper function to validate if a session is still valid
async function validateSession(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
  const testQuery = `query {
    shop {
      id
      name
    }
  }`;

  try {
    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: testQuery }),
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error("Session validation failed:", result.errors);
      return false;
    }
    
    return result.data && result.data.shop;
  } catch (error) {
    console.error("Error validating session:", error);
    return false;
  }
}

async function syncUsers() {
  let shop, accessToken;

  if (useAdvancedStore) {
    // Use Advanced store configuration
    shop = process.env.ADVANCED_STORE_DOMAIN;
    accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    if (!shop || !accessToken) {
      console.log("❌ Advanced store configuration missing!");
      console.log("Please ensure ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are set in your .env file");
      return;
    }

    console.log(`🔗 Using Advanced store: ${shop}`);
    
    // Validate the advanced store session
    const isValidSession = await validateSession(shop, accessToken);
    if (!isValidSession) {
      console.log("❌ Advanced store session is invalid.");
      console.log("Please check your ADVANCED_STORE_ADMIN_TOKEN in the .env file");
      return;
    }
  } else {
    // Use development store with OAuth (existing logic)
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

    // Validate the session by making a test API call
    const isValidSession = await validateSession(session.shop, session.accessToken);
    if (!isValidSession) {
      console.log("❌ Shopify session is invalid or expired.");
      console.log("To fix this:");
      console.log("1. Run 'npm run dev' to start the development server");
      console.log("2. Visit the app in your browser to re-authenticate");
      console.log("3. Once authenticated, you can run the sync job again");
      return;
    }

    shop = session.shop;
    accessToken = session.accessToken;
    console.log(`🔗 Using development store: ${shop}`);
  }

  console.log("✅ Store session is valid. Starting users sync...");

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
/*cron.schedule("0 * * * *", () => {
  console.log("[CRON] Syncing users to Shopify...");
  syncUsers();
});*/

// Display usage instructions
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Users Sync Job Usage:

To sync to development store (OAuth):
  node app/syncUsersJob.js

To sync to Advanced store:
  node app/syncUsersJob.js --advanced
  node app/syncUsersJob.js -a

Configuration:
  Development store: Uses Prisma session from OAuth flow
  Advanced store: Uses ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN from .env

Make sure your .env file is configured properly before running.
  `);
  process.exit(0);
}

console.log(`
🚀 Starting Users Sync Job
📝 Use --help for usage instructions
`);

// Run the sync
syncUsers();
