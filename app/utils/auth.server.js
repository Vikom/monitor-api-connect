import { authenticate as shopifyAuthenticate } from "../shopify.server.js";
import { ApiVersion } from "@shopify/shopify-app-remix/server";

/**
 * Custom authentication function that handles both OAuth and direct API access
 * @param {Request} request - The incoming request
 * @returns {Promise<Object>} Authentication result with admin client and session info
 */
export async function authenticate(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop') || extractShopFromRequest(request);
  
  // Check if this is the advanced store
  if (shop === process.env.ADVANCED_STORE_DOMAIN) {
    return await authenticateAdvancedStore(shop);
  }
  
  // Use normal OAuth authentication for other stores
  return await shopifyAuthenticate.admin(request);
}

/**
 * Authenticate with the advanced store using direct API access
 * @param {string} shop - The shop domain
 * @returns {Object} Authentication result
 */
async function authenticateAdvancedStore(shop) {
  const accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;
  
  if (!accessToken) {
    throw new Error("Advanced store admin token not configured");
  }

  // Create a mock admin client similar to the OAuth one
  const admin = {
    rest: createRestClient(shop, accessToken),
    graphql: createGraphQLClient(shop, accessToken),
  };

  // Create a mock session object
  const session = {
    shop,
    accessToken,
    id: `advanced_store_${shop}`,
    state: "authenticated",
    isOnline: false,
  };

  return { admin, session };
}

/**
 * Create a REST client for direct API access
 * @param {string} shop - The shop domain
 * @param {string} accessToken - The access token
 * @returns {Object} REST client
 */
function createRestClient(shop, accessToken) {
  return {
    async get({ path, query = {} }) {
      const url = new URL(`https://${shop}/admin/api/${ApiVersion.January25}${path}`);
      Object.entries(query).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`REST API call failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    },

    async post({ path, data = {} }) {
      const url = `https://${shop}/admin/api/${ApiVersion.January25}${path}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`REST API call failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    },

    async put({ path, data = {} }) {
      const url = `https://${shop}/admin/api/${ApiVersion.January25}${path}`;
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`REST API call failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    },

    async delete({ path }) {
      const url = `https://${shop}/admin/api/${ApiVersion.January25}${path}`;
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'X-Shopify-Access-Token': accessToken,
        },
      });

      if (!response.ok) {
        throw new Error(`REST API call failed: ${response.status} ${response.statusText}`);
      }

      return response.status === 204 ? {} : await response.json();
    },
  };
}

/**
 * Create a GraphQL client for direct API access
 * @param {string} shop - The shop domain
 * @param {string} accessToken - The access token
 * @returns {Function} GraphQL client function
 */
function createGraphQLClient(shop, accessToken) {
  return async (query, variables = {}) => {
    const url = `https://${shop}/admin/api/${ApiVersion.January25}/graphql.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL API call failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result;
  };
}

/**
 * Extract shop domain from various sources in the request
 * @param {Request} request - The incoming request
 * @returns {string|null} Shop domain or null if not found
 */
function extractShopFromRequest(request) {
  const url = new URL(request.url);
  
  // Try to get shop from query parameters
  let shop = url.searchParams.get('shop');
  if (shop) return shop;
  
  // Try to get shop from headers (for embedded apps)
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    // This is a simplified extraction - you might need to parse JWT tokens
    // depending on your app's authentication flow
    // const bearerToken = authHeader.replace('Bearer ', '');
    // Add logic to extract shop from JWT if needed
  }
  
  // Try to get from referer or other headers
  const referer = request.headers.get('referer');
  if (referer && referer.includes('.myshopify.com')) {
    const match = referer.match(/https:\/\/([^.]+\.myshopify\.com)/);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Webhook authentication function for advanced store
 * @param {Request} request - The incoming request
 * @returns {Promise<Object>} Webhook authentication result
 */
export async function authenticateWebhook(request) {
  const shop = extractShopFromWebhook(request);
  
  if (shop === process.env.ADVANCED_STORE_DOMAIN) {
    // For advanced store webhooks, we need to verify the webhook manually
    // since we're not using OAuth
    return await verifyAdvancedStoreWebhook(request, shop);
  }
  
  // Use normal webhook authentication for other stores
  return await shopifyAuthenticate.webhook(request);
}

/**
 * Extract shop domain from webhook request
 * @param {Request} request - The webhook request
 * @returns {string|null} Shop domain
 */
function extractShopFromWebhook(request) {
  const shopHeader = request.headers.get('x-shopify-shop-domain');
  if (shopHeader) return shopHeader;
  
  // Try to extract from other headers if needed
  return null;
}

/**
 * Verify webhook for advanced store
 * @param {Request} request - The webhook request
 * @param {string} shop - The shop domain
 * @returns {Object} Webhook verification result
 */
async function verifyAdvancedStoreWebhook(request, shop) {
  // For advanced stores, you might need to implement webhook verification
  // This is a simplified version - you should add proper webhook verification
  const topic = request.headers.get('x-shopify-topic');
  const payload = await request.text();
  
  return {
    shop,
    topic,
    payload: JSON.parse(payload),
    session: {
      shop,
      accessToken: process.env.ADVANCED_STORE_ADMIN_TOKEN,
      id: `advanced_store_webhook_${shop}`,
    },
  };
}
