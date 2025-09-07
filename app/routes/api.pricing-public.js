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
    const { variantId, customerId, shop, monitorId, isOutletProduct } = body;

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
    console.log(`Monitor ID: ${monitorId}, Is outlet product: ${isOutletProduct}`);
    console.log(`Monitor env check: URL=${!!monitorUrl}, USER=${!!monitorUsername}, COMPANY=${!!monitorCompany}`);

    let price = 299.99; // Default test price
    let priceSource = "test";
    
    // Check if Monitor API is configured
    if (!monitorUrl || !monitorUsername || !monitorCompany) {
      console.log('Monitor API not configured, using local logic...');
      
      // If this is an outlet product, use the fallback price logic
      if (isOutletProduct) {
        // For outlet products without API, check if we have a monitor ID
        if (monitorId) {
          // Simulate API response - in production, this would call Monitor API
          console.log(`Outlet product with Monitor ID ${monitorId} - using fallback price 100.00 (API not configured)`);
          price = 100.00;
          priceSource = "outlet-fallback-no-api";
        } else {
          console.log(`Outlet product without Monitor ID - using fallback price 100.00`);
          price = 100.00;
          priceSource = "outlet-fallback";
        }
      } else {
        console.log(`Not an outlet product, using test price: ${price}`);
      }
    } else {
      // Monitor API is configured, try to fetch real prices
      if (isOutletProduct && monitorId) {
        console.log(`Product is in outlet collection, fetching outlet price for Monitor ID: ${monitorId}`);
        const outletPrice = await fetchOutletPrice(monitorId);
        
        if (outletPrice !== null && outletPrice > 0) {
          price = outletPrice;
          priceSource = "outlet";
          console.log(`Found outlet price: ${outletPrice}`);
        } else {
          // No outlet price found or empty array, set to 100.00 as requested
          price = 100.00;
          priceSource = "outlet-fallback";
          console.log(`No outlet price found (empty array or null), using fallback price: 100.00`);
        }
      } else if (isOutletProduct && !monitorId) {
        // Outlet product but no monitor ID - use fallback
        price = 100.00;
        priceSource = "outlet-fallback";
        console.log(`Outlet product but no Monitor ID, using fallback price: 100.00`);
      } else {
        console.log(`Not an outlet product, using test price: ${price}`);
      }
    }
    
    return json({ 
      price: price,
      metadata: {
        variantId,
        customerId,
        shop,
        monitorPartId: monitorId || null,
        isOutletProduct: isOutletProduct || false,
        priceSource: priceSource,
        message: `${priceSource === 'outlet' ? 'Real outlet pricing' : priceSource === 'outlet-fallback' ? 'Outlet fallback pricing' : 'Test pricing'} - CORS working`
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
