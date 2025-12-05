import { json } from "@remix-run/node";
import https from "https";

// Monitor API configuration
const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

// Constants
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

// Apply discount category discount to a price
/* async function applyDiscountCategoryDiscount(priceListPrice, customerDiscountCategory, partCodeId) {
  if (!customerDiscountCategory || !partCodeId) {
    return priceListPrice;
  }

  try {
    // Fetch discount category row directly (inlined to avoid server-only module imports)
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Common/DiscountCategoryRows`;
    url += `?$filter=DiscountCategoryId eq '${customerDiscountCategory}' and PartCodeId eq '${partCodeId}'`;
    
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
      const errorBody = await res.text();
      console.error(`Monitor API fetchDiscountCategoryRow first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await login();
      const newSession = await getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSession,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchDiscountCategoryRow retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        return priceListPrice; // Return original price on error
      }
    }
    
    const discountRows = await res.json();
    if (!Array.isArray(discountRows)) {
      console.error("Monitor API returned unexpected data format for discount category rows");
      return priceListPrice;
    }
    
    const discountRow = discountRows.length > 0 ? discountRows[0] : null;
    
    if (discountRow && discountRow.Discount1 > 0) {
      const discountPercentage = discountRow.Discount1;
      const discountedPrice = priceListPrice * (discountPercentage / 100);
      return discountedPrice;
    }
    
    return priceListPrice;
  } catch (error) {
    console.error(`Error fetching discount category row for discount category ${customerDiscountCategory} and part code ${partCodeId}:`, error);
    return priceListPrice; // Return original price on error
  }
} */

// Fetch price from a specific price list
/* async function fetchPriceFromPriceList(partId, priceListId) {
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
    // console.log(`Price list API response for part ${partId}, price list ${priceListId}:`, prices);
    
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
} */

