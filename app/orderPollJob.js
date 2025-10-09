import "@shopify/shopify-api/adapters/node";
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
    
    // Get draft orders from last 2 hours to catch any we might have missed
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    // Only query completed draft orders since those have gone through checkout
    const draftOrderQuery = `query {
      draftOrders(first: 50, query: "created_at:>='${twoHoursAgo}' AND status:completed") {
        edges {
          node {
            id
            name
            email
            createdAt
            totalPrice
            status
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
                  originalUnitPrice
                  discountedUnitPrice
                  variant {
                    id
                    sku
                    price
                    product {
                      id
                      title
                    }
                  }
                  customAttributes {
                    key
                    value
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
      body: JSON.stringify({ query: draftOrderQuery }),
    });

    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL errors polling draft orders:", JSON.stringify(result.errors, null, 2));
      return;
    }

    const draftOrders = result.data?.draftOrders?.edges || [];
    
    if (draftOrders.length === 0) {
      console.log("✅ No new completed draft orders found");
      return;
    }

    console.log(`📦 Found ${draftOrders.length} completed draft orders`);

    // Process each completed draft order
    for (const orderEdge of draftOrders) {
      const order = orderEdge.node;
      console.log(`Processing completed draft order: ${order.name} (${order.totalPrice}) - Status: ${order.status}`);
      console.log(`Draft order line items count: ${order.lineItems?.edges?.length || 0}`);
      
      try {
        // Check if customer exists and has monitor_id
        const customer = order.customer;
        if (!customer) {
          console.log(`  ⚠️  Draft order ${order.name} has no customer, skipping Monitor sync`);
          continue;
        }

        // Get customer monitor_id metafield
        const monitorCustomerId = await getCustomerMonitorId(shop, accessToken, customer.id.split('/').pop());
        
        if (!monitorCustomerId) {
          console.log(`  ⚠️  Customer ${customer.id} for draft order ${order.name} has no monitor_id metafield, skipping Monitor sync`);
          continue;
        }

        console.log(`  📋 Found monitor customer ID: ${monitorCustomerId} for Shopify customer ${customer.id}`);

        // Build Monitor order rows from line items
        const lineItems = order.lineItems?.edges?.map(edge => edge.node) || [];
        console.log(`  📋 Processing ${lineItems.length} line items for draft order ${order.name}`);
        
        // Debug: Log first line item structure
        if (lineItems.length > 0) {
          console.log(`  🔍 First draft order line item structure:`, JSON.stringify(lineItems[0], null, 2));
        }
        
        const orderRows = await buildMonitorOrderRows(shop, accessToken, lineItems);
        
        if (orderRows.length === 0) {
          console.log(`  ⚠️  Draft order ${order.name} has no valid line items for Monitor, skipping sync`);
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
          IsStockOrder: false,
          GoodsLabel: order.note // @TODO is this syntax correct?
        };

        console.log(`  📦 Creating order in Monitor:`, JSON.stringify(monitorOrderData, null, 2));

        const monitorOrderId = await createOrderInMonitor(monitorOrderData);
        
        if (monitorOrderId) {
          console.log(`  ✅ Successfully created order in Monitor with ID: ${monitorOrderId} for Shopify draft order ${order.name}`);
        } else {
          console.error(`  ❌ Failed to create order in Monitor for Shopify draft order ${order.name}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to create draft order ${order.name} in Monitor:`, error);
      }
    }

  } catch (error) {
    console.error("Error polling for orders:", error);
  }
}

// Cron schedule is now handled by worker.js
// Poll for orders every 5 minutes (managed by worker)
// For testing - uncomment to run immediately
// pollForNewOrders();

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
      // In draft orders, variant should be available
      let variantId = null;
      
      if (lineItem.variant?.id) {
        variantId = lineItem.variant.id.split('/').pop();
      }
      
      if (!variantId) {
        console.warn(`Draft order line item ${lineItem.id} has no variant, skipping. LineItem data:`, JSON.stringify(lineItem, null, 2));
        continue;
      }
      
      console.log(`Processing draft order line item ${lineItem.id} with variant ID: ${variantId}`);

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
      
      // Create order row - get price from draft order line item
      // In draft orders, use discountedUnitPrice first (includes custom pricing), then originalUnitPrice
      let unitPrice = 0;
      
      if (lineItem.discountedUnitPrice) {
        // Use discounted price which includes custom pricing
        unitPrice = parseFloat(lineItem.discountedUnitPrice);
      } else if (lineItem.originalUnitPrice) {
        // Fallback to original price
        unitPrice = parseFloat(lineItem.originalUnitPrice);
      } else if (lineItem.variant?.price) {
        // Final fallback to variant price
        unitPrice = parseFloat(lineItem.variant.price);
      } else {
        console.warn(`No price found for draft order line item ${lineItem.id}, using 0`);
      }
      
      rows.push({
        PartId: monitorPartId,
        OrderedQuantity: lineItem.quantity,
        UnitPrice: unitPrice,
        // Description: lineItem.title, // Optional: add product title as description
      });

      console.log(`    Added draft order line item ${lineItem.id} (Monitor Part ID: ${monitorPartId}) with quantity ${lineItem.quantity} and unit price ${unitPrice}`);
    } catch (error) {
      console.error(`Error processing line item ${lineItem.id}:`, error);
      continue;
    }
  }

  return rows;
}

export { pollForNewOrders };
