import { json } from "@remix-run/node";

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Handle OPTIONS request for CORS
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }
  return json({ error: "Method not allowed" }, { status: 405 });
}

// Create draft order with dynamic pricing - PUBLIC endpoint for PRIVATE APP
export async function action({ request }) {
  try {
    console.log('🟦 PRIVATE APP DRAFT ORDER - Starting draft order creation');
    
    const body = await request.json();
    const { customerId, items, shop } = body; // items: [{ variantId, quantity }]
    
    console.log('🟦 Request data:', { customerId, itemCount: items?.length, shop });
    
    if (!customerId) {
      return json({ error: "Customer ID is required" }, { status: 400, headers: corsHeaders() });
    }
    
    if (!items || !Array.isArray(items)) {
      return json({ error: "Items array is required" }, { status: 400, headers: corsHeaders() });
    }
    
    if (!shop) {
      return json({ error: "Shop domain is required" }, { status: 400, headers: corsHeaders() });
    }

    console.log(`🟦 Creating draft order for customer ${customerId} with ${items.length} items`);
    
    // For private apps, use direct API credentials from environment
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN || process.env.ADVANCED_STORE_ADMIN_TOKEN;
    const apiVersion = '2023-10';
    
    if (!accessToken) {
      console.error('🟦 No SHOPIFY_ACCESS_TOKEN or ADVANCED_STORE_ADMIN_TOKEN found in environment');
      return json({ 
        error: "Private app access token not configured", 
        suggestion: "Add SHOPIFY_ACCESS_TOKEN or check ADVANCED_STORE_ADMIN_TOKEN in Railway environment variables"
      }, { status: 500, headers: corsHeaders() });
    }
    
    console.log(`🟦 Using private app credentials for ${shop}`);
    
    // Build line items with dynamic pricing
    const lineItems = [];
    
    for (const item of items) {
      try {
        const { variantId, quantity } = item;
        console.log(`🟦 Processing item: ${variantId}, quantity: ${quantity}`);
        
        // Get variant details using GraphQL (this was working)
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
        
        const variantResponse = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: variantQuery,
            variables: { id: variantId }
          })
        });
        
        const variantData = await variantResponse.json();
        const variant = variantData.data?.productVariant;
        
        if (!variant) {
          console.log(`🟦 Variant ${variantId} not found, skipping`);
          continue;
        }
        
        console.log(`🟦 Found variant: ${variant.product.title}, price: ${variant.price}`);
        
        // Extract monitor ID and outlet status
        const monitorIdMetafield = variant.metafields.edges.find(
          edge => edge.node.namespace === 'custom' && edge.node.key === 'monitor_id'
        );
        const monitorId = monitorIdMetafield?.node.value;
        
        const isOutletProduct = variant.product.collections.edges.some(
          edge => edge.node.handle === 'outlet'
        );
        
        console.log(`🟦 Variant metafields - Monitor ID: ${monitorId}, Is outlet: ${isOutletProduct}`);
        
        // Get customer Monitor ID using GraphQL
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
        
        const customerResponse = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: customerQuery,
            variables: { id: customerId }
          })
        });
        
        const customerData = await customerResponse.json();
        const customer = customerData.data?.customer;
        
        const customerMonitorIdMetafield = customer?.metafields.edges.find(
          edge => edge.node.namespace === 'custom' && edge.node.key === 'monitor_id'
        );
        const customerMonitorId = customerMonitorIdMetafield?.node.value;
        
        console.log(`🟦 Customer Monitor ID: ${customerMonitorId}`);
        
        // Get dynamic price using our pricing API
        const pricingApiUrl = process.env.SHOPIFY_APP_URL || 'https://monitor-api-connect-production.up.railway.app';
        const pricingResponse = await fetch(`${pricingApiUrl}/api/pricing-public`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            variantId,
            customerId,
            shop,
            monitorId,
            isOutletProduct,
            customerMonitorId
          })
        });
        
        let finalPrice = parseFloat(variant.price);
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          if (pricingData.price !== null && pricingData.price !== undefined) {
            finalPrice = pricingData.price;
            console.log(`🟦 Got dynamic price: ${finalPrice} (was ${variant.price})`);
          } else {
            console.log(`🟦 Using original price: ${finalPrice}`);
          }
        } else {
          console.log(`🟦 Pricing API error, using original price: ${finalPrice}`);
        }
        
        lineItems.push({
          variantId: variantId,
          quantity: quantity,
          customPrice: finalPrice.toString()
        });
        
        console.log(`🟦 Added line item: variant ${variantId}, quantity ${quantity}, price ${finalPrice}`);
        
      } catch (error) {
        console.error(`🟦 Error processing item ${item.variantId}:`, error);
      }
    }
    
    if (lineItems.length === 0) {
      return json({ 
        error: "No valid items to add to draft order" 
      }, { status: 400, headers: corsHeaders() });
    }
    
    console.log(`🟦 Creating draft order with ${lineItems.length} line items`);
    
    // Create draft order using GraphQL
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
    
    console.log(`🟦 Draft order input:`, JSON.stringify(draftOrderInput, null, 2));
    
    const draftOrderResponse = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: draftOrderMutation,
        variables: { input: draftOrderInput }
      })
    });
    
    const draftOrderData = await draftOrderResponse.json();
    
    console.log(`🟦 Draft order response:`, JSON.stringify(draftOrderData, null, 2));
    
    if (draftOrderData.data?.draftOrderCreate?.userErrors?.length > 0) {
      console.error('🟦 Draft order creation errors:', draftOrderData.data.draftOrderCreate.userErrors);
      return json({ 
        error: "Failed to create draft order", 
        details: draftOrderData.data.draftOrderCreate.userErrors 
      }, { status: 400, headers: corsHeaders() });
    }
    
    const draftOrder = draftOrderData.data?.draftOrderCreate?.draftOrder;
    
    if (!draftOrder) {
      console.error('🟦 No draft order returned');
      return json({ 
        error: "Failed to create draft order - no order returned" 
      }, { status: 400, headers: corsHeaders() });
    }
    
    console.log(`🟦 ✅ Created draft order ${draftOrder.id} with total ${draftOrder.totalPrice}`);
    console.log(`🟦 ✅ Invoice URL: ${draftOrder.invoiceUrl}`);
    
    return json({
      success: true,
      draftOrder: {
        id: draftOrder.id,
        name: draftOrder.name,
        invoiceUrl: draftOrder.invoiceUrl,
        totalPrice: draftOrder.totalPrice,
        lineItems: draftOrder.lineItems.edges.map(edge => edge.node)
      }
    }, { headers: corsHeaders() });
    
  } catch (error) {
    console.error('🟦 Draft order creation error:', error);
    return json({ 
      error: "Internal server error", 
      details: error.message 
    }, { status: 500, headers: corsHeaders() });
  }
}
