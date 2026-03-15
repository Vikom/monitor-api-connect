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

// Warehouse mapping (same as syncInventoryJob.js)
const WAREHOUSE_METAFIELD_MAPPING = {
  '933124852911871989': 'custom.stock_vittsjo',
  '933124156053429919': 'custom.stock_ronas',
  '1189106270728482943': 'custom.stock_lund',
  '933126667535575191': 'custom.stock_sundsvall',
  '933125224426542349': 'custom.stock_goteborg',
  '933126074830088482': 'custom.stock_stockholm'
};

const WAREHOUSE_JSON_MAPPING = {
  '933124852911871989': 'vittsjo',
  '933124156053429919': 'ronas',
  '1189106270728482943': 'lund',
  '933126667535575191': 'sundsvall',
  '933125224426542349': 'goteborg',
  '933126074830088482': 'stockholm'
};

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
  if (!monitorUrl || !monitorUsername || !monitorPassword || !monitorCompany) {
    throw new Error('Missing Monitor API environment variables');
  }

  const url = `${monitorUrl}/${monitorCompany}/login`;
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
    console.error(`[Stock Update] Monitor login failed: ${res.status} ${errorText}`);
    throw new Error(`Monitor login failed: ${res.status}`);
  }

  const newSessionId = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
  await res.json(); // consume body

  if (!newSessionId) {
    throw new Error('No session ID returned from Monitor API');
  }

  sessionId = newSessionId;
  return sessionId;
}

// Get or refresh session ID
async function getSessionId() {
  if (!sessionId) {
    sessionId = await login();
  }
  return sessionId;
}

// Call Monitor GetPartBalanceInfo for a specific warehouse
async function getPartBalance(partId, warehouseId, session) {
  const url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts/GetPartBalanceInfo`;

  // BalanceDate = today + 14 days
  const balanceDate = new Date();
  balanceDate.setDate(balanceDate.getDate() + 14);
  const balanceDateStr = balanceDate.toISOString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Monitor-SessionId": session,
    },
    body: JSON.stringify({
      PartId: partId,
      WarehouseId: warehouseId,
      BalanceDate: balanceDateStr,
    }),
    agent,
  });

  return res;
}

// Determine stock status from stock data and stock control
function determineStockStatus(stockData, stockControlJson) {
  const hasStockInAnyLocation = Object.entries(stockData).some(([warehouseId, stock]) => {
    return WAREHOUSE_METAFIELD_MAPPING[warehouseId] && stock > 0;
  });

  if (hasStockInAnyLocation) {
    return 'I lager';
  }

  const hasOrderLocation = Object.values(stockControlJson).some(v => v === 'order');
  if (hasOrderLocation) {
    return 'Beställningsvara';
  }

  return '';
}

// Get Shopify access token
async function getShopifyAccessToken(shop) {
  const advancedStoreDomain = process.env.ADVANCED_STORE_DOMAIN;
  if (shop === advancedStoreDomain && process.env.ADVANCED_STORE_ADMIN_TOKEN) {
    return process.env.ADVANCED_STORE_ADMIN_TOKEN;
  }

  try {
    const { sessionStorage } = await import("../shopify.server.js");
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions && sessions.length > 0 && sessions[0].accessToken) {
      return sessions[0].accessToken;
    }
  } catch (e) {
    console.log(`[Stock Update] Could not find session for shop ${shop}:`, e.message);
  }

  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ACCESS_TOKEN;
  }

  return null;
}

// Update variant metafields in Shopify (same fields as syncInventoryJob)
async function updateShopifyMetafields(shop, accessToken, variantId, stockData) {
  const metafields = [];

  // Stock per warehouse
  for (const [warehouseId, metafieldKey] of Object.entries(WAREHOUSE_METAFIELD_MAPPING)) {
    const stock = stockData[warehouseId] || 0;
    const [namespace, key] = metafieldKey.split('.');
    metafields.push({
      ownerId: variantId,
      namespace,
      key,
      value: stock.toString(),
      type: "number_decimal"
    });
  }

  // Fetch existing stock_control from Shopify so we can compute stock_status correctly
  let stockControlJson = {};
  try {
    const queryRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `query ($id: ID!) {
          productVariant(id: $id) {
            metafield(namespace: "custom", key: "stock_control") { value }
          }
        }`,
        variables: { id: variantId }
      }),
    });
    const queryData = await queryRes.json();
    const controlValue = queryData.data?.productVariant?.metafield?.value;
    if (controlValue) {
      stockControlJson = JSON.parse(controlValue);
    }
  } catch (e) {
    console.log(`[Stock Update] Could not fetch stock_control, using empty:`, e.message);
  }

  // Stock status
  const stockStatus = determineStockStatus(stockData, stockControlJson);
  metafields.push({
    ownerId: variantId,
    namespace: "custom",
    key: "stock_status",
    value: stockStatus,
    type: "single_line_text_field"
  });

  const mutation = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key value }
      userErrors { field message }
    }
  }`;

  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables: { metafields } }),
  });

  const result = await response.json();

  if (result.errors) {
    console.error("[Stock Update] GraphQL errors:", JSON.stringify(result.errors));
    return false;
  }
  if (result.data?.metafieldsSet?.userErrors?.length > 0) {
    console.error("[Stock Update] User errors:", result.data.metafieldsSet.userErrors);
    return false;
  }

  return true;
}

