import "@shopify/shopify-api/adapters/node";
// import cron from "node-cron"; // Uncomment when enabling cron scheduling
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
dotenv.config();

const shopifyConfig = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES?.split(","),
  hostName: process.env.SHOPIFY_APP_URL.replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

// Use Node.js global object directly
if (!global.Shopify) global.Shopify = {};
global.Shopify.config = shopifyConfig.config;

// Helper function to validate if a session is still valid
async function validateSession(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
  const testQuery = `query {
    shop {
      id
      name
    }
  }`;

  try {
    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: testQuery }),
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error("Session validation failed:", result.errors);
      return false;
    }
    
    return result.data && result.data.shop;
  } catch (error) {
    console.error("Error validating session:", error);
    return false;
  }
}

// Helper function to fetch stock transactions from Monitor API
async function fetchStockTransactionsFromMonitor(partId) {
  const monitorUrl = process.env.MONITOR_URL;
  const monitorCompany = process.env.MONITOR_COMPANY;
  
  // Import the monitor client to get session
  const { MonitorClient } = await import("./utils/monitor.js");
  const monitorClient = new MonitorClient();
  
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/StockTransactions`;
    url += `?$filter=PartId eq '${partId}'`;
    url += '&$orderby=LoggingTimeStamp desc';
    url += '&$top=1'; // Only get the most recent transaction to get current balance
    
    const fetch = (await import('node-fetch')).default;
    const https = (await import('https')).default;
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchStockTransactions first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchStockTransactions retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchStockTransactions failed after re-login");
      }
    }
    
    const transactions = await res.json();
    if (!Array.isArray(transactions)) {
      throw new Error("Monitor API returned unexpected data format for stock transactions");
    }
    
    return transactions;
  } catch (error) {
    console.error(`Error fetching stock transactions for part ${partId}:`, error);
    throw error;
  }
}

// Helper function to get all Shopify locations with their monitor_id metafields
async function getShopifyLocations(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    locations(first: 50) {
      edges {
        node {
          id
          name
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    }
  }`;

  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();

  if (result.errors) {
    console.error("GraphQL errors getting locations:", JSON.stringify(result.errors, null, 2));
    return [];
  }

  return result.data?.locations?.edges?.map(edge => {
    const monitorIdMetafield = edge.node.metafields.edges.find(mf => mf.node.key === "monitor_id");
    return {
      id: edge.node.id,
      name: edge.node.name,
      monitorId: monitorIdMetafield?.node.value
    };
  }) || [];
}

// Helper function to get all products with their monitor_id metafields and variants
async function getShopifyProductsWithMonitorIds(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  let allProducts = [];
  let endCursor = null;
  let hasNextPage = true;
  
  while (hasNextPage) {
    const query = `query {
      products(first: 50${endCursor ? `, after: "${endCursor}"` : ""}) {
        edges {
          cursor
          node {
            id
            title
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  metafields(first: 10, namespace: "custom") {
                    edges {
                      node {
                        key
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`;
    
    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });
    
    const result = await response.json();
    
    if (result.errors) {
      console.error("GraphQL errors getting products:", JSON.stringify(result.errors, null, 2));
      break;
    }
    
    if (result.data?.products?.edges) {        // Flatten variants with their monitor_ids
        for (const productEdge of result.data.products.edges) {
          for (const variantEdge of productEdge.node.variants.edges) {
            const monitorIdMetafield = variantEdge.node.metafields.edges.find(mf => mf.node.key === "monitor_id");
            if (monitorIdMetafield) {
              allProducts.push({
                productId: productEdge.node.id,
                productTitle: productEdge.node.title,
                variantId: variantEdge.node.id,
                sku: variantEdge.node.sku || `Variant-${variantEdge.node.id}`, // Use native SKU field
                monitorId: monitorIdMetafield.node.value
              });
            }
          }
        }
    }
    
    hasNextPage = result.data?.products?.pageInfo?.hasNextPage || false;
    endCursor = result.data?.products?.pageInfo?.endCursor;
  }
  
  return allProducts;
}

