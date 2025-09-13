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
        UserName: monitorUsername,
        Password: monitorPassword,
      }),
      agent,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Monitor login failed: ${res.status} ${res.statusText}`);
      console.error(`Login error response: ${errorText}`);
      throw new Error(`Monitor login failed: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    if (!data.SessionId) {
      console.error(`No SessionId in login response:`, data);
      throw new Error('No SessionId received from Monitor API');
    }
    
    console.log(`Monitor API login successful, SessionId: ${data.SessionId.substring(0, 8)}...`);
    sessionId = data.SessionId;
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
async function fetchCustomerPartPrice(customerId, partId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartPrices`;
    url += `?$filter=CustomerId eq '${customerId}' and PartId eq '${partId}'`;
    
    console.log(`Fetching customer price for customer ${customerId}, part ${partId}`);
    
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
      console.log(`Session expired for customer price fetch, re-logging in...`);
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
      console.error(`Failed to fetch customer part price for customer ${customerId}, part ${partId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return null;
    }
    
    const prices = await res.json();
    console.log(`Customer price API response for customer ${customerId}, part ${partId}:`, prices);
    
    if (!Array.isArray(prices)) {
      console.log(`Customer price response is not an array`);
      return null;
    }
    
    if (prices.length > 0) {
      console.log(`Found customer price: ${prices[0].Price}`);
      return prices[0].Price;
    } else {
      console.log(`No customer-specific price found for customer ${customerId}, part ${partId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching customer part price for customer ${customerId}, part ${partId}:`, error);
    return null;
  }
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
        // Not an outlet product - check for customer-specific pricing if we have both IDs
        if (customerMonitorId && monitorId) {
          console.log(`Non-outlet product with customer Monitor ID ${customerMonitorId} and part ID ${monitorId} - using fallback price (API not configured)`);
          price = 250.00; // Mock customer-specific price for testing
          priceSource = "customer-fallback-no-api";
        } else {
          console.log(`Not an outlet product, using test price: ${price}`);
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
        // 2. Not an outlet product - check for customer-specific pricing
        if (customerMonitorId && monitorId) {
          console.log(`Checking customer-specific price for customer ${customerMonitorId}, part ${monitorId}`);
          const customerPrice = await fetchCustomerPartPrice(customerMonitorId, monitorId);
          
          if (customerPrice !== null && customerPrice > 0) {
            price = customerPrice;
            priceSource = "customer-specific";
            console.log(`Found customer-specific price: ${customerPrice}`);
          } else {
            console.log(`No customer-specific price found, using test price: ${price}`);
          }
        } else {
          console.log(`Missing customer Monitor ID (${customerMonitorId}) or part Monitor ID (${monitorId}), using test price: ${price}`);
        }
      }
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
                   priceSource === 'outlet-fallback' ? 'Outlet fallback pricing' : 
                   priceSource === 'customer-specific' ? 'Customer-specific pricing' :
                   priceSource === 'customer-fallback-no-api' ? 'Customer fallback pricing (API not configured)' :
                   'Test pricing'} - CORS working`
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
