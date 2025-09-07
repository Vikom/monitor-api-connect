import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";

// Create draft order with dynamic pricing
export async function action({ request }) {
  try {
    const { admin } = await authenticate.admin(request);
    
    const body = await request.json();
    const { customerId, items, useCartItems } = body; // items: [{ variantId, quantity }]
    
    if (!customerId) {
      return json({ error: "Customer ID is required" }, { status: 400 });
    }
    
    let finalItems = items;
    
    // If useCartItems is true, get current cart items from session
    if (useCartItems) {
      console.log('Getting cart items from customer session...');
      // Note: This would require getting cart from customer session
      // For now, we'll expect items to be passed or use a different approach
      if (!items || !Array.isArray(items)) {
        return json({ error: "Items array is required when useCartItems is true" }, { status: 400 });
      }
    } else if (!items || !Array.isArray(items)) {
      return json({ error: "Items array is required" }, { status: 400 });
    }
    
    console.log(`Creating draft order for customer ${customerId} with ${finalItems.length} items`);
    
    // Build line items with dynamic pricing
    const lineItems = [];
    
    for (const item of items) {
      try {
        const { variantId, quantity } = item;
        
        // Get variant details
        const variantQuery = `
          query getVariant($id: ID!) {
            productVariant(id: $id) {
              id
              price
              metafields(first: 10) {
                edges {
                  node {
                    key
                    namespace
                    value
                  }
                }
              }
              product {
                id
                title
                collections(first: 50) {
                  edges {
                    node {
                      handle
                    }
                  }
                }
              }
            }
          }
        `;
        
        const variantResponse = await admin.graphql(variantQuery, {
          variables: { id: variantId }
        });
        
        const variantData = await variantResponse.json();
        const variant = variantData.data?.productVariant;
        
        if (!variant) {
          console.log(`Variant ${variantId} not found, skipping`);
          continue;
        }
        
        // Extract monitor ID and outlet status
        const monitorIdMetafield = variant.metafields.edges.find(
          edge => edge.node.namespace === 'custom' && edge.node.key === 'monitor_id'
        );
        const monitorId = monitorIdMetafield?.node.value;
        
        const isOutletProduct = variant.product.collections.edges.some(
          edge => edge.node.handle === 'outlet'
        );
        
        // Get customer Monitor ID
        const customerQuery = `
          query getCustomer($id: ID!) {
            customer(id: $id) {
              metafields(first: 10) {
                edges {
                  node {
                    key
                    namespace
                    value
                  }
                }
              }
            }
          }
        `;
        
        const customerResponse = await admin.graphql(customerQuery, {
          variables: { id: customerId }
        });
        
        const customerData = await customerResponse.json();
        const customer = customerData.data?.customer;
        
        const customerMonitorIdMetafield = customer?.metafields.edges.find(
          edge => edge.node.namespace === 'custom' && edge.node.key === 'monitor_id'
        );
        const customerMonitorId = customerMonitorIdMetafield?.node.value;
        
        // Get dynamic price
        const pricingResponse = await fetch(`${request.url.origin}/api/pricing-public`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            variantId,
            customerId,
            shop: new URL(request.url).hostname,
            monitorId,
            isOutletProduct,
            customerMonitorId
          })
        });
        
        let finalPrice = variant.price;
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          if (pricingData.price) {
            finalPrice = pricingData.price.toString();
          }
        }
        
        lineItems.push({
          variantId: variantId,
          quantity: quantity,
          customPrice: finalPrice
        });
        
        console.log(`Added item: variant ${variantId}, quantity ${quantity}, price ${finalPrice}`);
        
      } catch (error) {
        console.error(`Error processing item ${item.variantId}:`, error);
      }
    }
    
    if (lineItems.length === 0) {
      return json({ error: "No valid items to add to draft order" }, { status: 400 });
    }
    
    // Create draft order
    const draftOrderMutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
            invoiceUrl
            totalPrice
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPrice
                  discountedUnitPrice
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const draftOrderInput = {
      customerId: customerId,
      lineItems: lineItems.map(item => ({
        variantId: item.variantId,
        quantity: item.quantity,
        customPrice: item.customPrice
      }))
    };
    
    const draftOrderResponse = await admin.graphql(draftOrderMutation, {
      variables: { input: draftOrderInput }
    });
    
    const draftOrderData = await draftOrderResponse.json();
    
    if (draftOrderData.data?.draftOrderCreate?.userErrors?.length > 0) {
      return json({ 
        error: "Failed to create draft order", 
        details: draftOrderData.data.draftOrderCreate.userErrors 
      }, { status: 400 });
    }
    
    const draftOrder = draftOrderData.data?.draftOrderCreate?.draftOrder;
    
    console.log(`Created draft order ${draftOrder.id} with total ${draftOrder.totalPrice}`);
    
    return json({
      success: true,
      draftOrder: {
        id: draftOrder.id,
        name: draftOrder.name,
        invoiceUrl: draftOrder.invoiceUrl,
        totalPrice: draftOrder.totalPrice,
        lineItems: draftOrder.lineItems.edges.map(edge => edge.node)
      }
    });
    
  } catch (error) {
    console.error('Draft order creation error:', error);
    return json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