// Helper function to update inventory levels in Shopify
async function updateShopifyInventoryLevel(shop, accessToken, inventoryItemId, locationId, availableQuantity) {
  const fetch = (await import('node-fetch')).default;
  
  const mutation = `mutation inventorySetOnHandQuantities($input: InventorySetOnHandQuantitiesInput!) {
    inventorySetOnHandQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    input: {
      reason: "other", // Use a valid reason from the allowed list
      setQuantities: [
        {
          inventoryItemId: inventoryItemId,
          locationId: locationId,
          quantity: Math.floor(availableQuantity) // Shopify expects integer quantities
        }
      ]
    }
  };

  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const result = await response.json();

  if (result.errors) {
    console.error("GraphQL errors updating inventory:", JSON.stringify(result.errors, null, 2));
    return false;
  }

  if (result.data?.inventorySetOnHandQuantities?.userErrors?.length > 0) {
    console.error("User errors updating inventory:", result.data.inventorySetOnHandQuantities.userErrors);
    return false;
  }

  return true;
}

// Helper function to get inventory item ID for a variant
async function getInventoryItemId(shop, accessToken, variantId) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    productVariant(id: "${variantId}") {
      inventoryItem {
        id
      }
    }
  }`;

  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();

  if (result.errors) {
    console.error("GraphQL errors getting inventory item:", JSON.stringify(result.errors, null, 2));
    return null;
  }

  return result.data?.productVariant?.inventoryItem?.id;
}

