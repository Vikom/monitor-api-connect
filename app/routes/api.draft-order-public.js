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
        
        // Get variant details using GraphQL including image
        const variantQuery = `
          query getVariant($id: ID!) {
            productVariant(id: $id) {
              id
              title
              price
              sku
              image {
                id
                url
                altText
                width
                height
              }
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
                featuredImage {
                  id
                  url
                  altText
                  width
                  height
                }
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
        const isDecimalUnit = standardUnit && ['lm', 'm', 'm2', 'm²', 'm3', 'm³', 'kg', 'l'].includes(standardUnit);
        
        // Quantity is already converted in frontend for decimal products
        // Frontend sends actualQuantity = item.quantity / 20.0 for decimal products
        const displayQuantity = quantity;
        
        console.log(`🟦 Variant metafields - Monitor ID: ${monitorId}, Is outlet: ${isOutletProduct}, Unit: ${standardUnit}, IsDecimal: ${isDecimalUnit}, StoredQty: ${quantity}, DisplayQty: ${displayQuantity}`);
        
        // Extract image information
        const variantImage = variant.image;
        const productImage = variant.product.featuredImage;
        const imageUrl = variantImage?.url || productImage?.url;
        const imageAlt = variantImage?.altText || productImage?.altText || variant.product.title;
        
        console.log(`🟦 Image data - Variant image: ${variantImage?.url}, Product image: ${productImage?.url}, Using: ${imageUrl}`);
        
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
        console.log(`🟦 Base variant price: ${variant.price} -> parsed: ${finalPrice}`);
        
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          console.log(`🟦 Pricing API response:`, pricingData);
          if (pricingData.price !== null && pricingData.price !== undefined && pricingData.price > 0) {
            finalPrice = pricingData.price;
            console.log(`🟦 Got dynamic price: ${finalPrice} (was ${variant.price})`);
          } else {
            console.log(`🟦 Using original price: ${finalPrice} (pricing data price was ${pricingData.price})`);
          }
        } else {
          const errorText = await pricingResponse.text();
          console.log(`🟦 Pricing API error ${pricingResponse.status}: ${errorText}, using original price: ${finalPrice}`);
        }
        
        if (finalPrice <= 0) {
          console.warn(`🟦 Warning: Final price is ${finalPrice} for variant ${variantId}`);
        }
        
        console.log(`🟦 Final price before adding to lineItems: ${finalPrice} for variant ${variantId}`);
        console.log(`🟦 Converting to customPrice string: "${finalPrice.toString()}"`);
        
        // Additional logging for pricing data integrity
        if (typeof finalPrice !== 'number') {
          console.error(`🟦 ERROR: finalPrice is not a number! Type: ${typeof finalPrice}, Value: ${finalPrice}`);
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
          isDecimalUnit: isDecimalUnit,
          imageUrl: imageUrl,
          imageAlt: imageAlt
        });
        
        console.log(`🟦 Added line item: variant ${variantId}, API quantity ${quantity}, display quantity ${displayQuantity} ${standardUnit || 'st'}, price ${finalPrice}, image: ${imageUrl ? 'found' : 'none'}`);
        
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
          
          console.log(`🟦 MAPPING ITEM: variant ${item.variantId}, customPrice from item: "${item.customPrice}", parsed: ${customPrice}, isDecimalUnit: ${item.isDecimalUnit}`);
          
          // For decimal products, use quantity 1 and calculate total price
          if (item.isDecimalUnit) {
            // Calculate the total price for the decimal quantity
            // displayQuantity is the actual amount (e.g., 0.25)
            // customPrice should be the unit price per unit (e.g., per meter)
            const unitPrice = customPrice;
            const totalPrice = unitPrice * item.displayQuantity;
            
            // Round to 2 decimal places for Swedish currency
            const roundedTotalPrice = Math.round(totalPrice * 100) / 100;
            
            apiQuantity = 1; // Always use quantity 1 for decimal products
            customPrice = roundedTotalPrice; // Set the total as the line price
            
            console.log(`🟦 Decimal product: ${item.displayQuantity} ${item.standardUnit} × ${unitPrice} = ${roundedTotalPrice}`);
            console.log(`🟦 Decimal product final: customPrice=${customPrice}, apiQuantity=${apiQuantity}`);
          } else {
            console.log(`🟦 Regular product: customPrice=${customPrice}, apiQuantity=${apiQuantity}`);
          }
          
          // Create line item with variant_id AND custom pricing
          // This approach should preserve the image while allowing custom pricing
          const lineItem = {
            variant_id: item.variantId.replace('gid://shopify/ProductVariant/', ''),
            quantity: apiQuantity,
            price: customPrice.toString(),
            taxable: true,
            requires_shipping: true
          };
          
          // Add custom properties to preserve decimal unit information and custom pricing
          const properties = [];
          
          // Add decimal unit info if applicable
          if (item.isDecimalUnit) {
            properties.push({
              name: "Enhet",
              value: `${item.displayQuantity} ${item.standardUnit}`
            });
            properties.push({
              name: "Anpassat pris",
              value: "Ja - Dina priser tillämpade"
            });
          }
          
          // Add image fallback properties if needed
          if (item.imageUrl) {
            properties.push({
              name: "_image_url",
              value: item.imageUrl
            });
          }
          
          if (properties.length > 0) {
            lineItem.properties = properties;
          }
          
          return lineItem;
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
