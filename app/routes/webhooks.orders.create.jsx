import { authenticateWebhook } from "../utils/auth.server.js";
import { createOrderInMonitor } from "../utils/monitor.server.js";

export const action = async ({ request }) => {
  try {
    const { shop, session, topic, payload } = await authenticateWebhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    
    if (topic !== "orders/create") {
      console.warn(`Unexpected webhook topic: ${topic}`);
      return new Response("Unexpected topic", { status: 400 });
    }

    // Extract order information
    const order = typeof payload === 'string' ? JSON.parse(payload) : payload;
    console.log(`Processing order ${order.id || order.order_number} for ${order.customer?.email || 'unknown customer'}`);
    
    // Check if customer has monitor_id metafield
    const customer = order.customer;
    if (!customer) {
      console.log(`Order ${order.id} has no customer, skipping Monitor sync`);
      return new Response("No customer", { status: 200 });
    }

    // Get customer metafields to find monitor_id
    let monitorCustomerId = null;
    
    // For advanced store, we need to fetch customer metafields via API
    if (shop === process.env.ADVANCED_STORE_DOMAIN) {
      monitorCustomerId = await getCustomerMonitorId(shop, session.accessToken, customer.id);
    } else {
      // For OAuth stores, customer metafields should be included in webhook if configured
      // If not included, we'll need to fetch them
      monitorCustomerId = await getCustomerMonitorId(shop, session.accessToken, customer.id);
    }

    if (!monitorCustomerId) {
      console.log(`Customer ${customer.id} for order ${order.id} has no monitor_id metafield, skipping Monitor sync`);
      return new Response("No monitor_id", { status: 200 });
    }

    console.log(`Found monitor customer ID: ${monitorCustomerId} for Shopify customer ${customer.id}`);

    // Extract line items and convert to Monitor format
    const orderRows = await buildMonitorOrderRows(shop, session.accessToken, order.line_items, order);
    
    if (orderRows.length === 0) {
      console.log(`Order ${order.id} has no valid line items for Monitor, skipping sync`);
      return new Response("No valid line items", { status: 200 });
    }

    // Create order in Monitor
    const monitorOrderData = {
      CustomerId: monitorCustomerId, // Keep as string to avoid precision loss with large numbers
      OrderNumber: order.order_number ? order.order_number.toString() : null,
      OrderTypeId: 4, // As specified in requirements
      Rows: orderRows,
      IsStockOrder: false
    };

    console.log(`Creating order in Monitor:`, JSON.stringify(monitorOrderData, null, 2));

    const monitorOrderResult = await createOrderInMonitor(monitorOrderData);
    
    if (monitorOrderResult) {
      const { orderId: monitorOrderId } = monitorOrderResult;
      console.log(`✅ Successfully created order in Monitor with ID: ${monitorOrderId} for Shopify order ${order.id}`);
    } else {
      console.error(`❌ Failed to create order in Monitor for Shopify order ${order.id}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(`Error processing order webhook:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
};

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
async function buildMonitorOrderRows(shop, accessToken, lineItems, order) {
  const fetch = (await import('node-fetch')).default;
  const rows = [];

  for (const lineItem of lineItems) {
    try {
      // Get variant metafields to find monitor_id
      const variantId = lineItem.variant_id;
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
      
      // Try to get the actual price that was charged (from line item properties or calculate dynamic price)
      let finalPrice = parseFloat(lineItem.price);
      
      // Check if this order was placed by a logged-in customer and get dynamic pricing
      if (order.customer && order.customer.id) {
        try {
          // Get customer Monitor ID
          const customerMonitorId = await getCustomerMonitorId(shop, accessToken, order.customer.id);
          
          // Get variant details to check if it's an outlet product
          const variantQuery = `query {
            productVariant(id: "gid://shopify/ProductVariant/${variantId}") {
              product {
                collections(first: 50) {
                  edges {
                    node {
                      handle
                    }
                  }
                }
              }
            }
          }`;

          const variantResponse = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ query: variantQuery }),
          });

          const variantResult = await variantResponse.json();
          
          if (!variantResult.errors) {
            const collections = variantResult.data?.productVariant?.product?.collections?.edges || [];
            const isOutletProduct = collections.some(edge => edge.node.handle === 'outlet');
            
            // Call our pricing API to get what the price should have been
            const pricingResponse = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://monitor-api-connect-production.up.railway.app' : 'http://localhost:3000'}/api/pricing-public`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                variantId: `gid://shopify/ProductVariant/${variantId}`,
                customerId: `gid://shopify/Customer/${order.customer.id}`,
                shop: shop,
                monitorId: monitorPartId,
                isOutletProduct: isOutletProduct,
                customerMonitorId: customerMonitorId
              })
            });
            
            if (pricingResponse.ok) {
              const pricingData = await pricingResponse.json();
              if (pricingData.price && pricingData.price !== 299.99) {
                console.log(`Using dynamic price ${pricingData.price} instead of original price ${finalPrice} for line item ${lineItem.id}`);
                finalPrice = pricingData.price;
              }
            }
          }
          
        } catch (pricingError) {
          console.warn(`Could not get dynamic pricing for line item ${lineItem.id}, using original price:`, pricingError);
        }
      }
      
      // Create order row
      rows.push({
        PartId: monitorPartId,
        Quantity: lineItem.quantity,
        UnitPrice: finalPrice,
        // Description: lineItem.title, // Optional: add product title as description
      });

      console.log(`Added line item ${lineItem.id} (Monitor Part ID: ${monitorPartId}) with quantity ${lineItem.quantity} and price ${finalPrice}`);
    } catch (error) {
      console.error(`Error processing line item ${lineItem.id}:`, error);
      continue;
    }
  }

  return rows;
}
