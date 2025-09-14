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

// Unit mapping from Monitor API
const UNIT_MAPPING = {
    "896454559822157228": { "Code": "st", "Description": "Styck", "Number": "1" },
    "896454559822157331": { "Code": "mm", "Description": "Millimeter", "Number": "4" },
    "896454559822157366": { "Code": "m²", "Description": "Kvadratmeter", "Number": "5" },
    "896454559822157389": { "Code": "kg", "Description": "Kilo", "Number": "2" },
    "896454559822157424": { "Code": "m", "Description": "Meter", "Number": "3" },
    "964635041975763896": { "Code": "m³", "Description": "Kubikmeter", "Number": "6" },
    "989630543418881598": { "Code": "h", "Description": "Timme", "Number": "7" },
    "1066716939765765413": { "Code": "frp", "Description": "Förpackning", "Number": "8" },
    "1067959871794544563": { "Code": "l", "Description": "Liter", "Number": "9" },
    "1068890724534919021": { "Code": "rle", "Description": "Rulle", "Number": "10" },
    "1068891474006718462": { "Code": "pal", "Description": "Pall", "Number": "11" },
    "1069043501891593759": { "Code": "pkt", "Description": "Paket", "Number": "12" },
    "1069043554504943125": { "Code": "krt", "Description": "Kartong", "Number": "13" },
    "1069043662952867563": { "Code": "pås", "Description": "Påse", "Number": "14" },
    "1069044050573666032": { "Code": "Sk", "Description": "Säck", "Number": "15" }
};

