import { json } from "@remix-run/node";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });
const monitorUrl = process.env.MONITOR_URL;
const monitorCompany = process.env.MONITOR_COMPANY;

let _client = null;
async function getClient() {
  if (!_client) {
    const { MonitorClient } = await import("../utils/monitor.server.js");
    _client = new MonitorClient();
  }
  return _client;
}

const WAREHOUSE_IDS = [
  '933124852911871989',  // vittsjo
  '933124156053429919',  // ronas
  '1189106270728482943', // lund
  '933126667535575191',  // sundsvall
  '933125224426542349',  // goteborg
  '933126074830088482',  // stockholm
];

const WAREHOUSE_NAMES = {
  '933124852911871989': 'vittsjo',
  '933124156053429919': 'ronas',
  '1189106270728482943': 'lund',
  '933126667535575191': 'sundsvall',
  '933125224426542349': 'goteborg',
  '933126074830088482': 'stockholm',
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }
  return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders() });
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders() });
  }

  try {
    const body = await request.json();
    const { items } = body;
    // items: [{ monitorId: "...", variantId: "gid://..." }, ...]

    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "items array is required" }, { status: 400, headers: corsHeaders() });
    }

    if (!monitorUrl || !monitorCompany) {
      return json({ error: "Monitor API not configured" }, { status: 500, headers: corsHeaders() });
    }

    const client = await getClient();
    let session = await client.getSessionId();

    // Build batch request: one entry per monitorId × warehouseId
    const balanceDate = new Date();
    balanceDate.setDate(balanceDate.getDate() + 14);
    const balanceDateISO = balanceDate.toISOString();

    // Deduplicate monitorIds (multiple variants could share the same part)
    const uniqueMonitorIds = [...new Set(items.filter(i => i.monitorId).map(i => i.monitorId))];

    const batchBody = [];
    for (const monitorId of uniqueMonitorIds) {
      for (const warehouseId of WAREHOUSE_IDS) {
        batchBody.push({
          PartId: monitorId,
          WarehouseId: warehouseId,
          BalanceDate: balanceDateISO,
          ActualOrdersTransactionType: 16352,
        });
      }
    }

    console.log(`[Stock Batch] Fetching stock for ${uniqueMonitorIds.length} parts (${batchBody.length} warehouse calls in one batch)`);

    const url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts/GetPartBalanceInfo/Many`;

    let res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      body: JSON.stringify(batchBody),
      agent,
    });

    if (res.status === 401) {
      console.log("[Stock Batch] Session expired, re-logging in...");
      session = await client.login();
      res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": session,
        },
        body: JSON.stringify(batchBody),
        agent,
      });
    }

    if (res.status !== 200) {
      const errorText = await res.text();
      console.error(`[Stock Batch] Monitor API error: ${res.status} ${errorText}`);
      return json({
        error: "Monitor API error",
        stock: items.map(i => ({ monitorId: i.monitorId, variantId: i.variantId, warehouses: {}, total: 0 })),
      }, { status: 200, headers: corsHeaders() });
    }

    const balances = await res.json();

    // Build a map: monitorId → { warehouseName: balance }
    const stockMap = {};
    if (Array.isArray(balances)) {
      balances.forEach(b => {
        const partId = b.PartId;
        const whName = WAREHOUSE_NAMES[b.WarehouseId];
        if (!whName) return;

        if (!stockMap[partId]) stockMap[partId] = {};
        stockMap[partId][whName] = b.AvailableBalance || 0;
      });
    }

    // Map back to original items
    const stock = items.map(item => {
      const warehouses = stockMap[item.monitorId] || {};
      const total = Object.values(warehouses).reduce((sum, v) => sum + v, 0);
      return {
        monitorId: item.monitorId,
        variantId: item.variantId,
        warehouses,
        total,
      };
    });

    console.log(`[Stock Batch] Returned stock for ${stock.length} items`);

    return json({ stock }, { headers: corsHeaders() });

  } catch (error) {
    console.error("[Stock Batch] Error:", error);
    return json({ error: "Internal server error", details: error.message }, {
      status: 500,
      headers: corsHeaders(),
    });
  }
}
