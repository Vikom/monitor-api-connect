import { json } from "@remix-run/node";
import https from "https";

// Monitor API configuration
const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

// SSL agent for self-signed certificates
const agent = new https.Agent({ rejectUnauthorized: false });

// Use shared MonitorClient for session management (stored in DB, shared across endpoints)
let _monitorClient = null;
async function getMonitorClient() {
  if (!_monitorClient) {
    const { MonitorClient } = await import("../utils/monitor.server.js");
    _monitorClient = new MonitorClient();
  }
  return _monitorClient;
}

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Get or refresh session ID using shared MonitorClient
async function getSessionId() {
  const client = await getMonitorClient();
  return client.getSessionId();
}

// Re-login and get new session ID using shared MonitorClient
async function login() {
  const client = await getMonitorClient();
  return client.login();
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

/**
 * Fetch KNENH ExtraField for a part to get the comparison unit code
 * @param {string} partId - The Monitor Part ID
 * @returns {Promise<string|null>} The SelectedOption.Code or null if not found
 */
async function fetchKNENHCode(partId) {
  let session = await getSessionId();

  let url = `${monitorUrl}/${monitorCompany}/api/v1/Common/ExtraFields`;
  url += `?$filter=ParentId eq '${partId}' and Identifier eq 'KNENH'`;
  url += '&$expand=SelectedOption';

  let res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Monitor-SessionId": session,
    },
    agent,
  });

  if (res.status === 401) {
    // Session expired, re-login and retry
    session = await login();
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent,
    });
  }

  if (res.status !== 200) {
    console.error(`Failed to fetch KNENH for part ${partId}: ${res.status}`);
    return null;
  }

  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    console.log(`No KNENH extra field found for part ${partId}`);
    return null;
  }

  const code = data[0]?.SelectedOption?.Code;
  if (!code) {
    console.log(`KNENH found but no SelectedOption.Code for part ${partId}`);
    return null;
  }

  console.log(`Found KNENH code: ${code} for part ${partId}`);
  return code;
}

/**
 * Fetch Unit ID from Monitor by unit code
 * @param {string} unitCode - The unit code (e.g., "m", "kg")
 * @returns {Promise<string|null>} The Unit ID or null if not found
 */
async function fetchUnitIdByCode(unitCode) {
  let session = await getSessionId();

  let url = `${monitorUrl}/${monitorCompany}/api/v1/Common/Units`;
  url += `?$filter=Code eq '${unitCode}'`;

  let res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Monitor-SessionId": session,
    },
    agent,
  });

  if (res.status === 401) {
    // Session expired, re-login and retry
    session = await login();
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent,
    });
  }

  if (res.status !== 200) {
    console.error(`Failed to fetch unit by code ${unitCode}: ${res.status}`);
    return null;
  }

  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    console.log(`No unit found with code: ${unitCode}`);
    return null;
  }

  const unitId = data[0]?.Id;
  console.log(`Found unit ID: ${unitId} for code: ${unitCode}`);
  return unitId;
}

/**
 * Fetch price using GetPriceInfo with the comparison unit
 * @param {string} partId - The Monitor Part ID
 * @param {string} customerId - The Monitor Customer ID
 * @param {string} unitId - The comparison Unit ID
 * @returns {Promise<number|null>} The TotalPrice or null if not found
 */
async function fetchPriceWithUnit(partId, customerId, unitId) {
  let session = await getSessionId();

  const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerOrders/GetPriceInfo`;

  let res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Monitor-SessionId": session,
    },
    body: JSON.stringify({
      "PartId": partId,
      "CustomerId": customerId,
      "QuantityInUnit": 1.0,
      "UnitId": unitId,
      "UseExtendedResult": true
    }),
    agent,
  });

  if (res.status === 401) {
    // Session expired, re-login and retry
    session = await login();
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      body: JSON.stringify({
        "PartId": partId,
        "CustomerId": customerId,
        "QuantityInUnit": 1.0,
        "UnitId": unitId,
        "UseExtendedResult": true
      }),
      agent,
    });
  }

  if (res.status !== 200) {
    console.error(`Failed to fetch price for part ${partId} with unit ${unitId}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  console.log(`GetPriceInfo response for comparison price:`, data);

  return data.TotalPrice || null;
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
    const { monitorId, customerMonitorId } = body;

    if (!monitorId) {
      return json({ error: "Monitor ID is required" }, {
        status: 400,
        headers: corsHeaders()
      });
    }

    if (!customerMonitorId) {
      return json({ error: "Customer Monitor ID is required" }, {
        status: 400,
        headers: corsHeaders()
      });
    }

    console.log(`Fetching comparison price for part ${monitorId}, customer ${customerMonitorId}`);

    // Check if Monitor API is configured
    if (!monitorUrl || !monitorUsername || !monitorCompany) {
      console.log('Monitor API not configured');
      return json({
        comparisonPrice: null,
        reason: "api-not-configured"
      }, { headers: corsHeaders() });
    }

    // Step 1: Fetch KNENH ExtraField to get the comparison unit code
    const unitCode = await fetchKNENHCode(monitorId);

    if (!unitCode) {
      return json({
        comparisonPrice: null,
        reason: "no-knenh-field"
      }, { headers: corsHeaders() });
    }

    // Step 2: Fetch Unit ID from the code
    const unitId = await fetchUnitIdByCode(unitCode);

    if (!unitId) {
      return json({
        comparisonPrice: null,
        reason: "unit-not-found"
      }, { headers: corsHeaders() });
    }

    // Step 3: Fetch price using GetPriceInfo with the comparison unit
    const comparisonPrice = await fetchPriceWithUnit(monitorId, customerMonitorId, unitId);

    if (comparisonPrice === null) {
      return json({
        comparisonPrice: null,
        reason: "price-fetch-failed"
      }, { headers: corsHeaders() });
    }

    console.log(`Comparison price for part ${monitorId}: ${comparisonPrice} (unit: ${unitCode})`);

    return json({
      comparisonPrice: comparisonPrice,
      unitCode: unitCode,
      unitId: unitId
    }, { headers: corsHeaders() });

  } catch (error) {
    console.error("Comparison price API error:", error);
    return json({ error: "Internal server error", details: error.message }, {
      status: 500,
      headers: corsHeaders()
    });
  }
}