// Helper function to ensure inventory item is stocked at location
async function ensureInventoryItemAtLocation(shop, accessToken, inventoryItemId, locationId) {
  const fetch = (await import('node-fetch')).default;
  
  // First check if it's already stocked at the location
  const checkQuery = `query {
    inventoryItem(id: "${inventoryItemId}") {
      inventoryLevels(first: 10) {
        edges {
          node {
            location {
              id
            }
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }
  }`;

  const checkRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: checkQuery }),
  });

  const checkResult = await checkRes.json();
  
  if (checkResult.errors) {
    console.error("Error checking inventory levels:", JSON.stringify(checkResult.errors, null, 2));
    return false;
  }

  // Check if already stocked at this location
  const existingLevel = checkResult.data?.inventoryItem?.inventoryLevels?.edges?.find(
    edge => edge.node.location.id === locationId
  );

  if (existingLevel) {
    console.log(`    Inventory already stocked at location`);
    return true;
  }

  // If not stocked, we need to activate it at the location
  console.log(`    Activating inventory at location...`);
  
  const activateQuery = `mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
      inventoryLevel {
        id
        quantities(names: ["available"]) {
          name
          quantity
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const activateVars = {
    inventoryItemId: inventoryItemId,
    locationId: locationId,
    available: 0 // Start with 0, we'll update it separately
  };

  const activateRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: activateQuery, variables: activateVars }),
  });

  const activateResult = await activateRes.json();

  if (activateResult.errors) {
    console.error("GraphQL errors activating inventory:", JSON.stringify(activateResult.errors, null, 2));
    return false;
  }

  if (activateResult.data?.inventoryActivate?.userErrors?.length > 0) {
    console.error("User errors activating inventory:", activateResult.data.inventoryActivate.userErrors);
    return false;
  }

  console.log(`    Successfully activated inventory at location`);
  return true;
}

async function syncInventory() {
  const prisma = (await import("./db.server.js")).default;
  const session = await prisma.session.findFirst();
  
  if (!session) {
    console.log("No Shopify session found. Cannot sync inventory.");
    console.log("Please visit your Shopify app to authenticate first.");
    return;
  }

  // Check if session has expired
  if (session.expires && session.expires < new Date()) {
    console.log("Shopify session has expired. Please re-authenticate your app.");
    return;
  }

  // Validate the session by making a test API call
  const isValidSession = await validateSession(session.shop, session.accessToken);
  if (!isValidSession) {
    console.log("❌ Shopify session is invalid or expired.");
    console.log("To fix this:");
    console.log("1. Run 'npm run dev' to start the development server");
    console.log("2. Visit the app in your browser to re-authenticate");
    console.log("3. Once authenticated, you can run the sync job again");
    return;
  }

  console.log("✅ Shopify session is valid. Starting inventory sync...");

  const shop = session.shop;
  const accessToken = session.accessToken;

  try {
    // Get all Shopify locations with monitor_id mapping
    console.log("Fetching Shopify locations...");
    const locations = await getShopifyLocations(shop, accessToken);
    const locationMap = new Map();
    
    locations.forEach(location => {
      if (location.monitorId) {
        locationMap.set(location.monitorId, location);
        console.log(`Mapped Monitor warehouse ${location.monitorId} to Shopify location "${location.name}" (${location.id})`);
      }
    });

    if (locationMap.size === 0) {
      console.log("❌ No Shopify locations found with monitor_id metafields. Please set up location mapping first.");
      return;
    }

    // Get all products with monitor_id metafields
    console.log("Fetching Shopify products with Monitor IDs...");
    const products = await getShopifyProductsWithMonitorIds(shop, accessToken);
    
    if (products.length === 0) {
      console.log("❌ No Shopify product variants found with monitor_id metafields. Please sync products first.");
      return;
    }

    console.log(`Found ${products.length} product variants with Monitor IDs to process`);

    // Debug: Show first few products
    if (products.length > 0) {
      console.log("Sample products found:");
      products.slice(0, 3).forEach((product, index) => {
        console.log(`  ${index + 1}. SKU: "${product.sku}", Monitor ID: ${product.monitorId}, Product: ${product.productTitle}`);
      });
    }

    let successCount = 0;
    let errorCount = 0;

    // Process each product variant
    for (const product of products) {
      const displayName = product.sku || `Variant ID: ${product.variantId}`;
      console.log(`Processing variant ${displayName} (Monitor ID: ${product.monitorId})...`);
      
      try {
        // Fetch stock transactions from Monitor API for this part
        const stockTransactions = await fetchStockTransactionsFromMonitor(product.monitorId);
        
        if (stockTransactions.length === 0) {
          console.log(`  No stock transactions found for Monitor ID ${product.monitorId}`);
          continue;
        }

        // Get the most recent transaction to get current balance
        const mostRecentTransaction = stockTransactions[0];
        const currentBalance = mostRecentTransaction.BalanceOnPartAfterChange;
        const warehouseId = mostRecentTransaction.WarehouseId;

        console.log(`  Current balance: ${currentBalance} in warehouse ${warehouseId}`);

        // Find the corresponding Shopify location
        const shopifyLocation = locationMap.get(warehouseId);
        if (!shopifyLocation) {
          console.log(`  ⚠️  No Shopify location mapped for Monitor warehouse ${warehouseId}`);
          continue;
        }

        // Get inventory item ID for this variant
        const inventoryItemId = await getInventoryItemId(shop, accessToken, product.variantId);
        if (!inventoryItemId) {
          console.log(`  ❌ Could not get inventory item ID for variant ${product.variantId}`);
          errorCount++;
          continue;
        }

        // Ensure inventory item is stocked at location
        const isStocked = await ensureInventoryItemAtLocation(shop, accessToken, inventoryItemId, shopifyLocation.id);
        if (!isStocked) {
          console.log(`  ❌ Failed to ensure inventory item is stocked at location ${shopifyLocation.id}`);
          errorCount++;
          continue;
        }

        // Update inventory level in Shopify
        const success = await updateShopifyInventoryLevel(
          shop, 
          accessToken, 
          inventoryItemId, 
          shopifyLocation.id, 
          currentBalance
        );

        if (success) {
          console.log(`  ✅ Updated inventory for ${displayName} to ${Math.floor(currentBalance)} at location "${shopifyLocation.name}"`);
          successCount++;
        } else {
          console.log(`  ❌ Failed to update inventory for ${displayName}`);
          errorCount++;
        }

      } catch (error) {
        console.error(`  ❌ Error processing variant ${displayName}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n✅ Inventory sync completed!`);
    console.log(`  Successfully updated: ${successCount} variants`);
    console.log(`  Errors: ${errorCount} variants`);

  } catch (error) {
    console.error("❌ Failed to sync inventory:", error);
    throw error;
  }
}

// Schedule to run every 15 minutes (commented out for testing)
// cron.schedule("*/15 * * * *", () => {
//   console.log("[CRON] Syncing inventory from Monitor to Shopify...");
//   syncInventory();
// });

// Run once on startup as well
syncInventory();
