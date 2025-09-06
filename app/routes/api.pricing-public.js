import { json } from "@remix-run/node";

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    const body = await request.json();
    const { variantId, customerId, shop } = body;

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

    if (!shop) {
      return json({ error: "Shop parameter is required" }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

    // Create a simple GraphQL client for the shop
    // We need to use the shop's access token - for now return a mock response
    // In a production setup, you'd store shop access tokens and use them here
    
    // For now, return a mock response to test the CORS functionality
    return json({ 
      price: 299.99,
      metadata: {
        variantId,
        customerId,
        shop,
        message: "Mock pricing response - CORS working",
        priceSource: "mock"
      }
    }, {
      headers: corsHeaders()
    });

  } catch (error) {
    console.error("Public pricing API error:", error);
    return json({ error: "Internal server error" }, { 
      status: 500,
      headers: corsHeaders()
    });
  }
}