// Handle OPTIONS request for CORS preflight
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
    const { monitorId, variantId, shop } = body;

    if (!monitorId) {
      return json({ error: "monitorId is required" }, { status: 400, headers: corsHeaders() });
    }

    if (!monitorUrl || !monitorUsername || !monitorCompany) {
      return json({ error: "Monitor API not configured" }, { status: 500, headers: corsHeaders() });
    }

    let session = await getSessionId();
    const warehouseIds = Object.keys(WAREHOUSE_METAFIELD_MAPPING);
    const stockData = {};

    // Test session with first warehouse, re-login if needed
    const firstRes = await getPartBalance(monitorId, warehouseIds[0], session);
    if (firstRes.status === 401) {
      sessionId = null;
      session = await login();
    }

    // Fetch balance for each warehouse in parallel (session is now valid)
    const balancePromises = warehouseIds.map(async (warehouseId) => {
      const res = await getPartBalance(monitorId, warehouseId, session);

      if (res.status === 200) {
        const data = await res.json();
        stockData[warehouseId] = data.AvailableBalance || 0;
      } else {
        const errorText = await res.text();
        console.error(`[Stock Update] GetPartBalanceInfo failed for warehouse ${warehouseId}: ${res.status} ${errorText}`);
        stockData[warehouseId] = 0;
      }
    });

    await Promise.all(balancePromises);

    console.log(`[Stock Update] Balance for part ${monitorId}:`, stockData);

    // Build response with warehouse names for display
    const stockByName = {};
    for (const [warehouseId, balance] of Object.entries(stockData)) {
      const name = WAREHOUSE_JSON_MAPPING[warehouseId];
      if (name) {
        stockByName[name] = balance;
      }
    }

    // Update Shopify metafields if we have shop and variantId
    let shopifyUpdated = false;
    if (shop && variantId) {
      const accessToken = await getShopifyAccessToken(shop);
      if (accessToken) {
        shopifyUpdated = await updateShopifyMetafields(shop, accessToken, variantId, stockData);
        if (shopifyUpdated) {
          console.log(`[Stock Update] Shopify metafields updated for variant ${variantId}`);
        }
      } else {
        console.error(`[Stock Update] No access token for shop ${shop}`);
      }
    }

    return json({
      stock: stockByName,
      shopifyUpdated,
    }, { headers: corsHeaders() });

  } catch (error) {
    console.error("[Stock Update] Error:", error);
    return json({ error: "Internal server error", details: error.message }, {
      status: 500,
      headers: corsHeaders()
    });
  }
}
