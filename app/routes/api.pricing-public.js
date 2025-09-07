import { json } from "@remix-run/node";
import https from "https";

// Monitor API configuration
const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

// Constants
const OUTLET_PRODUCT_GROUP_ID = "1229581166640460381";
const OUTLET_PRICE_LIST_ID = "1289997006982727753";

// SSL agent for self-signed certificates
const agent = new https.Agent({ rejectUnauthorized: false });

// Simple session management for this endpoint
let sessionId = null;

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Monitor API login
async function login() {
  const url = `${monitorUrl}/${monitorCompany}/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      UserName: monitorUsername,
      Password: monitorPassword,
    }),
    agent,
  });

  if (!res.ok) {
    throw new Error(`Monitor login failed: ${res.status}`);
  }

  const data = await res.json();
  sessionId = data.SessionId;
  return sessionId;
}

// Get or refresh session ID
async function getSessionId() {
  if (!sessionId) {
    sessionId = await login();
  }
  return sessionId;
}

// Check if a part is in outlet product group
async function isOutletProduct(partId) {
  try {
    const session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Stock/Parts/${partId}`;
    url += '?$select=ProductGroupId';
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent,
    });
    
    if (res.status !== 200) {
      // Try to re-login and retry once
      sessionId = await login();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": sessionId,
        },
        agent,
      });
      
      if (res.status !== 200) {
        console.error(`Failed to fetch part info for ${partId}: ${res.status}`);
        return false;
      }
    }
    
    const part = await res.json();
    return part.ProductGroupId === OUTLET_PRODUCT_GROUP_ID;
  } catch (error) {
    console.error(`Error checking if part ${partId} is outlet product:`, error);
    return false;
  }
}

// Fetch outlet price for a part
async function fetchOutletPrice(partId) {
  try {
    const session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '${OUTLET_PRICE_LIST_ID}'`;
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent,
    });
    
    if (res.status !== 200) {
      // Try to re-login and retry once
      sessionId = await login();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": sessionId,
        },
        agent,
      });
      
      if (res.status !== 200) {
        console.error(`Failed to fetch outlet price for ${partId}: ${res.status}`);
        return null;
      }
    }
    
    const prices = await res.json();
    if (!Array.isArray(prices)) {
      return null;
    }
    
    return prices.length > 0 ? prices[0].Price : null;
  } catch (error) {
    console.error(`Error fetching outlet price for part ${partId}:`, error);
    return null;
  }
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

    console.log(`Processing pricing request for variant ${variantId}, customer ${customerId}`);

    // First, we need to get the Monitor part ID from the variant's metafield
    // For now, we'll simulate this - in production you'd need to query Shopify's API
    // to get the variant's monitor_id metafield
    
    // Extract variant ID from the GraphQL ID
    const variantIdMatch = variantId.match(/ProductVariant\/(\d+)/);
    if (!variantIdMatch) {
      return json({ error: "Invalid variant ID format" }, { 
        status: 400,
        headers: corsHeaders()
      });
    }
    
    const numericVariantId = variantIdMatch[1];
    console.log(`Extracted numeric variant ID: ${numericVariantId}`);
    
    // TODO: In a real implementation, you would:
    // 1. Query Shopify's GraphQL API to get the variant's metafield 'custom.monitor_id'
    // 2. Use that monitor_id to check if it's an outlet product and get the price
    
    // For now, let's use a test Monitor part ID
    // You can replace this with an actual Monitor part ID from your system
    const testMonitorPartId = "1229581166640460382"; // Replace with a real part ID
    
    console.log(`Using test Monitor part ID: ${testMonitorPartId}`);
    
    // Check if this is an outlet product
    const isOutlet = await isOutletProduct(testMonitorPartId);
    console.log(`Is outlet product: ${isOutlet}`);
    
    let price = 299.99; // Default test price
    let priceSource = "test";
    
    if (isOutlet) {
      console.log(`Product is in outlet group, fetching outlet price...`);
      const outletPrice = await fetchOutletPrice(testMonitorPartId);
      if (outletPrice) {
        price = outletPrice;
        priceSource = "outlet";
        console.log(`Found outlet price: ${outletPrice}`);
      } else {
        console.log(`No outlet price found, using test price`);
      }
    } else {
      console.log(`Product not in outlet group, using test price`);
    }
    
    return json({ 
      price: price,
      metadata: {
        variantId,
        customerId,
        shop,
        monitorPartId: testMonitorPartId,
        isOutletProduct: isOutlet,
        priceSource: priceSource,
        message: `${priceSource === 'outlet' ? 'Real outlet pricing' : 'Test pricing'} - CORS working`
      }
    }, {
      headers: corsHeaders()
    });

  } catch (error) {
    console.error("Public pricing API error:", error);
    return json({ error: "Internal server error", details: error.message }, { 
      status: 500,
      headers: corsHeaders()
    });
  }
}
