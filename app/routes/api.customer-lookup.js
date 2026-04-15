import { json } from "@remix-run/node";
import https from "https";

const monitorUrl = process.env.MONITOR_URL;
const monitorCompany = process.env.MONITOR_COMPANY;

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
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  try {
    const client = await getMonitorClient();
    const sessionId = await client.getSessionId();

    // Fetch all active customers with Name and Number
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers?$select=Id,Name,Number&$filter=BlockedStatus Neq 2`;

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

    const result = (Array.isArray(customers) ? customers : []).map(c => ({
      id: c.Id,
      name: c.Name || "",
      number: c.Number || "",
    }));

    console.log(`[Customer Lookup] Returning ${result.length} customers`);

    return json({ customers: result }, {
      headers: {
        ...corsHeaders(),
        "Cache-Control": "public, max-age=300", // Cache 5 min
      },
    });

  } catch (error) {
    console.error("[Customer Lookup] Error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