// Helper function to get unit code from unit ID
function getUnitCode(unitId) {
    const unit = UNIT_MAPPING[unitId];
    return unit ? unit.Code : 'st'; // Default to 'st' if unit not found
}

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
    // Validate environment variables
    if (!monitorUrl || !monitorUsername || !monitorPassword || !monitorCompany) {
      console.error('Missing Monitor API credentials:', {
        hasUrl: !!monitorUrl,
        hasUser: !!monitorUsername,
        hasPass: !!monitorPassword,
        hasCompany: !!monitorCompany
      });
      throw new Error('Missing Monitor API environment variables');
    }
    
    const url = `${monitorUrl}/${monitorCompany}/login`;
    console.log(`Attempting Monitor API login to: ${url} with user: ${monitorUsername}`);
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        Username: monitorUsername,  // Fixed: was UserName, should be Username
        Password: monitorPassword,
        ForceRelogin: true,  // Added to force fresh login
      }),
      agent,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Monitor login failed: ${res.status} ${res.statusText}`);
      console.error(`Login error response: ${errorText}`);
      throw new Error(`Monitor login failed: ${res.status} - ${errorText}`);
    }

    // Get session ID from response header (like monitor.js), with fallback to body
    let sessionIdFromHeader = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
    const data = await res.json();
    
    // Try header first, then body (for compatibility)
    const receivedSessionId = sessionIdFromHeader || data.SessionId;
    
    if (!receivedSessionId) {
      console.error(`No SessionId in header or body. Headers: ${JSON.stringify([...res.headers])}, Body:`, data);
      throw new Error('No SessionId received from Monitor API');
    }
    
    console.log(`Monitor API login successful, SessionId: ${receivedSessionId.substring(0, 8)}...`);
    console.log(`SessionId source: ${sessionIdFromHeader ? 'header' : 'body'}`);
    sessionId = receivedSessionId;
    return sessionId;
  } catch (error) {
    console.error('Monitor API login error:', error);
    sessionId = null; // Clear any stale session
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

// Fetch customer-specific price for a part
// Fetch customer's price list ID
async function fetchCustomerPriceListId(customerId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers`;
    url += `?$filter=Id eq '${customerId}'`;
    
    console.log(`Fetching customer details for customer ${customerId} to get price list ID`);
    
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
      // Session expired, force re-login and retry
      console.log(`Session expired for customer lookup, re-logging in...`);
      sessionId = null; // Clear the session
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
      console.error(`Failed to fetch customer details for ${customerId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return null;
    }
    
    const customers = await res.json();
    console.log(`Customer lookup API response for ${customerId}:`, customers);
    
    if (!Array.isArray(customers)) {
      console.log(`Customer lookup response is not an array`);
      return null;
    }
    
    if (customers.length > 0) {
      const priceListId = customers[0].PriceListId;
      console.log(`Found customer price list ID: ${priceListId}`);
      return priceListId;
    } else {
      console.log(`No customer found with ID ${customerId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching customer price list ID for ${customerId}:`, error);
    return null;
  }
}

// Fetch price from a specific price list
async function fetchPriceFromPriceList(partId, priceListId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '${priceListId}'`;
    
    console.log(`Fetching price for part ${partId} from price list ${priceListId}`);
    
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
      // Session expired, force re-login and retry
      console.log(`Session expired for price list fetch, re-logging in...`);
      sessionId = null; // Clear the session
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
      console.error(`Failed to fetch price for part ${partId} from price list ${priceListId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return null;
    }
    
    const prices = await res.json();
    console.log(`Price list API response for part ${partId}, price list ${priceListId}:`, prices);
    
    if (!Array.isArray(prices)) {
      console.log(`Price list response is not an array`);
      return null;
    }
    
    if (prices.length > 0) {
      console.log(`Found price in price list: ${prices[0].Price}`);
      return prices[0].Price;
    } else {
      console.log(`No price found for part ${partId} in price list ${priceListId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching price from price list for part ${partId}, price list ${priceListId}:`, error);
    return null;
  }
}

// Fetch part details to get StandardUnitId
async function fetchPartDetails(partId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Parts`;
    url += `?$filter=Id eq '${partId}'`;
    
    console.log(`Fetching part details for part ${partId} to get StandardUnitId`);
    
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
      // Session expired, force re-login and retry
      console.log(`Session expired for part details fetch, re-logging in...`);
      sessionId = null; // Clear the session
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
      console.error(`Failed to fetch part details for ${partId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return null;
    }
    
    const parts = await res.json();
    console.log(`Part details API response for ${partId}:`, parts);
    
    if (!Array.isArray(parts)) {
      console.log(`Part details response is not an array`);
      return null;
    }
    
    if (parts.length > 0) {
      const standardUnitId = parts[0].StandardUnitId;
      console.log(`Found part StandardUnitId: ${standardUnitId}`);
      return { standardUnitId };
    } else {
      console.log(`No part found with ID ${partId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching part details for ${partId}:`, error);
    return null;
  }
}

// Fetch customer-specific price with unit information and fallback to customer's price list
async function fetchCustomerPartPriceWithUnit(customerId, partId) {
  try {
    // Step 1: Check for specific customer-part price using CustomerPartLinks
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartLinks`;
    url += `?$filter=CustomerId eq '${customerId}' and PartId eq '${partId}'`;
    
    console.log(`Step 1: Checking for specific customer-part price for customer ${customerId}, part ${partId}`);
    
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
      // Session expired, force re-login and retry
      console.log(`Session expired for customer part links fetch, re-logging in...`);
      sessionId = null; // Clear the session
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
      console.error(`Failed to fetch customer part links for customer ${customerId}, part ${partId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return { price: null, unitCode: 'st' };
    }
    
    const customerPartLinks = await res.json();
    console.log(`Customer part links API response for customer ${customerId}, part ${partId}:`, customerPartLinks);
    
    if (Array.isArray(customerPartLinks) && customerPartLinks.length > 0) {
      // Found specific customer-part price with UnitId
      const specificPrice = customerPartLinks[0].Price;
      const unitId = customerPartLinks[0].UnitId;
      const unitCode = getUnitCode(unitId);
      console.log(`Step 1 SUCCESS: Found specific customer-part price: ${specificPrice}, unitId: ${unitId}, unitCode: ${unitCode}`);
      return { price: specificPrice, unitCode };
    } else {
      console.log(`Step 1: No specific customer-part price found, proceeding to customer's price list...`);
      
      // Step 2: Get customer's price list ID
      const priceListId = await fetchCustomerPriceListId(customerId);
      
      if (!priceListId) {
        console.log(`Step 2 FAILED: Could not get customer's price list ID`);
        // Try to get part's standard unit
        const partDetails = await fetchPartDetails(partId);
        const unitCode = partDetails?.standardUnitId ? getUnitCode(partDetails.standardUnitId) : 'st';
        return { price: null, unitCode };
      }
      
      console.log(`Step 2: Customer's price list ID: ${priceListId}`);
      
      // Step 3: Get price from customer's price list
      const priceListPrice = await fetchPriceFromPriceList(partId, priceListId);
      
      if (priceListPrice !== null && priceListPrice > 0) {
        console.log(`Step 3 SUCCESS: Found price in customer's price list: ${priceListPrice}`);
        // For price list prices, use the part's standard unit
        const partDetails = await fetchPartDetails(partId);
        const unitCode = partDetails?.standardUnitId ? getUnitCode(partDetails.standardUnitId) : 'st';
        console.log(`Using part's standard unit: ${unitCode}`);
        return { price: priceListPrice, unitCode };
      } else {
        console.log(`Step 3 FAILED: No price found in customer's price list ${priceListId}`);
        // Still try to get the unit even if no price found
        const partDetails = await fetchPartDetails(partId);
        const unitCode = partDetails?.standardUnitId ? getUnitCode(partDetails.standardUnitId) : 'st';
        return { price: null, unitCode };
      }
    }
  } catch (error) {
    console.error(`Error fetching customer part price with unit for customer ${customerId}, part ${partId}:`, error);
    return { price: null, unitCode: 'st' };
  }
}

// Fetch customer-specific price with fallback to customer's price list (legacy function for compatibility)
async function fetchCustomerPartPrice(customerId, partId) {
  const result = await fetchCustomerPartPriceWithUnit(customerId, partId);
  return result.price;
}

// Fetch outlet price for a part
async function fetchOutletPrice(partId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '${OUTLET_PRICE_LIST_ID}'`;
    
    console.log(`Fetching outlet price for part ${partId} from price list ${OUTLET_PRICE_LIST_ID}`);
    console.log(`API URL: ${url}`);
    console.log(`Using session: ${session?.substring(0, 8)}...`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent,
    });
    
    console.log(`Initial response status: ${res.status}`);
    
    if (res.status === 401) {
      console.log(`Session expired, but let's see the error first...`);
      const errorText = await res.text();
      console.log(`401 Error response: ${errorText}`);
      
      // Session expired, force re-login and retry ONCE
      console.log(`Forcing fresh login...`);
      sessionId = null; // Clear the session
      try {
        session = await login(); // Force fresh login
        console.log(`Re-login successful, new session: ${session?.substring(0, 8)}...`);
        
        res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Monitor-SessionId": session,
          },
          agent,
        });
        
        console.log(`Retry response status: ${res.status}`);
      } catch (loginError) {
        console.error(`Re-login failed:`, loginError);
        return null;
      }
    }
    
    if (res.status !== 200) {
      console.error(`Failed to fetch outlet price for ${partId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Final error response: ${errorText}`);
      return null;
    }
    
    const prices = await res.json();
    console.log(`Outlet price API response for ${partId}:`, Array.isArray(prices) ? `Array with ${prices.length} items` : prices);
    
    if (!Array.isArray(prices)) {
      console.log(`Outlet price response is not an array for ${partId}`);
      return null;
    }
    
    if (prices.length > 0) {
      console.log(`Found outlet price for ${partId}: ${prices[0].Price}`);
      return prices[0].Price;
    } else {
      console.log(`No outlet prices found for ${partId} in price list ${OUTLET_PRICE_LIST_ID}`);
      
      // DEBUG: Let's check what price lists exist for this part
      console.log(`DEBUG: Checking if part ${partId} exists in other price lists...`);
      try {
        const allPricesUrl = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices?$filter=PartId eq '${partId}'&$top=5`;
        const allPricesRes = await fetch(allPricesUrl, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Monitor-SessionId": session,
          },
          agent,
        });
        
        if (allPricesRes.ok) {
          const allPrices = await allPricesRes.json();
          console.log(`DEBUG: Found ${allPrices.length} price(s) for part ${partId} in any price list:`);
          allPrices.forEach((price, index) => {
            console.log(`  ${index + 1}. Price: ${price.Price}, PriceList: ${price.PriceListId}, Currency: ${price.CurrencyCode}`);
          });
        } else {
          console.log(`DEBUG: Failed to check all prices for ${partId}: ${allPricesRes.status}`);
        }
      } catch (debugError) {
        console.log(`DEBUG: Error checking all prices:`, debugError.message);
      }
      
      return null;
    }
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

// Fetch metafields from Shopify Admin API
async function fetchShopifyMetafields(shop, variantId, customerId) {
  try {
    console.log(`Fetching metafields for variant ${variantId}, customer ${customerId}, shop ${shop}`);
    
    // Dynamic import to avoid build issues - only import on server side
    const { sessionStorage } = await import("../shopify.server.js");
    
    // Try to get a session for the shop
    let session = null;
    try {
      console.log(`Attempting to find sessions for shop: ${shop}`);
      const sessions = await sessionStorage.findSessionsByShop(shop);
      console.log(`Sessions found:`, sessions ? sessions.length : 0);
      if (sessions && sessions.length > 0) {
        session = sessions[0];
        console.log(`Found session for shop ${shop}:`, {
          id: session.id,
          shop: session.shop,
          hasAccessToken: !!session.accessToken,
          isOnline: session.isOnline,
          scope: session.scope
        });
      }
    } catch (sessionError) {
      console.error(`Error finding session for shop ${shop}:`, sessionError);
    }
    
    if (!session || !session.accessToken) {
      console.error(`No valid session found for shop ${shop}`);
      // Try a different approach - use REST API with basic auth if available
      return await fetchMetafieldsViaRest(shop, variantId, customerId);
    }
    
    // Use the session's access token for API calls
    const adminUrl = `https://${shop}/admin/api/2025-01/graphql.json`;
    
    const variantGid = variantId; // Already in GID format
    const customerGid = customerId; // Already in GID format
    
    const query = `
      query GetMetafields($variantId: ID!, $customerId: ID!) {
        productVariant(id: $variantId) {
          id
          metafield(namespace: "monitor", key: "id") {
            value
          }
          product {
            id
            collections(first: 10) {
              edges {
                node {
                  handle
                  title
                }
              }
            }
            tags
          }
        }
        customer(id: $customerId) {
          id
          metafield(namespace: "monitor", key: "id") {
            value
          }
        }
      }
    `;
    
    const response = await fetch(adminUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({
        query,
        variables: { variantId: variantGid, customerId: customerGid }
      })
    });
    
    if (!response.ok) {
      console.error(`Shopify API request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`Error response:`, errorText);
      return { monitorId: null, isOutletProduct: null, customerMonitorId: null };
    }
    
    const data = await response.json();
    console.log(`Shopify API response:`, JSON.stringify(data, null, 2));
    
    if (data.errors) {
      console.error(`Shopify API errors:`, data.errors);
      return { monitorId: null, isOutletProduct: null, customerMonitorId: null };
    }
    
    // Extract metafields
    const variant = data.data?.productVariant;
    const customer = data.data?.customer;
    
    let monitorId = null;
    let isOutletProduct = false;
    let customerMonitorId = null;
    
    // Get variant Monitor ID
    if (variant?.metafield?.value) {
      monitorId = variant.metafield.value;
    }
    
    // Check if product is in outlet collection
    if (variant?.product) {
      // Check tags first
      if (variant.product.tags && variant.product.tags.includes('outlet')) {
        isOutletProduct = true;
      }
      
      // Check collections
      if (variant.product.collections?.edges) {
        const hasOutletCollection = variant.product.collections.edges.some(edge => 
          edge.node.handle === 'outlet' || 
          edge.node.title.toLowerCase().includes('outlet')
        );
        if (hasOutletCollection) {
          isOutletProduct = true;
        }
      }
    }
    
    // Get customer Monitor ID
    if (customer?.metafield?.value) {
      customerMonitorId = customer.metafield.value;
    }
    
    console.log(`Extracted metafields:`, { monitorId, isOutletProduct, customerMonitorId });
    
    return { monitorId, isOutletProduct, customerMonitorId };
    
  } catch (error) {
    console.error(`Error fetching Shopify metafields:`, error);
    return { monitorId: null, isOutletProduct: null, customerMonitorId: null };
  }
}

// Fallback method using REST API - for when we don't have GraphQL session
async function fetchMetafieldsViaRest(shop, variantId, customerId) {
  try {
    console.log(`Attempting REST API fallback for metafields`);
    
    // Extract numeric IDs from GIDs
    const variantNumericId = variantId.split('/').pop();
    const customerNumericId = customerId.split('/').pop();
    
    console.log(`Extracted IDs - Variant: ${variantNumericId}, Customer: ${customerNumericId}`);
    
    // For now, return null values but with logging so we can see this path is taken
    console.log(`REST API fallback not yet implemented - would need admin API credentials`);
    
    return { monitorId: null, isOutletProduct: null, customerMonitorId: null };
    
  } catch (error) {
    console.error(`Error in REST API fallback:`, error);
    return { monitorId: null, isOutletProduct: null, customerMonitorId: null };
  }
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
    let { variantId, customerId, shop, monitorId, isOutletProduct, customerMonitorId, fetchMetafields, productHandle } = body;

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

    // Simple outlet detection based on product handle
    if (productHandle && !isOutletProduct) {
      // Check if the product handle indicates it's an outlet product
      const outletKeywords = ['outlet', 'rea', 'sale', 'clearance', 'discontinued'];
      const isHandleOutlet = outletKeywords.some(keyword => 
        productHandle.toLowerCase().includes(keyword)
      );
      
      if (isHandleOutlet) {
        isOutletProduct = true;
        console.log(`Detected outlet product based on handle: ${productHandle}`);
      }
    }

    // If fetchMetafields is true, get metafields from Shopify Admin API
    if (fetchMetafields === true) {
      console.log(`Fetching metafields from Shopify Admin API for cart context`);
      try {
        const metafields = await fetchShopifyMetafields(shop, variantId, customerId);
        monitorId = metafields.monitorId;
        if (metafields.isOutletProduct !== null) {
          isOutletProduct = metafields.isOutletProduct;
        }
        customerMonitorId = metafields.customerMonitorId;
        console.log(`Fetched metafields result:`, metafields);
      } catch (metafieldsError) {
        console.error(`Error in fetchShopifyMetafields:`, metafieldsError);
        // Continue with null values
      }
    }

    console.log(`Processing pricing request for variant ${variantId}, customer ${customerId}`);
    console.log(`Monitor ID: ${monitorId}, Is outlet product: ${isOutletProduct}, Customer Monitor ID: ${customerMonitorId}`);
    console.log(`Monitor env check: URL=${!!monitorUrl}, USER=${!!monitorUsername}, COMPANY=${!!monitorCompany}`);

    let price = 299.99; // Default test price
    let priceSource = "test";
    let unitCode = "st"; // Default unit
    
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
          unitCode = "st"; // Default unit for outlet fallback
        } else {
          console.log(`Outlet product without Monitor ID - using fallback price 100.00`);
          price = 100.00;
          priceSource = "outlet-fallback";
          unitCode = "st"; // Default unit for outlet fallback
        }
      } else {
        // Not an outlet product - check for customer-specific pricing if we have both IDs
        if (customerMonitorId && monitorId) {
          console.log(`Non-outlet product with customer Monitor ID ${customerMonitorId} and part ID ${monitorId} - using fallback price (API not configured)`);
          price = 250.00; // Mock customer-specific price for testing
          priceSource = "customer-fallback-no-api";
          unitCode = "st"; // Default unit for customer fallback
        } else {
          console.log(`Not an outlet product, using test price: ${price}`);
          unitCode = "st"; // Default unit for test price
        }
      }
    } else {
      // Monitor API is configured, try to fetch real prices with hierarchy
      
      // 1. First check if it's an outlet product
      if (isOutletProduct && monitorId) {
        console.log(`Product is in outlet collection, fetching outlet price for Monitor ID: ${monitorId}`);
        const outletPrice = await fetchOutletPrice(monitorId);
        
        if (outletPrice !== null && outletPrice > 0) {
          price = outletPrice;
          priceSource = "outlet";
          // For outlet products, try to get the part's standard unit
          const partDetails = await fetchPartDetails(monitorId);
          unitCode = partDetails?.standardUnitId ? getUnitCode(partDetails.standardUnitId) : 'st';
          console.log(`Found outlet price: ${outletPrice}, unit: ${unitCode}`);
        } else {
          // No outlet price found or empty array, set to 100.00 as requested
          price = 100.00;
          priceSource = "outlet-fallback";
          unitCode = "st"; // Default unit for outlet fallback
          console.log(`No outlet price found (empty array or null), using fallback price: 100.00, unit: ${unitCode}`);
        }
      } else if (isOutletProduct && !monitorId) {
        // Outlet product but no monitor ID - use fallback
        price = 100.00;
        priceSource = "outlet-fallback";
        unitCode = "st"; // Default unit for outlet fallback
        console.log(`Outlet product but no Monitor ID, using fallback price: 100.00, unit: ${unitCode}`);
      } else {
        // 2. Not an outlet product - check for customer-specific pricing
        if (customerMonitorId && monitorId) {
          console.log(`Checking customer-specific price with unit for customer ${customerMonitorId}, part ${monitorId}`);
          const customerPriceResult = await fetchCustomerPartPriceWithUnit(customerMonitorId, monitorId);
          
          if (customerPriceResult.price !== null && customerPriceResult.price > 0) {
            price = customerPriceResult.price;
            unitCode = customerPriceResult.unitCode;
            priceSource = "customer-specific";
            console.log(`Found customer-specific price: ${customerPriceResult.price}, unit: ${customerPriceResult.unitCode}`);
          } else {
            console.log(`No customer-specific price found, using test price: ${price}`);
            // Still use the unit even if no price found
            unitCode = customerPriceResult.unitCode;
          }
        } else {
          console.log(`Missing customer Monitor ID (${customerMonitorId}) or part Monitor ID (${monitorId}), using test price: ${price}`);
          unitCode = "st"; // Default unit when missing IDs
        }
      }
    }
    
    return json({ 
      price: price,
      unitCode: unitCode,
      metadata: {
        variantId,
        customerId,
        shop,
        monitorPartId: monitorId || null,
        customerMonitorId: customerMonitorId || null,
        isOutletProduct: isOutletProduct || false,
        priceSource: priceSource,
        unitCode: unitCode,
        message: `${priceSource === 'outlet' ? 'Real outlet pricing' : 
                   priceSource === 'outlet-fallback' ? 'Outlet fallback pricing' : 
                   priceSource === 'customer-specific' ? 'Customer-specific pricing' :
                   priceSource === 'customer-fallback-no-api' ? 'Customer fallback pricing (API not configured)' :
                   'Test pricing'} - CORS working with unit: ${unitCode}`
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
