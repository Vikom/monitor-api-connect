import { json } from "@remix-run/node";
import https from "https";

// Monitor API configuration
const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

// Constants
// const OUTLET_PRICE_LIST_ID = "1289997006982727753";

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
          unitIdMetafield: metafield(namespace: "custom", key: "unitid") {
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
    let standardUnitId = null;
    
    // Get variant Monitor ID
    if (variant?.metafield?.value) {
      monitorId = variant.metafield.value;
    }
    
    // Get StandardUnitId from unitid metafield
    if (variant?.unitIdMetafield?.value) {
      standardUnitId = variant.unitIdMetafield.value;
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
    
    console.log(`Extracted metafields:`, { monitorId, isOutletProduct, customerMonitorId, standardUnitId });
    
    return { monitorId, isOutletProduct, customerMonitorId, standardUnitId };
    
  } catch (error) {
    console.error(`Error fetching Shopify metafields:`, error);
    return { monitorId: null, isOutletProduct: null, customerMonitorId: null, standardUnitId: null };
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
    
    return { monitorId: null, isOutletProduct: null, customerMonitorId: null, standardUnitId: null };
    
  } catch (error) {
    console.error(`Error in REST API fallback:`, error);
    return { monitorId: null, isOutletProduct: null, customerMonitorId: null };
  }
}

