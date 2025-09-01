import { shopifyApi } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-10";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sessionStorage = new PrismaSessionStorage(prisma);

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ["read_orders", "read_products", "read_customers", "write_products", "write_customers", "read_locations", "write_inventory"],
  hostName: process.env.SHOPIFY_APP_URL || "monitor-api-connect-production.up.railway.app",
  apiVersion: "2024-10",
  isEmbeddedApp: true,
  restResources,
});

async function setupOrdersWebhook() {
  try {
    // Get the shop domain from command line or environment
    const shop = process.argv[2] || process.env.SHOP_DOMAIN;
    
    if (!shop) {
      console.error("Please provide shop domain as argument: node setup-webhook.js your-shop.myshopify.com");
      process.exit(1);
    }

    console.log(`Setting up orders webhook for shop: ${shop}`);

    // Get the session for this shop
    const sessions = await sessionStorage.findSessionsByShop(shop);
    
    if (!sessions || sessions.length === 0) {
      console.error(`No active session found for shop: ${shop}`);
      console.log("Please make sure the app is installed and you have an active session.");
      process.exit(1);
    }

    const session = sessions[0]; // Use the first session found
    console.log(`Using session: ${session.id}`);

    // Create the webhook
    const webhook = new shopify.rest.Webhook({ session });
    webhook.topic = "orders/create";
    webhook.address = `https://monitor-api-connect-production.up.railway.app/webhooks/orders/create`;
    webhook.format = "json";

    await webhook.save({
      update: true,
    });

    console.log("✅ Orders webhook created successfully!");
    console.log(`Webhook ID: ${webhook.id}`);
    console.log(`Address: ${webhook.address}`);
    console.log(`Topic: ${webhook.topic}`);

  } catch (error) {
    console.error("❌ Error setting up webhook:", error);
    
    if (error.message?.includes("protected customer data")) {
      console.log("\n💡 This confirms that even custom apps need approval for orders webhooks.");
      console.log("For now, the polling solution in orderPollJob.js will handle order sync.");
      console.log("You can apply for protected customer data access if needed for real-time webhooks.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

setupOrdersWebhook();
