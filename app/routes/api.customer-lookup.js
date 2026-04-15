import { json } from "@remix-run/node";
import https from "https";

const monitorUrl = process.env.MONITOR_URL;
const monitorCompany = process.env.MONITOR_COMPANY;
const LOOKUP_API_KEY = process.env.CUSTOMER_LOOKUP_API_KEY;

const agent = new https.Agent({ rejectUnauthorized: false });

let _monitorClient = null;
async function getMonitorClient() {
  if (!_monitorClient) {
    const { MonitorClient } = await import("../utils/monitor.server.js");
    _monitorClient = new MonitorClient();
  }
  return _monitorClient;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Lookup-Key",
  };
}

export async function loader({ request }) {
  console.log("[Customer Lookup] Request received:", request.method, request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  try {
    const searchUrl = new URL(request.url);

    // Verify API key (via query param to avoid CORS preflight)
    const apiKey = searchUrl.searchParams.get("key");
    if (!LOOKUP_API_KEY || apiKey !== LOOKUP_API_KEY) {
      return json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
    }

    const query = (searchUrl.searchParams.get("q") || "").trim();

    if (query.length < 2) {
      return json({ customers: [], message: "Search query must be at least 2 characters" }, { headers: corsHeaders() });
    }

    console.log("[Customer Lookup] Query:", query);

    const client = await getMonitorClient();
    const sessionId = await client.getSessionId();
    console.log("[Customer Lookup] Session obtained");

    // Search customers by Name or Code (customer number) via OData filter.
    // NOTE: Monitor's OData parser rejects `ne` on BlockedStatus, so we filter
    // blocked customers client-side below instead of in the $filter.
    const escapedQuery = query.replace(/'/g, "''");
    const filter = `contains(Name,'${escapedQuery}') or contains(Code,'${escapedQuery}')`;
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers?$select=Id,Name,Code,BlockedStatus&$filter=${filter}&$top=20`;
    console.log("[Customer Lookup] Monitor URL:", url);

    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });

    if (res.status === 401) {
      await client.login();
      const newSessionId = await client.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
    }

    if (res.status !== 200) {
      const errorText = await res.text();
      console.error("[Customer Lookup] Monitor API error:", res.status, errorText);
      return json({ error: "Monitor API error" }, { status: 502, headers: corsHeaders() });
    }

    const customers = await res.json();

    const result = (Array.isArray(customers) ? customers : [])
      .filter(c => c.BlockedStatus !== 2)
      .slice(0, 10)
      .map(c => ({
        id: c.Id,
        name: c.Name || "",
        number: c.Code || "",
      }));

    console.log(`[Customer Lookup] Returning ${result.length} customers`);

    return json({ customers: result }, {
      headers: corsHeaders(),
    });

  } catch (error) {
    console.error("[Customer Lookup] Error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
