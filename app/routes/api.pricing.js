import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getDynamicPrice } from "../utils/pricing.js";

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // Allow all origins for now
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Handle OPTIONS request for CORS preflight
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }
  return json({ error: "Method not allowed" }, { 
    status: 405,
    headers: corsHeaders()
  });
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { 
      status: 405,
      headers: corsHeaders()
    });
  }

  try {
    // For CORS requests from themes, we need a different authentication approach
    // The theme should send the shop domain in the request
    const body = await request.json();
    const { variantId, customerId, shop } = body;

    // For now, we'll authenticate using the shop parameter
    // In production, you might want to use a more secure method
    let admin;
    if (shop) {
      // Try to get admin for the specific shop
      try {
        const { admin: shopAdmin } = await authenticate.admin(request);
        admin = shopAdmin;
      } catch (authError) {
        // If direct auth fails, we might need to handle this differently
        console.log("Direct auth failed, attempting alternative...");
        // For now, return an error - we'll need to implement proper CORS auth
        return json({ error: "Authentication required from theme context" }, { 
          status: 401,
          headers: corsHeaders()
        });
      }
    } else {
      const { admin: shopAdmin } = await authenticate.admin(request);
      admin = shopAdmin;
    }

    // All users must be logged in - customerId is required
    if (!customerId) {
      return json({ error: "Customer ID is required - no anonymous pricing allowed" }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

    if (!variantId) {
      return json({ error: "Variant ID is required" }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

    // Get variant details including metafields and price
    const variantResponse = await admin.graphql(`
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          id
          price
          metafields(first: 10) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    `, {
      variables: { id: variantId }
    });

    const variantData = await variantResponse.json();
    const variant = variantData.data?.productVariant;

    if (!variant) {
      return json({ error: "Variant not found" }, { 
        status: 404,
        headers: corsHeaders()
      });
    }

    // Find Monitor ID metafield
    const monitorIdMetafield = variant.metafields.edges.find(
      edge => edge.node.namespace === "custom" && edge.node.key === "monitor_id"
    );

    if (!monitorIdMetafield) {
      // No Monitor ID, return standard price (outlet pricing already handled in sync)
      return json({ price: parseFloat(variant.price) }, {
        headers: corsHeaders()
      });
    }

    const variantMonitorId = monitorIdMetafield.node.value;
    const standardPrice = parseFloat(variant.price);

    // Get customer's Monitor ID
    const customerResponse = await admin.graphql(`
      query getCustomer($id: ID!) {
        customer(id: $id) {
          id
          metafields(first: 10) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    `, {
      variables: { id: customerId }
    });

    const customerData = await customerResponse.json();
    const customer = customerData.data?.customer;

    if (!customer) {
      return json({ error: "Customer not found" }, { 
        status: 404,
        headers: corsHeaders()
      });
    }

    // Find customer's Monitor ID metafield
    const customerMonitorIdMetafield = customer.metafields.edges.find(
      edge => edge.node.namespace === "custom" && edge.node.key === "monitor_id"
    );

    if (!customerMonitorIdMetafield) {
      // Customer has no Monitor ID, return standard price
      return json({ 
        price: standardPrice,
        message: "Customer has no Monitor ID - using standard price"
      }, {
        headers: corsHeaders()
      });
    }

    const customerMonitorId = customerMonitorIdMetafield.node.value;

    // Get dynamic price using the 3-tier hierarchy
    const dynamicPrice = await getDynamicPrice(variantMonitorId, customerMonitorId, standardPrice);
    
    return json({ 
      price: dynamicPrice,
      metadata: {
        variantMonitorId,
        customerMonitorId,
        standardPrice,
        priceSource: dynamicPrice === standardPrice ? "standard" : "dynamic"
      }
    }, {
      headers: corsHeaders()
    });

  } catch (error) {
    console.error("Pricing API error:", error);
    return json({ error: "Internal server error" }, { 
      status: 500,
      headers: corsHeaders()
    });
  }
}