// Fetch customer-specific price with fallback to customer's price list
// Includes discount category logic similar to pricing.js getDynamicPrice function
/*async function fetchCustomerPartPrice(customerId, partId, partCodeId = null, customerPriceListId = null, customerDiscountCategory = null) {

  try {
    // Step 1: Check for specific customer-part price using CustomerPartLinks
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartLinks`;
    url += `?$filter=CustomerId eq '${customerId}' and PartId eq '${partId}'`;
    
    // console.log(`Step 1: Checking for specific customer-part price for customer ${customerId}, part ${partId}`);
    
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
      return null;
    }
    
    const customerPartLinks = await res.json();
    console.log(`Customer part links API response for customer ${customerId}, part ${partId}:`, customerPartLinks);
    
    if (Array.isArray(customerPartLinks) && customerPartLinks.length > 0) {
      // Found specific customer-part price
      const specificPrice = customerPartLinks[0].Price;
      // console.log(`Step 1 SUCCESS: Found specific customer-part price: ${specificPrice}`);

      // @TODO Here we should also add discount.
      // if (customerDiscountCategory && customerDiscountCategory !== null && partCodeId) {
        // console.log(`Customer has discount category ID: ${customerDiscountCategory}, checking for discounts`);
        // const discountRow = await fetchDiscountCategoryRowFromMonitor(customerDiscountCategory, partCodeId);
        
        // if (discountRow && discountRow.Discount1 > 0) {
        //  const discountPercentage = discountRow.Discount1;
        //  const discountedPrice = specificPrice * (discountPercentage / 100);
          // console.log(`Applied discount category discount: ${discountPercentage}% on price list price ${priceListPrice}, final price: ${discountedPrice}`);
        //  return discountedPrice;
        // }
      // }

      return specificPrice;
    } else {
      //console.log(`Step 1: No specific customer-part price found, proceeding to customer's price list...`);
      
      // Step 2: Use customer details from Shopify metafields (avoiding API call to fetchCustomerFromMonitor)
      // console.log(`Step 2: Using customer details from Shopify metafields for ${customerId}`);
      // console.log(`Step 2: Customer's price list ID from Shopify: ${customerPriceListId || 'not provided'}`);
      // console.log(`Step 2: Customer's discount category ID from Shopify: ${customerDiscountCategory || 'not provided'}`);
      
      if (!customerPriceListId) {
        // console.log(`Step 2 FAILED: No customer price list ID provided from Shopify metafields`);
        return null;
      }
      
      // Step 3: Get price from customer's price list
      const priceListPrice = await fetchPriceFromPriceList(partId, customerPriceListId);
      
      if (priceListPrice !== null && priceListPrice > 0) {
        // console.log(`Step 3 SUCCESS: Found price in customer's price list: ${priceListPrice}`);
        
        // Step 3a: Check for discount category discounts
        const finalPrice = await applyDiscountCategoryDiscount(priceListPrice, customerDiscountCategory, partCodeId);
        
        // console.log(`fetchCustomerPartPrice returning price: ${finalPrice}`);
        return finalPrice;
      } else {
        // console.log(`Step 3 FAILED: No price found in customer's price list ${customerPriceListId}`);
        console.log(`fetchCustomerPartPrice returning null`);
        return null;
      }
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
    
    // console.log(`Fetching outlet price for part ${partId} from price list ${OUTLET_PRICE_LIST_ID}`);
    // console.log(`API URL: ${url}`);
    // console.log(`Using session: ${session?.substring(0, 8)}...`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent,
    });
    
    // console.log(`Initial response status: ${res.status}`);
    
    if (res.status === 401) {
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
    // console.log(`Outlet price API response for ${partId}:`, Array.isArray(prices) ? `Array with ${prices.length} items` : prices);
    
    if (!Array.isArray(prices)) {
      // console.log(`Outlet price response is not an array for ${partId}`);
      return null;
    }
    
    if (prices.length > 0) {
      // console.log(`Found outlet price for ${partId}: ${prices[0].Price}`);
      return prices[0].Price;
    } else {
      // console.log(`No outlet prices found for ${partId} in price list ${OUTLET_PRICE_LIST_ID}`);
      
      // DEBUG: Let's check what price lists exist for this part
      // console.log(`DEBUG: Checking if part ${partId} exists in other price lists...`);
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
}*/

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
    // console.log(`Fetching metafields for variant ${variantId}, customer ${customerId}, shop ${shop}`);
    
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
    // console.log(`Shopify API response:`, JSON.stringify(data, null, 2));
    
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
    let { variantId, customerId, shop, monitorId, isOutletProduct, customerMonitorId, customerDiscountCategory, customerPriceListId, fetchMetafields, partCodeId } = body;

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
    // console.log(`Monitor ID: ${monitorId}, Is outlet product: ${isOutletProduct}, Customer Monitor ID: ${customerMonitorId}`);
    // console.log(`Monitor env check: URL=${!!monitorUrl}, USER=${!!monitorUsername}, COMPANY=${!!monitorCompany}`);

    let price = null; // No default price - only set if found
    let priceSource = "no-price";
    
    // Check if Monitor API is configured
    if (!monitorUrl || !monitorUsername || !monitorCompany) {
      console.log('Monitor API not configured - no pricing available');
      priceSource = "api-not-configured";
    } else {
      // Monitor API is configured, try to fetch price

      let session = await getSessionId();
      let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartLinks`;
      
      // console.log(`Step 1: Checking for specific customer-part price for customer ${customerId}, part ${partId}`);
      
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
          "QuantityInUnit": 1.0
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
            "QuantityInUnit": 1.0
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
      price = response.CalculatedTotalPrice;

    /*  
      // 1. First check if it's an outlet product
      if (isOutletProduct && monitorId) {
        // console.log(`Product is in outlet collection, fetching outlet price for Monitor ID: ${monitorId}`);
        const outletPrice = await fetchOutletPrice(monitorId);
        
        if (outletPrice !== null && outletPrice > 0) {
          price = outletPrice;
          priceSource = "outlet";
          // console.log(`Found outlet price: ${outletPrice}`);
        } else {
          // console.log(`No outlet price found for Monitor ID: ${monitorId}`);
          priceSource = "outlet-no-price";
        }
      } else if (isOutletProduct && !monitorId) {
        // console.log(`Outlet product but no Monitor ID available`);
        priceSource = "outlet-no-monitor-id";
      } else {
        // 2. Not an outlet product - check for customer-specific pricing
        if (customerMonitorId && monitorId) {
          console.log(`Checking customer-specific price for customer ${customerMonitorId}, part ${monitorId}, partCode ${partCodeId || 'none'}`);
          const customerPrice = await fetchCustomerPartPrice(customerMonitorId, monitorId, partCodeId, customerPriceListId, customerDiscountCategory);
          
          console.log(`fetchCustomerPartPrice returned: ${customerPrice} (type: ${typeof customerPrice})`);
          
          if (customerPrice !== null && customerPrice > 0) {
            price = customerPrice;
            priceSource = "customer-specific";
            console.log(`Found customer-specific price: ${customerPrice}`);
          } else {
            console.log(`No customer-specific price found for customer ${customerMonitorId}, part ${monitorId}`);
            priceSource = "customer-no-price";
          }
        } else {
          console.log(`Missing customer Monitor ID (${customerMonitorId}) or part Monitor ID (${monitorId}) - cannot fetch pricing`);
          priceSource = "missing-monitor-ids";
        }
      }*/
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
