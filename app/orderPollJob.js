import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import { createOrderInMonitor } from "./utils/monitor.js";
import dotenv from "dotenv";
dotenv.config();

// Order polling job - alternative to webhooks for immediate implementation
async function pollForNewOrders() {
  let shop, accessToken;

  // Use Advanced store configuration
  shop = process.env.ADVANCED_STORE_DOMAIN;
  accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    console.log("❌ Advanced store configuration missing for order polling!");
    return;
  }

  console.log(`🔍 Polling for new orders from: ${shop}`);

  try {
    const fetch = (await import('node-fetch')).default;
    
    // Get orders from last 2 hours to catch any we might have missed
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const query = `query {
      orders(first: 50, query: "created_at:>='${twoHoursAgo}'") {
        edges {
          node {
            id
            name
            email
            createdAt
            totalPrice
            displayFulfillmentStatus
            displayFinancialStatus
            customer {
              id
              firstName
              lastName
              email
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  variant {
                    id
                    sku
                    product {
                      id
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL errors polling orders:", JSON.stringify(result.errors, null, 2));
      return;
    }

    const orders = result.data?.orders?.edges || [];
    
    if (orders.length === 0) {
      console.log("✅ No new orders found");
      return;
    }

    console.log(`📦 Found ${orders.length} recent orders`);

    // Process each order (same logic as webhook handler)
    for (const orderEdge of orders) {
      const order = orderEdge.node;
      console.log(`Processing order: ${order.name} (${order.totalPrice})`);
      
      try {
        // Create order in Monitor system
        await createOrderInMonitor({
          shopifyOrderId: order.id,
          orderNumber: order.name,
          customerEmail: order.email,
          totalPrice: order.totalPrice,
          customer: order.customer,
          lineItems: order.lineItems.edges.map(edge => edge.node),
          createdAt: order.createdAt,
          fulfillmentStatus: order.displayFulfillmentStatus,
          financialStatus: order.displayFinancialStatus
        });
        
        console.log(`  ✅ Order ${order.name} created in Monitor`);
      } catch (error) {
        console.error(`  ❌ Failed to create order ${order.name} in Monitor:`, error);
      }
    }

  } catch (error) {
    console.error("Error polling for orders:", error);
  }
}

// Poll for orders every 15 minutes
cron.schedule("*/15 * * * *", () => {
  console.log("[ORDER-POLL] Checking for new orders...");
  pollForNewOrders();
});

// For testing - uncomment to run immediately
// pollForNewOrders();

console.log("🔄 Order polling service started - checking every 15 minutes");

export { pollForNewOrders };
