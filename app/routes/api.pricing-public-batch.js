import { json } from "@remix-run/node";
import https from "https";

// Monitor API configuration
const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

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
  try {
    if (!monitorUrl || !monitorUsername || !monitorPassword || !monitorCompany) {
      console.error('Missing Monitor API credentials');
      throw new Error('Missing Monitor API environment variables');
    }

    const url = `${monitorUrl}/${monitorCompany}/login`;
    console.log(`[Batch Pricing] Attempting Monitor API login to: ${url}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        Username: monitorUsername,
        Password: monitorPassword,
        ForceRelogin: true,
      }),
      agent,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Batch Pricing] Monitor login failed: ${res.status} ${res.statusText}`);
      throw new Error(`Monitor login failed: ${res.status} - ${errorText}`);
    }

    let sessionIdFromHeader = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
    const data = await res.json();
    const receivedSessionId = sessionIdFromHeader || data.SessionId;

    if (!receivedSessionId) {
      throw new Error('No SessionId received from Monitor API');
    }

    console.log(`[Batch Pricing] Monitor API login successful`);
    sessionId = receivedSessionId;
    return sessionId;
  } catch (error) {
    console.error('[Batch Pricing] Monitor API login error:', error);
    sessionId = null;
    throw error;
  }
}

// Get or refresh session ID
async function getSessionId() {
  if (!sessionId) {
    sessionId = await login();
  }
  return sessionId;
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
    const { items, customerId, customerMonitorId, shop } = body;

    // Validate required fields
    if (!customerId) {
      return json({ error: "Customer ID is required" }, {
        status: 400,
        headers: corsHeaders()
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "Items array is required and must not be empty" }, {
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

    console.log(`[Batch Pricing] Processing batch request for ${items.length} items, customer ${customerMonitorId}`);

    // Check if Monitor API is configured
    if (!monitorUrl || !monitorUsername || !monitorCompany) {
      console.log('[Batch Pricing] Monitor API not configured');
      return json({
        prices: items.map(item => ({
          variantId: item.variantId,
          monitorId: item.monitorId,
          price: null,
          error: "API not configured"
        }))
      }, {
        headers: corsHeaders()
      });
    }

    // Fetch missing StandardUnitIds from Monitor API
    const { fetchPartStandardUnitId } = await import("../utils/monitor.server.js");

    // Check which items are missing StandardUnitId and fetch them
    const itemsWithUnitIds = await Promise.all(items.map(async (item) => {
      if (item.standardUnitId) {
        return item;
      }

      // Fetch StandardUnitId from Monitor
      console.log(`[Batch Pricing] Fetching StandardUnitId for ${item.monitorId}`);
      const unitId = await fetchPartStandardUnitId(item.monitorId);
      return {
        ...item,
        standardUnitId: unitId
      };
    }));

    // Build the request array for Monitor API
    // Each item must have: PartId, CustomerId, QuantityInUnit, UnitId, UseExtendedResult
    const priceRequests = itemsWithUnitIds.map(item => ({
      PartId: item.monitorId,
      CustomerId: customerMonitorId,
      QuantityInUnit: 1.0,
      UnitId: item.standardUnitId,
      UseExtendedResult: true
    }));

    let session = await getSessionId();
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerOrders/GetPriceInfo/Many`;

    console.log(`[Batch Pricing] Calling Monitor API: ${url}`);
    console.log(`[Batch Pricing] Request body (${priceRequests.length} items):`, JSON.stringify(priceRequests, null, 2));

    let res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      body: JSON.stringify(priceRequests),
      agent,
    });

    // Handle session expiry
    if (res.status === 401) {
      console.log(`[Batch Pricing] Session expired, re-logging in...`);
      sessionId = null;
      session = await login();
      res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": session,
        },
        body: JSON.stringify(priceRequests),
        agent,
      });
    }

    if (res.status !== 200) {
      const errorText = await res.text();
      console.error(`[Batch Pricing] Monitor API error: ${res.status} ${res.statusText}`);
      console.error(`[Batch Pricing] Error response: ${errorText}`);
      console.error(`[Batch Pricing] Request URL: ${url}`);
      console.error(`[Batch Pricing] Request body sample:`, JSON.stringify(priceRequests[0]));
      return json({
        error: "Monitor API error",
        monitorStatus: res.status,
        monitorError: errorText,
        requestUrl: url,
        requestSample: priceRequests[0],
        prices: items.map(item => ({
          variantId: item.variantId,
          monitorId: item.monitorId,
          price: null,
          error: "API error"
        }))
      }, {
        status: 200, // Return 200 so client can see the error details
        headers: corsHeaders()
      });
    }

    const response = await res.json();
    console.log(`[Batch Pricing] Received ${Array.isArray(response) ? response.length : 'non-array'} price responses`);

    // Map the response back to our items
    // The response should be an array in the same order as the request
    const prices = items.map((item, index) => {
      const priceResponse = Array.isArray(response) ? response[index] : null;
      return {
        variantId: item.variantId,
        monitorId: item.monitorId,
        price: priceResponse?.TotalPrice || null,
        calculatedPrice: priceResponse?.CalculatedTotalPrice || null,
        metadata: {
          unitPrice: priceResponse?.UnitPrice || null,
          discount: priceResponse?.DiscountPercent || null
        }
      };
    });

    return json({ prices }, {
      headers: corsHeaders()
    });

  } catch (error) {
    console.error("[Batch Pricing] API error:", error);
    return json({ error: "Internal server error", details: error.message }, {
      status: 500,
      headers: corsHeaders()
    });
  }
}
