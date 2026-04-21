import { json } from "@remix-run/node";
import https from "https";

const agent = new https.Agent({ rejectUnauthorized: false });
const monitorUrl = process.env.MONITOR_URL;
const monitorCompany = process.env.MONITOR_COMPANY;
const ADMIN_KEY = process.env.CUSTOMER_LOOKUP_API_KEY;

let _client = null;
async function getClient() {
  if (!_client) {
    const { MonitorClient } = await import("../utils/monitor.server.js");
    _client = new MonitorClient();
  }
  return _client;
}

const WAREHOUSES = [
  '933124852911871989',  // vittsjo
  '933124156053429919',  // ronas
  '1189106270728482943', // lund
  '933126667535575191',  // sundsvall
  '933125224426542349',  // goteborg
  '933126074830088482',  // stockholm
];

export async function loader({ request }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const partId = url.searchParams.get("partId") || "993251287007716624";

  const client = await getClient();
  let session = await client.getSessionId();

  const balanceDate = new Date();
  balanceDate.setDate(balanceDate.getDate() + 14);

  const results = {};

  // Test 1: Try GetPartBalanceInfo/Many (batch)
  try {
    const manyUrl = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts/GetPartBalanceInfo/Many`;
    const batchBody = WAREHOUSES.map(wId => ({
      PartId: partId,
      WarehouseId: wId,
      BalanceDate: balanceDate.toISOString(),
      ActualOrdersTransactionType: 16352,
    }));

    const t0 = Date.now();
    let res = await fetch(manyUrl, {
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
      await client.login();
      session = await client.getSessionId();
      res = await fetch(manyUrl, {
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

    const t1 = Date.now();
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 500); }

    results.batchMany = {
      status: res.status,
      timeMs: t1 - t0,
      data,
    };
  } catch (err) {
    results.batchMany = { error: err.message };
  }

  // Test 2: Try OData Inventory/Parts with PartLocations expand
  try {
    const odataUrl = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts?$filter=Id eq '${partId}'&$expand=PartLocations&$select=Id,PartNumber`;

    const t0 = Date.now();
    let res = await fetch(odataUrl, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": session,
      },
      agent,
    });

    if (res.status === 401) {
      await client.login();
      session = await client.getSessionId();
      res = await fetch(odataUrl, {
        headers: {
          Accept: "application/json",
          "X-Monitor-SessionId": session,
        },
        agent,
      });
    }

    const t1 = Date.now();
    const data = await res.json();

    results.odataPartLocations = {
      status: res.status,
      timeMs: t1 - t0,
      data,
    };
  } catch (err) {
    results.odataPartLocations = { error: err.message };
  }

  // Test 3: Current approach - 6 individual calls (for comparison)
  try {
    const t0 = Date.now();
    const singleUrl = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts/GetPartBalanceInfo`;

    const promises = WAREHOUSES.map(wId =>
      fetch(singleUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": session,
        },
        body: JSON.stringify({
          PartId: partId,
          WarehouseId: wId,
          BalanceDate: balanceDate.toISOString(),
          ActualOrdersTransactionType: 16352,
        }),
        agent,
      }).then(r => r.json()).catch(e => ({ error: e.message }))
    );

    const balances = await Promise.all(promises);
    const t1 = Date.now();

    results.individual6calls = {
      timeMs: t1 - t0,
      balances,
    };
  } catch (err) {
    results.individual6calls = { error: err.message };
  }

  return json(results);
}
