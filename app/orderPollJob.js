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
                    price
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
        // Check if customer exists and has monitor_id
        const customer = order.customer;
        if (!customer) {
          console.log(`  ⚠️  Order ${order.name} has no customer, skipping Monitor sync`);
          continue;
        }

        // Get customer monitor_id metafield
        const monitorCustomerId = await getCustomerMonitorId(shop, accessToken, customer.id.split('/').pop());
        
        if (!monitorCustomerId) {
          console.log(`  ⚠️  Customer ${customer.id} for order ${order.name} has no monitor_id metafield, skipping Monitor sync`);
          continue;
        }

        console.log(`  📋 Found monitor customer ID: ${monitorCustomerId} for Shopify customer ${customer.id}`);

        // Build Monitor order rows from line items
        const orderRows = await buildMonitorOrderRows(shop, accessToken, order.lineItems.edges.map(edge => edge.node));
        
        if (orderRows.length === 0) {
          console.log(`  ⚠️  Order ${order.name} has no valid line items for Monitor, skipping sync`);
          continue;
        }

        // Create order in Monitor system
        const monitorOrderData = {
          CustomerId: monitorCustomerId, // Try as string first - these IDs are too large for JavaScript integers
          // OrderNumber: order.name,
          BusinessContactOrderNumber: order.name,
          // OrderTypeId: 4, // As specified in requirements
          OrderTypeId: '980267526921268926',
          Preliminary: true,
          Rows: orderRows,
          IsStockOrder: false
        };

        console.log(`  📦 Creating order in Monitor:`, JSON.stringify(monitorOrderData, null, 2));

        const monitorOrderId = await createOrderInMonitor(monitorOrderData);
        
        if (monitorOrderId) {
          console.log(`  ✅ Successfully created order in Monitor with ID: ${monitorOrderId} for Shopify order ${order.name}`);
        } else {
          console.error(`  ❌ Failed to create order in Monitor for Shopify order ${order.name}`);
        }
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

/**
 * Get customer's monitor_id metafield from Shopify
 */
async function getCustomerMonitorId(shop, accessToken, customerId) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    customer(id: "gid://shopify/Customer/${customerId}") {
      metafields(first: 10, namespace: "custom") {
        edges {
          node {
            key
            value
          }
        }
      }
    }
  }`;

  try {
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
      console.error("GraphQL errors getting customer metafields:", JSON.stringify(result.errors, null, 2));
      return null;
    }

    const metafields = result.data?.customer?.metafields?.edges || [];
    const monitorIdMetafield = metafields.find(mf => mf.node.key === "monitor_id");
    
    return monitorIdMetafield ? monitorIdMetafield.node.value : null;
  } catch (error) {
    console.error("Error fetching customer metafields:", error);
    return null;
  }
}

/**
 * Build Monitor order rows from Shopify line items
 */
async function buildMonitorOrderRows(shop, accessToken, lineItems) {
  const fetch = (await import('node-fetch')).default;
  const rows = [];

  for (const lineItem of lineItems) {
    try {
      // Get variant metafields to find monitor_id
      const variantId = lineItem.variant?.id?.split('/').pop();
      if (!variantId) {
        console.warn(`Line item ${lineItem.id} has no variant_id, skipping`);
        continue;
      }

      const query = `query {
        productVariant(id: "gid://shopify/ProductVariant/${variantId}") {
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                key
                value
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
        console.error(`GraphQL errors getting variant ${variantId} metafields:`, JSON.stringify(result.errors, null, 2));
        continue;
      }

      const metafields = result.data?.productVariant?.metafields?.edges || [];
      const monitorIdMetafield = metafields.find(mf => mf.node.key === "monitor_id");
      
      if (!monitorIdMetafield) {
        console.warn(`Variant ${variantId} for line item ${lineItem.id} has no monitor_id metafield, skipping`);
        continue;
      }

      const monitorPartId = monitorIdMetafield.node.value; // Keep as string to avoid precision loss
      
      // Create order row - need to calculate price per unit
      const unitPrice = parseFloat(lineItem.variant?.price || 0);
      
      rows.push({
        PartId: monitorPartId,
        OrderedQuantity: lineItem.quantity,
        UnitPrice: unitPrice,
        // Description: lineItem.title, // Optional: add product title as description
      });

      console.log(`    Added line item ${lineItem.id} (Monitor Part ID: ${monitorPartId}) with quantity ${lineItem.quantity}`);
    } catch (error) {
      console.error(`Error processing line item ${lineItem.id}:`, error);
      continue;
    }
  }

  return rows;
}

export { pollForNewOrders };
