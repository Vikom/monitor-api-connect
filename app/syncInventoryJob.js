import "@shopify/shopify-api/adapters/node";
// import cron from "node-cron"; // Uncomment when enabling cron scheduling
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { fetchStockTransactionsFromMonitor } from "./utils/monitor.js";
dotenv.config();

// Get command line arguments to determine which store to sync to
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a');

console.log(`🎯 Target store: ${useAdvancedStore ? 'Advanced Store' : 'Development Store'}`);

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
  let shop, accessToken;

  if (useAdvancedStore) {
    // Use Advanced store configuration
    shop = process.env.ADVANCED_STORE_DOMAIN;
    accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    if (!shop || !accessToken) {
      console.log("❌ Advanced store configuration missing!");
      console.log("Please ensure ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are set in your .env file");
      return;
    }

    console.log(`🔗 Using Advanced store: ${shop}`);
    
    // Validate the advanced store session
    const isValidSession = await validateSession(shop, accessToken);
    if (!isValidSession) {
      console.log("❌ Advanced store session is invalid.");
      console.log("Please check your ADVANCED_STORE_ADMIN_TOKEN in the .env file");
      return;
    }
  } else {
    // Use development store with OAuth (existing logic)
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

    shop = session.shop;
    accessToken = session.accessToken;
    console.log(`🔗 Using development store: ${shop}`);
  }

  console.log("✅ Store session is valid. Starting inventory sync...");

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

// Display usage instructions
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Inventory Sync Job Usage:

To sync to development store (OAuth):
  node app/syncInventoryJob.js

To sync to Advanced store:
  node app/syncInventoryJob.js --advanced
  node app/syncInventoryJob.js -a

Configuration:
  Development store: Uses Prisma session from OAuth flow
  Advanced store: Uses ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN from .env

Make sure your .env file is configured properly before running.
  `);
  process.exit(0);
}

console.log(`
🚀 Starting Inventory Sync Job
📝 Use --help for usage instructions
`);

// Run the sync
syncInventory();
