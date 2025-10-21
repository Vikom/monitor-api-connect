import "@shopify/shopify-api/adapters/node";
import { createOrderInMonitor, setOrderPropertiesInMonitor, updateDeliveryAddressInMonitor } from "./utils/monitor.js";
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
    
    // Only query completed draft orders that haven't been sent to Monitor yet
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
            shippingAddress {
              firstName
              lastName
              company
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            billingAddress {
              firstName
              lastName
              company
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
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

    // Filter out orders that have already been sent to Monitor
    const unsentOrders = draftOrders.filter(orderEdge => {
      const order = orderEdge.node;
      const metafields = order.metafields?.edges || [];
      const sentToMonitorMetafield = metafields.find(mf => mf.node.key === "sent_to_monitor");
      
      // Only process if sent_to_monitor is false or doesn't exist
      return !sentToMonitorMetafield || sentToMonitorMetafield.node.value === "false";
    });

    console.log(`📦 Found ${draftOrders.length} completed draft orders, ${unsentOrders.length} not yet sent to Monitor`);

    if (unsentOrders.length === 0) {
      console.log("✅ All completed draft orders have already been sent to Monitor");
      return;
    }

    // Process each unsent completed draft order
    for (const orderEdge of unsentOrders) {
      const order = orderEdge.node;
      console.log("Full draft order", order);
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

        // Extract goods label and order mark from draft order metafields
        const metafields = order.metafields?.edges || [];
        const goodsLabelMetafield = metafields.find(mf => mf.node.key === "goods_label");
        const goodsLabel = goodsLabelMetafield ? goodsLabelMetafield.node.value : '';
        const orderMarkMetafield = metafields.find(mf => mf.node.key === "order_mark");
        const orderMark = orderMarkMetafield ? orderMarkMetafield.node.value : '';

        // Create order in Monitor system (without Preliminary and GoodsLabel)
        const monitorOrderData = {
          CustomerId: monitorCustomerId, // Try as string first - these IDs are too large for JavaScript integers
          // OrderNumber: order.name,
          BusinessContactOrderNumber: order.name,
          // OrderTypeId: 4, // As specified in requirements
          OrderTypeId: '980267526921268926',
          Rows: orderRows,
          IsStockOrder: false
        };

        // console.log(`  📦 Creating order in Monitor:`, JSON.stringify(monitorOrderData, null, 2));

        const monitorOrderResult = await createOrderInMonitor(monitorOrderData);
        
        if (monitorOrderResult) {
          const { orderId: monitorOrderId, response: monitorResponse } = monitorOrderResult;
          console.log(`  ✅ Successfully created order in Monitor with ID: ${monitorOrderId} for Shopify draft order ${order.name}`);

          // Extract OrderNumber from Monitor response and update Shopify draft order name
          const monitorOrderNumber = monitorResponse.OrderNumber;
          if (monitorOrderNumber) {
            console.log(`  📦 Updating draft order name to Monitor order number: ${monitorOrderNumber}`);
            await updateDraftOrderName(shop, accessToken, order.id.split('/').pop(), monitorOrderNumber);
          }

          // Set order properties (Preliminary, GoodsLabel1, and BusinessContactOrderNumber) in a second request
          const orderProperties = {
            Preliminary: { Value: true }, // NotNullBooleanInput type may require object format
            GoodsLabel1: { Value: goodsLabel.substring(0, 80) }, // Limit to 80 characters
            BusinessContactOrderNumber: { Value: orderMark.substring(0, 30) } // Limit to 30 characters
          };
          
          const propertiesSet = await setOrderPropertiesInMonitor(monitorOrderId, orderProperties);
          
          if (propertiesSet) {
            console.log(`  ✅ Successfully set order properties for Monitor order ${monitorOrderId}`);
          } else {
            console.error(`  ⚠️  Failed to set order properties for Monitor order ${monitorOrderId}, but order was created`);
          }

          const addressToUse = order.shippingAddress || order.billingAddress;
          
          if (addressToUse) {
            const addressType = order.shippingAddress ? 'shipping' : 'billing';
            console.log(`  📦 Using ${addressType} address for delivery address`);
            
            const deliveryAddressData = {
              Addressee: `${addressToUse.firstName || ''} ${addressToUse.lastName || ''}`.trim() || addressToUse.company || '',
              Field1: addressToUse.company || '',
              Field2: addressToUse.address1 || '',
              Field3: addressToUse.address2 || '',
              Locality: addressToUse.city || '',
              Region: addressToUse.province || '',
              PostalCode: addressToUse.zip || '',
              LanguageId: 1 // Default to Swedish language ID, adjust if needed
            };
            
            const addressUpdated = await updateDeliveryAddressInMonitor(monitorOrderId, deliveryAddressData);
            
            if (addressUpdated) {
              console.log(`  ✅ Successfully updated delivery address for Monitor order ${monitorOrderId}`);
            } else {
              console.error(`  ⚠️  Failed to update delivery address for Monitor order ${monitorOrderId}, but order was created`);
            }
          } else {
            console.log(`  ⚠️  No shipping or billing address found for draft order ${order.name}!`);
            console.log(`  🔍 Full draft order data for debugging:`, JSON.stringify(order, null, 2));
          }
          
          // Mark draft order as sent to Monitor
          await markDraftOrderAsSentToMonitor(shop, accessToken, order.id.split('/').pop());
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
      // In draft orders, variant is null but variant ID is stored in customAttributes
      let variantId = null;
      
      if (lineItem.variant?.id) {
        variantId = lineItem.variant.id.split('/').pop();
      } else {
        // For draft orders, look for _variant_id in customAttributes
        const variantIdAttribute = lineItem.customAttributes?.find(attr => attr.key === '_variant_id');
        if (variantIdAttribute) {
          variantId = variantIdAttribute.value;
        }
      }
      
      if (!variantId) {
        console.warn(`Draft order line item ${lineItem.id} has no variant ID in variant field or customAttributes, skipping. LineItem data:`, JSON.stringify(lineItem, null, 2));
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
      
      // For decimal products, check if there's a decimal quantity in customAttributes
      let orderedQuantity = lineItem.quantity; // Default to the line item quantity
      
      // Look for decimal quantity in the "Enhet" (Unit) custom attribute
      // Format is like "0,5 m" or "2,5 kg" with Swedish decimal separator
      const unitAttribute = lineItem.customAttributes?.find(attr => attr.key === 'Enhet');
      
      if (unitAttribute && unitAttribute.value) {
        // Extract decimal quantity from format "0,5 m" -> 0.5
        const unitValue = unitAttribute.value.trim();
        const quantityMatch = unitValue.match(/^([0-9]+[,.]?[0-9]*)/);
        
        if (quantityMatch) {
          // Convert Swedish decimal separator to English
          const decimalQuantityStr = quantityMatch[1].replace(',', '.');
          const decimalQuantity = parseFloat(decimalQuantityStr);
          
          if (!isNaN(decimalQuantity) && decimalQuantity > 0) {
            orderedQuantity = decimalQuantity;
            console.log(`    Using decimal quantity ${decimalQuantity} from "Enhet" attribute "${unitValue}" for line item ${lineItem.id}`);
          }
        }
      }
      
      rows.push({
        PartId: monitorPartId,
        OrderedQuantity: orderedQuantity,
        UnitPrice: unitPrice,
        // Description: lineItem.title
      });

      console.log(`    Added draft order line item ${lineItem.id} (Monitor Part ID: ${monitorPartId}) with quantity ${orderedQuantity} and unit price ${unitPrice}`);
    } catch (error) {
      console.error(`Error processing line item ${lineItem.id}:`, error);
      continue;
    }
  }

  return rows;
}

/**
 * Update a draft order's name with the Monitor order number
 */
async function updateDraftOrderName(shop, accessToken, draftOrderId, orderNumber) {
  const fetch = (await import('node-fetch')).default;
  
  const mutation = `mutation {
    draftOrderUpdate(id: "gid://shopify/DraftOrder/${draftOrderId}", input: {
      name: "${orderNumber}"
    }) {
      draftOrder {
        id
        name
      }
      userErrors {
        field
        message
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
      body: JSON.stringify({ query: mutation }),
    });

    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL errors updating draft order name:", JSON.stringify(result.errors, null, 2));
      return false;
    }

    if (result.data?.draftOrderUpdate?.userErrors?.length > 0) {
      console.error("User errors updating draft order name:", JSON.stringify(result.data.draftOrderUpdate.userErrors, null, 2));
      return false;
    }

    console.log(`  📋 Updated draft order ${draftOrderId} name to: ${orderNumber}`);
    return true;
  } catch (error) {
    console.error("Error updating draft order name:", error);
    return false;
  }
}

/**
 * Mark a draft order as sent to Monitor by setting the sent_to_monitor metafield to true
 */
async function markDraftOrderAsSentToMonitor(shop, accessToken, draftOrderId) {
  const fetch = (await import('node-fetch')).default;
  
  const mutation = `mutation {
    draftOrderUpdate(id: "gid://shopify/DraftOrder/${draftOrderId}", input: {
      metafields: [
        {
          namespace: "custom"
          key: "sent_to_monitor"
          value: "true"
          type: "boolean"
        }
      ]
    }) {
      draftOrder {
        id
      }
      userErrors {
        field
        message
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
      body: JSON.stringify({ query: mutation }),
    });

    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL errors marking draft order as sent:", JSON.stringify(result.errors, null, 2));
      return false;
    }

    if (result.data?.draftOrderUpdate?.userErrors?.length > 0) {
      console.error("User errors marking draft order as sent:", JSON.stringify(result.data.draftOrderUpdate.userErrors, null, 2));
      return false;
    }

    console.log(`  📋 Marked draft order ${draftOrderId} as sent to Monitor`);
    return true;
  } catch (error) {
    console.error("Error marking draft order as sent to Monitor:", error);
    return false;
  }
}

export { pollForNewOrders };
