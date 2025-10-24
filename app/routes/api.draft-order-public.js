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
    const { customerId, items, shop, priceListId, goodsLabel, orderMark } = body; // items: [{ variantId, quantity, properties }]
    
    console.log('🟦 Request data:', { customerId, itemCount: items?.length, shop, priceListId, goodsLabel, orderMark });
    
    // Log properties for each item
    items?.forEach((item, index) => {
      console.log(`🟦 Item ${index + 1} properties:`, item.properties);
    });
    
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
    console.log(`🟦 Price list ID: ${priceListId || 'not provided'}`);
    
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
        const { variantId, quantity, properties } = item;
        console.log(`🟦 Processing item: ${variantId}, quantity: ${quantity}, properties:`, properties);
        
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
              partCodeMetafield: metafield(namespace: "custom", key: "partcode_id") {
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
        // Use same logic as frontend: whitelist approach for whole number units
        const wholeNumberUnits = ['st', 'rle', 'pkt', 'pås', 'Sk', 'krt', 'frp'];
        const isDecimalUnit = standardUnit && !wholeNumberUnits.includes(standardUnit);
        
        // For decimal products, quantity from frontend is the actual decimal amount
        // For regular products, ensure we have an integer
        const displayQuantity = isDecimalUnit ? quantity : Math.max(1, Math.round(Math.abs(quantity)));
        const apiQuantity = Math.max(1, Math.round(Math.abs(quantity))); // Always integer for API
        
        console.log(`🟦 Variant metafields - Monitor ID: ${monitorId}, Is outlet: ${isOutletProduct}, Unit: ${standardUnit}, IsDecimal: ${isDecimalUnit}, OriginalQty: ${quantity}, ApiQty: ${apiQuantity}, DisplayQty: ${displayQuantity}`);
        
        // Extract image information
        const variantImage = variant.image;
        const productImage = variant.product.featuredImage;
        const imageUrl = variantImage?.url || productImage?.url;
        const imageAlt = variantImage?.altText || productImage?.altText || variant.product.title;
        
        console.log(`🟦 Image data - Variant image: ${variantImage?.url}, Product image: ${productImage?.url}, Using: ${imageUrl}`);
        
        // Check if this item has beam data in its properties (for Balk products)
        const itemBeamData = item.properties || {};
        const beamProperties = {};
        const beamSummary = itemBeamData['Balkspecifikation'];
        
        console.log(`🟦 All properties for variant ${variantId}:`, itemBeamData);
        
        // Extract beam-related properties (now using Swedish names)
        Object.keys(itemBeamData).forEach(key => {
          if (key.startsWith('Längd ') || key.startsWith('Antal ')) {
            beamProperties[key] = itemBeamData[key];
          }
        });
        
        console.log(`🟦 Extracted beam properties for variant ${variantId}:`, beamProperties);
        console.log(`🟦 Beam summary: ${beamSummary || 'none'}`);
        
        // Get customer Monitor ID and discount category using GraphQL
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
        
        const customerDiscountCategoryMetafield = customer?.metafields.edges.find(
          edge => edge.node.namespace === 'custom' && edge.node.key === 'discount_category'
        );
        const customerDiscountCategory = customerDiscountCategoryMetafield?.node.value;
        
        // Extract part code from variant
        const partCode = variant.partCodeMetafield?.value;
        
        console.log(`🟦 Customer Monitor ID: ${customerMonitorId}`);
        console.log(`🟦 Customer Discount Category: ${customerDiscountCategory || 'not set'}`);
        console.log(`🟦 Part Code: ${partCode || 'not set'}`);
        
        // Check if customer has monitor ID - required for pricing
        if (!customerMonitorId) {
          console.error('🟦 Customer missing monitor ID - cannot proceed with checkout');
          return json({ 
            error: "Dina kunduppgifter är inte kompletta för att genomföra köp. Var god kontakta Sonsab",
            errorType: "missing_customer_data"
          }, { status: 400, headers: corsHeaders() });
        }
        console.log(`🟦 About to call pricing API with priceListId: ${priceListId || 'not provided'}`);
        
        // Get dynamic price using our pricing API
        const pricingApiUrl = process.env.SHOPIFY_APP_URL || 'https://monitor-api-connect-production.up.railway.app';
        console.log(`🟦 Making pricing API call to: ${pricingApiUrl}/api/pricing-public`);
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
            customerMonitorId,
            customerPriceListId: priceListId, // Use the correct parameter name expected by pricing API
            customerDiscountCategory: customerDiscountCategory, // Add discount category for discount logic
            partCodeId: partCode // Add part code for discount logic
          })
        });
        
        let finalPrice = parseFloat(variant.price);
        console.log(`🟦 Base variant price: ${variant.price} -> parsed: ${finalPrice}`);
        
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          console.log(`🟦 Pricing API response - price: ${pricingData.price}, source: ${pricingData.metadata?.priceSource}`);
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
          quantity: apiQuantity, // Always use integer quantity for API
          displayQuantity: displayQuantity, // Store display quantity for reference
          customPrice: finalPrice.toString(),
          productTitle: variant.product.title,
          variantTitle: variant.title || 'Default',
          sku: variant.sku || '',
          vendor: variant.product.vendor || 'Sonsab',
          standardUnit: standardUnit || 'st',
          isDecimalUnit: isDecimalUnit,
          imageUrl: imageUrl,
          imageAlt: imageAlt,
          // Add beam properties to the line item so they can be accessed later
          beamProperties: beamProperties,
          beamSummary: beamSummary
        });
        
        console.log(`🟦 Added line item: variant ${variantId}, API quantity ${apiQuantity}, display quantity ${displayQuantity} ${standardUnit || 'st'}, price ${finalPrice}, image: ${imageUrl ? 'found' : 'none'}`);
        
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
    
    // Check if all items have zero price - indicates pricing failure
    const totalValue = lineItems.reduce((sum, item) => sum + parseFloat(item.customPrice), 0);
    console.log(`🟦 Total order value: ${totalValue}`);
    
    if (totalValue <= 0) {
      console.error('🟦 Draft order has zero total value - pricing failed');
      return json({ 
        error: "Något gick fel när vi hämtade dina priser. Försök igen eller kontakta oss.",
        errorType: "pricing_failed"
      }, { status: 400, headers: corsHeaders() });
    }
    
    // Create draft order using REST API with custom line items (no variant_id allows custom pricing)
    const draftOrderPayload = {
      draft_order: {
        customer: {
          id: parseInt(customerId.replace('gid://shopify/Customer/', ''))
        },
        note: goodsLabel || '', // Use the note field for goods label since draft orders don't support custom_attributes
        line_items: lineItems.map(item => {
          let customPrice = parseFloat(item.customPrice);
          let apiQuantity = item.quantity; // Use integer quantity

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
          
          // Create custom line item with custom pricing
          // Cannot use variant_id with custom pricing - Shopify ignores the price
          const lineItem = {
            title: `${item.productTitle}${item.variantTitle && item.variantTitle !== 'Default' ? ' - ' + item.variantTitle : ''}`,
            price: customPrice.toString(),
            quantity: apiQuantity,
            taxable: true,
            requires_shipping: true,
            vendor: item.vendor,
            sku: item.sku,
            grams: 600000 // Default weight
          };
          
          // Add custom properties to preserve decimal unit information and custom pricing
          const lineItemProperties = [];
          
          // Always add variant ID for tracking
          lineItemProperties.push({
            name: "_variant_id",
            value: item.variantId.replace('gid://shopify/ProductVariant/', '')
          });
          
          // Add decimal unit info if applicable
          if (item.isDecimalUnit) {
            // Format quantity with Swedish decimal separator
            const formattedQuantity = item.displayQuantity.toString().replace('.', ',');
            lineItemProperties.push({
              name: "Enhet",
              value: `${formattedQuantity} ${item.standardUnit}`
            });
          }
          
          // Add beam properties if they exist in the item properties
          console.log(`🟦 Checking for beam properties to add to line item. Available properties:`, Object.keys(item.properties || {}));
          console.log(`🟦 Checking for beam properties stored in line item object:`, item.beamProperties);
          
          // Also check for beam properties that were extracted earlier in the processing
          // (they might not be in item.properties anymore but were stored as beamProperties variable)
          // First, try to get beam properties from current item.properties
          let beamPropertiesToAdd = {};
          if (item.properties && typeof item.properties === 'object') {
            Object.keys(item.properties).forEach(key => {
              console.log(`🟦 Checking property key: ${key}, starts with Längd: ${key.startsWith('Längd ')}, starts with Antal: ${key.startsWith('Antal ')}, is Balkspecifikation: ${key === 'Balkspecifikation'}`);
              if (key.startsWith('Längd ') || key.startsWith('Antal ') || key === 'Balkspecifikation') {
                beamPropertiesToAdd[key] = item.properties[key];
              }
            });
          } else {
            console.log(`🟦 No properties found on item or properties is not an object. Type:`, typeof item.properties);
            
            // Try to get beam properties from the line item object where they were stored
            if (item.beamProperties && typeof item.beamProperties === 'object') {
              console.log(`🟦 Found beam properties in line item object:`, item.beamProperties);
              beamPropertiesToAdd = { ...item.beamProperties };
              
              // Also add beam summary if available
              if (item.beamSummary) {
                beamPropertiesToAdd['Balkspecifikation'] = item.beamSummary;
              }
            }
          }
          
          // If we don't have beam properties from either source, log for debugging
          if (Object.keys(beamPropertiesToAdd).length === 0) {
            console.log(`🟦 No beam properties found in item.properties or item.beamProperties`);
          }
          
          // Add the beam properties to line item properties
          Object.keys(beamPropertiesToAdd).forEach(key => {
            lineItemProperties.push({
              name: key,
              value: beamPropertiesToAdd[key]
            });
            console.log(`🟦 ✅ Added beam property to line item: ${key} = ${beamPropertiesToAdd[key]}`);
          });
          
          // Add image information as properties
          if (item.imageUrl) {
            lineItemProperties.push({
              name: "_image_url",
              value: item.imageUrl
            });
            if (item.imageAlt) {
              lineItemProperties.push({
                name: "_image_alt",
                value: item.imageAlt
              });
            }
          }
          
          if (lineItemProperties.length > 0) {
            lineItem.properties = lineItemProperties;
            console.log(`🟦 Final line item properties being added:`, lineItemProperties);
          } else {
            console.log(`🟦 No properties to add to line item`);
          }
          
          console.log(`🟦 Complete line item being added to draft order:`, JSON.stringify(lineItem, null, 2));
          
          return lineItem;
        })
      }
    };
    
    // console.log(`🟦 Draft order payload:`, JSON.stringify(draftOrderPayload, null, 2));
    
    const draftOrderResponse = await fetch(`https://${shop}/admin/api/${apiVersion}/draft_orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(draftOrderPayload)
    });
    
    const draftOrderData = await draftOrderResponse.json();
    
    // console.log(`🟦 Draft order response:`, JSON.stringify(draftOrderData, null, 2));
    
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
    
    // Add metafields for goods label and order mark if provided (so they can be accessed via GraphQL)
    const metafieldsToAdd = [];
    
    if (goodsLabel) {
      metafieldsToAdd.push({
        ownerId: `gid://shopify/DraftOrder/${draftOrder.id}`,
        namespace: "custom",
        key: "goods_label",
        value: goodsLabel.replace(/"/g, '\\"').replace(/\n/g, '\\n'),
        type: "multi_line_text_field"
      });
    }
    
    if (orderMark) {
      metafieldsToAdd.push({
        ownerId: `gid://shopify/DraftOrder/${draftOrder.id}`,
        namespace: "custom", 
        key: "order_mark",
        value: orderMark.replace(/"/g, '\\"').replace(/\n/g, '\\n'),
        type: "multi_line_text_field"
      });
    }
    
    if (metafieldsToAdd.length > 0) {
      try {
        console.log(`🟦 Adding ${metafieldsToAdd.length} metafields: ${metafieldsToAdd.map(m => m.key).join(', ')}`);
        console.log('🟦 Metafields being added:', JSON.stringify(metafieldsToAdd, null, 2));
        
        const metafieldMutation = `
          mutation {
            metafieldsSet(metafields: [
              ${metafieldsToAdd.map(metafield => `{
                ownerId: "${metafield.ownerId}"
                namespace: "${metafield.namespace}"
                key: "${metafield.key}"
                value: "${metafield.value}"
                type: "${metafield.type}"
              }`).join(',')}
            ]) {
              metafields {
                id
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        
        console.log('🟦 GraphQL mutation being sent:', metafieldMutation);
        
        const metafieldResponse = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: metafieldMutation })
        });
        
        const metafieldResult = await metafieldResponse.json();
        
        console.log('🟦 Metafield creation response:', JSON.stringify(metafieldResult, null, 2));
        
        if (metafieldResult.data?.metafieldsSet?.userErrors?.length > 0) {
          console.error('❌ Metafield creation errors:', metafieldResult.data.metafieldsSet.userErrors);
        } else {
          console.log(`✅ Successfully added metafields to draft order ${draftOrder.id}`);
          if (metafieldResult.data?.metafieldsSet?.metafields) {
            metafieldResult.data.metafieldsSet.metafields.forEach(mf => {
              console.log(`✅ Created metafield ${mf.key}: ${mf.value?.substring(0, 100)}${mf.value?.length > 100 ? '...' : ''}`);
            });
          }
        }
      } catch (metafieldError) {
        console.error('🟦 Failed to add metafields:', metafieldError);
        // Don't fail the whole operation if metafield creation fails
      }
    }
    
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
