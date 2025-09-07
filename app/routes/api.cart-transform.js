import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Cart Transform API endpoint to apply dynamic pricing in cart
export async function action({ request }) {
  try {
    const { admin } = await authenticate.admin(request);
    
    const body = await request.json();
    const { cart_lines, buyer_identity } = body;
    
    console.log('Cart transform request:', { cart_lines, buyer_identity });
    
    // If no customer is logged in, return original cart
    if (!buyer_identity?.customer?.id) {
      console.log('No logged-in customer, returning original cart');
      return json({
        operations: [] // No transformations
      });
    }
    
    const operations = [];
    
    // Process each cart line for dynamic pricing
    for (const line of cart_lines) {
      try {
        const variantId = line.merchandise.id;
        const customerId = buyer_identity.customer.id;
        
        // Get the product variant to check for outlet status and monitor ID
        const variantQuery = `
          query getVariant($id: ID!) {
            productVariant(id: $id) {
              id
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
        
        // Extract monitor ID from metafields
        const monitorIdMetafield = variant.metafields.edges.find(
          edge => edge.node.namespace === 'custom' && edge.node.key === 'monitor_id'
        );
        const monitorId = monitorIdMetafield?.node.value;
        
        // Check if product is in outlet collection
        const isOutletProduct = variant.product.collections.edges.some(
          edge => edge.node.handle === 'outlet'
        );
        
        // Get customer metafields for Monitor customer ID
        const customerQuery = `
          query getCustomer($id: ID!) {
            customer(id: $id) {
              id
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
        
        // Call our pricing API to get dynamic price
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
        
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          const dynamicPrice = pricingData.price;
          
          // Only apply transform if price is different from test price
          if (dynamicPrice && dynamicPrice !== 299.99) {
            console.log(`Applying dynamic price ${dynamicPrice} to variant ${variantId}`);
            
            operations.push({
              update: {
                cartLineId: line.id,
                price: {
                  adjustment: {
                    fixedPricePerUnit: {
                      amount: dynamicPrice.toString()
                    }
                  }
                }
              }
            });
          }
        }
        
      } catch (error) {
        console.error(`Error processing cart line ${line.id}:`, error);
      }
    }
    
    console.log(`Returning ${operations.length} cart transform operations`);
    return json({ operations });
    
  } catch (error) {
    console.error('Cart transform error:', error);
    return json({ operations: [] }, { status: 200 }); // Return empty operations on error
  }
}