// Update variant metafield in Shopify
async function updateVariantMetafield(shop, variantId, namespace, key, value) {
  try {
    let accessToken = null;
    
    // Strategy 1: Try to find an existing session
    try {
      const { sessionStorage } = await import("../shopify.server.js");
      const sessions = await sessionStorage.findSessionsByShop(shop);
      if (sessions && sessions.length > 0 && sessions[0].accessToken) {
        accessToken = sessions[0].accessToken;
        console.log(`Using session token for shop ${shop}`);
      }
    } catch (sessionError) {
      console.log(`Could not find session for shop ${shop}:`, sessionError.message);
    }
    
    // Strategy 2: Fall back to environment variable admin tokens
    if (!accessToken) {
      // Check if this is the advanced store or use generic token
      const advancedStoreDomain = process.env.ADVANCED_STORE_DOMAIN;
      if (shop === advancedStoreDomain && process.env.ADVANCED_STORE_ADMIN_TOKEN) {
        accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;
        console.log(`Using ADVANCED_STORE_ADMIN_TOKEN for shop ${shop}`);
      } else if (process.env.SHOPIFY_ACCESS_TOKEN) {
        accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
        console.log(`Using SHOPIFY_ACCESS_TOKEN for shop ${shop}`);
      }
    }
    
    if (!accessToken) {
      console.error(`No access token available for shop ${shop} - cannot update metafield`);
      return false;
    }
    
    const adminUrl = `https://${shop}/admin/api/2025-01/graphql.json`;
    const variantGid = variantId; // Already in GID format
    
    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      metafields: [{
        ownerId: variantGid,
        namespace: namespace,
        key: key,
        value: value,
        type: "single_line_text_field"
      }]
    };
    
    const response = await fetch(adminUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: mutation, variables })
    });
    
    if (!response.ok) {
      console.error(`Shopify metafield update failed: ${response.status} ${response.statusText}`);
      return false;
    }
    
    const data = await response.json();
    
    if (data.errors) {
      console.error(`Shopify metafield update GraphQL errors:`, data.errors);
      return false;
    }
    
    if (data.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error(`Shopify metafield update user errors:`, data.data.metafieldsSet.userErrors);
      return false;
    }
    
    console.log(`✅ Successfully updated metafield ${namespace}.${key} for variant ${variantGid}`);
    return true;
    
  } catch (error) {
    console.error(`Error updating variant metafield:`, error);
    return false;
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
    let { variantId, customerId, shop, monitorId, isOutletProduct, customerMonitorId, customerDiscountCategory, customerPriceListId, fetchMetafields, partCodeId, standardUnitId } = body;

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

    // Note: Outlet product detection is handled via Shopify collections/tags in fetchShopifyMetafields

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

    // Fetch StandardUnitId from Monitor API if not provided
    if (!standardUnitId && monitorId) {
      console.log(`⚠️ StandardUnitId missing for ${monitorId}, fetching from Monitor API...`);
      try {
        const { fetchPartStandardUnitId } = await import("../utils/monitor.server.js");
        standardUnitId = await fetchPartStandardUnitId(monitorId);
        if (standardUnitId) {
          console.log(`✅ Fetched StandardUnitId for ${monitorId}: ${standardUnitId}`);
          
          // Store the fetched standardUnitId back to Shopify metafield
          if (shop && variantId) {
            console.log(`📝 Storing StandardUnitId to Shopify metafield...`);
            const updated = await updateVariantMetafield(shop, variantId, "custom", "unitid", standardUnitId);
            if (updated) {
              console.log(`✅ StandardUnitId stored successfully in Shopify`);
            } else {
              console.log(`⚠️ Failed to store StandardUnitId in Shopify - will need to fetch again next time`);
            }
          }
        } else {
          console.log(`⚠️ No StandardUnitId found for ${monitorId}`);
        }
      } catch (unitError) {
        console.error(`Error fetching StandardUnitId for ${monitorId}:`, unitError);
      }
    }

    let price = null; // No default price - only set if found
    let priceSource = "no-price";
    
    // Check if Monitor API is configured
    if (!monitorUrl || !monitorUsername || !monitorCompany) {
      console.log('Monitor API not configured - no pricing available');
      priceSource = "api-not-configured";
    } else {

      let session = await getSessionId();
      let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerOrders/GetPriceInfo`;
      
      let res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": session,
        },
        body: JSON.stringify({
          "PartId": monitorId,
          "CustomerId": customerMonitorId,
          "QuantityInUnit": 1.0,
          "UnitId": standardUnitId,
          "UseExtendedResult": true
        }),
        agent,
      });
      
      if (res.status === 401) {
        // Session expired, force re-login and retry
        console.log(`Session expired for customer part links fetch, re-logging in...`);
        sessionId = null; // Clear the session
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
            "PartId": monitorId,
            "CustomerId": customerMonitorId,
            "QuantityInUnit": 1.0,
            "UnitId": standardUnitId,
            "UseExtendedResult": true
          }),
          agent,
        });
      }
      
      if (res.status !== 200) {
        console.error(`Failed to fetch customer part links for customer ${customerId}, part ${monitorId}: ${res.status} ${res.statusText}`);
        const errorText = await res.text();
        console.error(`Error response: ${errorText}`);
        return null;
      }

      const response = await res.json();
      console.log(`*** Customer part links API response for customer ${customerMonitorId}, part ${monitorId}:`, response);
      // price = response.CalculatedTotalPrice;
      price = response.TotalPrice;
    }
    
    return json({ 
      price: price,
      metadata: {
        variantId,
        customerId,
        shop,
        monitorPartId: monitorId || null,
        customerMonitorId: customerMonitorId || null,
        isOutletProduct: isOutletProduct || false,
        priceSource: priceSource,
        message: `${priceSource === 'outlet' ? 'Real outlet pricing' : 
                   priceSource === 'customer-specific' ? 'Customer-specific pricing' :
                   priceSource === 'outlet-no-price' ? 'Outlet product - no price found' :
                   priceSource === 'customer-no-price' ? 'Customer product - no price found' :
                   priceSource === 'outlet-no-monitor-id' ? 'Outlet product - no Monitor ID' :
                   priceSource === 'missing-monitor-ids' ? 'Missing Monitor IDs for pricing' :
                   priceSource === 'api-not-configured' ? 'Monitor API not configured' :
                   'No pricing available'} - CORS working`
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
