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
              title
              price
              sku
              metafields(first: 10) {
                edges {
                  node {
                    key
                    namespace
                    value
                  }
                }
              }
              standardUnitMetafield: metafield(namespace: "custom", key: "standard_unit") {
                value
              }
              product {
                id
                title
                vendor
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
        
        // Extract standard unit to determine if this is a decimal product
        const standardUnit = variant.standardUnitMetafield?.value;
        const isDecimalUnit = standardUnit && ['lm', 'm2', 'm²', 'm3', 'm³', 'kg', 'l'].includes(standardUnit);
        
        // Convert quantity for decimal products (stored as integer × 20, need to display as decimal)
        const displayQuantity = isDecimalUnit ? quantity / 20.0 : quantity;
        
        console.log(`🟦 Variant metafields - Monitor ID: ${monitorId}, Is outlet: ${isOutletProduct}, Unit: ${standardUnit}, IsDecimal: ${isDecimalUnit}, StoredQty: ${quantity}, DisplayQty: ${displayQuantity}`);
        
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
          quantity: quantity, // Keep original integer quantity for API
          displayQuantity: displayQuantity, // Store display quantity for reference
          customPrice: finalPrice.toString(),
          productTitle: variant.product.title,
          variantTitle: variant.title || 'Default',
          sku: variant.sku || '',
          vendor: variant.product.vendor || 'Sonsab',
          standardUnit: standardUnit || 'st',
          isDecimalUnit: isDecimalUnit
        });
        
        console.log(`🟦 Added line item: variant ${variantId}, API quantity ${quantity}, display quantity ${displayQuantity} ${standardUnit || 'st'}, price ${finalPrice}`);
        
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
    
    // Create draft order using REST API with custom line items (no variant_id allows custom pricing)
    const draftOrderPayload = {
      draft_order: {
        customer: {
          id: customerId.replace('gid://shopify/Customer/', '')
        },
        line_items: lineItems.map(item => {
          let customPrice = parseFloat(item.customPrice);
          let apiQuantity = item.quantity; // Use original integer quantity
          
          // For decimal products, always use quantity 1 and calculate total price
          if (item.isDecimalUnit) {
            // Calculate the total price for the decimal quantity
            // displayQuantity is the actual amount (e.g., 0.25)
            // customPrice should be the unit price in kronor (e.g., 24895.19)
            const unitPrice = customPrice; // Keep the price as is - it should already be in kronor
            const totalPrice = unitPrice * item.displayQuantity;
            
            // Round to 2 decimal places for Swedish currency
            const roundedTotalPrice = Math.round(totalPrice * 100) / 100;
            
            customPrice = roundedTotalPrice; // Set the total as the line price
            apiQuantity = 1; // Always show as 1 unit for clarity
            
            console.log(`🟦 Decimal product: ${item.displayQuantity} ${item.standardUnit} × ${unitPrice} = ${roundedTotalPrice}`);
          }
          
          // Create custom line item without variant_id to allow custom pricing
          return {
            custom: true,
            title: `${item.productTitle} - ${item.variantTitle}`,
            price: customPrice.toString(),
            quantity: apiQuantity,
            taxable: true,
            requires_shipping: true,
            sku: item.sku,
            vendor: item.vendor
          };
        })
      }
    };
    
    console.log(`🟦 Draft order payload:`, JSON.stringify(draftOrderPayload, null, 2));
    
    const draftOrderResponse = await fetch(`https://${shop}/admin/api/${apiVersion}/draft_orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(draftOrderPayload)
    });
    
    const draftOrderData = await draftOrderResponse.json();
    
    console.log(`🟦 Draft order response:`, JSON.stringify(draftOrderData, null, 2));
    
    if (draftOrderData.errors) {
      console.error('🟦 Draft order creation errors:', draftOrderData.errors);
      return json({ 
        error: "Failed to create draft order", 
        details: draftOrderData.errors 
      }, { status: 400, headers: corsHeaders() });
    }
    
    const draftOrder = draftOrderData.draft_order;
    
    if (!draftOrder) {
      console.error('🟦 No draft order returned');
      return json({ 
        error: "Failed to create draft order - no order returned" 
      }, { status: 400, headers: corsHeaders() });
    }
    
    console.log(`🟦 ✅ Created draft order ${draftOrder.id} with total ${draftOrder.total_price}`);
    console.log(`🟦 ✅ Invoice URL: ${draftOrder.invoice_url}`);
    
    return json({
      success: true,
      draftOrder: {
        id: draftOrder.id,
        name: draftOrder.name,
        invoiceUrl: draftOrder.invoice_url,
        totalPrice: draftOrder.total_price,
        lineItems: draftOrder.line_items
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
