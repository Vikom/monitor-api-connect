import "@shopify/shopify-api/adapters/node";
// import cron from "node-cron"; // Now handled by main worker process
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { fetchPartByPartNumberFromMonitor, fetchPartsForStock } from "./utils/monitor.js";
dotenv.config();

// Store selection will be determined at runtime inside the syncInventory function
// to properly handle global.useAdvancedStore set by the worker

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

// Mapping of Monitor warehouse IDs to Shopify custom metafield keys
const WAREHOUSE_METAFIELD_MAPPING = {
  '933124852911871989': 'custom.stock_vittsjo',
  '933124156053429919': 'custom.stock_ronas',
  '1189106270728482943': 'custom.stock_lund',
  '933126667535575191': 'custom.stock_sundsvall',
  '933125224426542349': 'custom.stock_goteborg',
  '933126074830088482': 'custom.stock_stockholm'
};

// Mapping of Monitor warehouse IDs to JSON property names (without custom. prefix)
const WAREHOUSE_JSON_MAPPING = {
  '933124852911871989': 'vittsjo',
  '933124156053429919': 'ronas',
  '1189106270728482943': 'lund',
  '933126667535575191': 'sundsvall',
  '933125224426542349': 'goteborg',
  '933126074830088482': 'stockholm'
};

// Helper function to generate stock control JSON from PartPlanningInformations
function generateStockControlJson(partPlanningInformations) {
  const stockControl = {};
  
  // Initialize all warehouses with default 'order' value
  Object.values(WAREHOUSE_JSON_MAPPING).forEach(warehouseName => {
    stockControl[warehouseName] = 'order'; // Default value
  });
  
  if (!Array.isArray(partPlanningInformations)) {
    return stockControl;
  }
  
  // Process each planning information entry and override defaults
  partPlanningInformations.forEach(planningInfo => {
    const warehouseId = planningInfo.WarehouseId;
    const lotSizingRule = planningInfo.LotSizingRule;
    
    // Only process warehouses that are in our mapping
    if (WAREHOUSE_JSON_MAPPING[warehouseId]) {
      const warehouseName = WAREHOUSE_JSON_MAPPING[warehouseId];
      
      // Determine stock control value based on LotSizingRule
      let controlValue;
      if (lotSizingRule === 1 || lotSizingRule === 5) {
        controlValue = 'order';
      } else if (lotSizingRule === 2 || lotSizingRule === 3) {
        controlValue = 'stock';
      } else if (lotSizingRule === 4) {
        controlValue = 'false';
      } else {
        // Default fallback for unknown rules
        controlValue = 'order';
      }
      
      stockControl[warehouseName] = controlValue;
    }
  });
  
  return stockControl;
}

// Helper function to determine stock status based on current stock and stock control settings
function determineStockStatus(stockData, stockControlJson) {
  // Check if there's stock in any of our tracked warehouses
  const hasStockInAnyLocation = Object.entries(stockData).some(([warehouseId, stock]) => {
    // Only check warehouses that are in our mapping
    return WAREHOUSE_METAFIELD_MAPPING[warehouseId] && stock > 0;
  });
  
  if (hasStockInAnyLocation) {
    return 'I lager';
  }
  
  // No stock - check if any location has 'order' in stock control
  const hasOrderLocation = Object.values(stockControlJson).some(controlValue => controlValue === 'order');
  
  if (hasOrderLocation) {
    return 'Beställningsvara';
  }
  
  // No stock and no order locations - return empty string to clear the field
  return '';
}

// Helper function to update variant metafields with stock values, stock control, and stock status
async function updateVariantMetafields(shop, accessToken, variantId, stockData, stockControlJson, stockStatus) {
  const fetch = (await import('node-fetch')).default;
  
  // Prepare metafields array for ALL warehouses (always populate all warehouses)
  const metafields = [];
  
  // Always create metafields for all warehouses in our mapping, even if stock is 0 or missing
  for (const [warehouseId, metafieldKey] of Object.entries(WAREHOUSE_METAFIELD_MAPPING)) {
    const stock = stockData[warehouseId] || 0; // Use 0 if no stock data for this warehouse
    const [namespace, key] = metafieldKey.split('.');
    metafields.push({
      namespace: namespace,
      key: key,
      value: stock.toString(),
      type: "number_decimal"
    });
  }
  
  // Always add stock_control JSON metafield (even if empty)
  metafields.push({
    namespace: "custom",
    key: "stock_control",
    value: JSON.stringify(stockControlJson || {}),
    type: "json"
  });
  
  // Always add stock_status metafield
  metafields.push({
    namespace: "custom",
    key: "stock_status",
    value: stockStatus || "", // Use empty string if stockStatus is falsy
    type: "single_line_text_field"
  });
  
  const mutation = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
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
  }`;

  const variables = {
    metafields: metafields.map(metafield => ({
      ...metafield,
      ownerId: variantId
    }))
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
    console.error("GraphQL errors updating metafields:", JSON.stringify(result.errors, null, 2));
    return false;
  }

  if (result.data?.metafieldsSet?.userErrors?.length > 0) {
    console.error("User errors updating metafields:", result.data.metafieldsSet.userErrors);
    return false;
  }

  return true;
}

// Legacy: This function is kept for reference but not used in new inventory sync approach
// Helper function to get stock data for all warehouses for a specific Monitor ID (OLD METHOD)
// async function getStockDataForAllWarehouses(monitorId) {
//   try {
//     const stockTransactions = await fetchStockTransactionsFromMonitor(monitorId);
//     
//     if (stockTransactions.length === 0) {
//       return {};
//     }

//     // Group transactions by warehouse and get the most recent balance for each
//     const warehouseStock = {};
//     const warehouseTransactions = {};
//     
//     // Group transactions by warehouse
//     stockTransactions.forEach(transaction => {
//       const warehouseId = transaction.WarehouseId;
//       if (!warehouseTransactions[warehouseId]) {
//         warehouseTransactions[warehouseId] = [];
//       }
//       warehouseTransactions[warehouseId].push(transaction);
//     });
//     
//     // Get the most recent balance for each warehouse
//     for (const [warehouseId, transactions] of Object.entries(warehouseTransactions)) {
//       // Transactions should already be sorted by date (most recent first)
//       const mostRecent = transactions[0];
//       warehouseStock[warehouseId] = mostRecent.BalanceOnPartAfterChange;
//     }
//     
//     return warehouseStock;
//   } catch (error) {
//     console.error(`Error fetching stock data for Monitor ID ${monitorId}:`, error);
//     return {};
//   }
// }

// Helper function to get stock data from PartLocations for a specific part
function getStockDataFromPartLocations(partLocations) {
  const warehouseStock = {};
  
  if (!Array.isArray(partLocations)) {
    return warehouseStock;
  }
  
  // Group part locations by warehouse and sum the balance
  partLocations.forEach(location => {
    const warehouseId = location.WarehouseId;
    const balance = location.Balance || 0;
    
    // Only include warehouses that are in our mapping
    if (WAREHOUSE_METAFIELD_MAPPING[warehouseId]) {
      if (!warehouseStock[warehouseId]) {
        warehouseStock[warehouseId] = 0;
      }
      warehouseStock[warehouseId] += balance;
    }
  });
  
  return warehouseStock;
}

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
      console.error("❌ Session validation failed:", result.errors);
      return false;
    }
    
    const isValid = result.data && result.data.shop;
    return isValid;
  } catch (error) {
    console.error("❌ Error validating session:", error);
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
    console.log(`    Inventory item already activated at location`);
    return true;
  }

  // If not stocked, we need to activate it at the location
  console.log(`    Activating inventory item at location for first time...`);
  
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

  return true;
}

export async function syncInventory() {
  // Use global variable if set (from worker), otherwise use command line args
  const args = process.argv.slice(2);
  const currentUseAdvancedStore = global.useAdvancedStore !== undefined ? global.useAdvancedStore : 
    (args.includes('--advanced') || args.includes('-a'));
  const isSingleTest = args.includes('--single-test');

  console.log(`🎯 Runtime store detection: ${currentUseAdvancedStore ? 'Advanced Store' : 'Development Store'}`);
  console.log(`🔍 Global flag: ${global.useAdvancedStore}, Args: ${args.includes('--advanced') || args.includes('-a')}`);

  // Handle single test mode
  if (isSingleTest) {
    console.log('🧪 Single test mode - testing with one actual Shopify update');
    
    // Set up Shopify connection (same logic as main sync)
    let shop, accessToken;

    if (currentUseAdvancedStore) {
      // Use Advanced store configuration
      shop = process.env.ADVANCED_STORE_DOMAIN;
      accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

      if (!shop || !accessToken) {
        console.log("❌ Advanced store configuration missing!");
        return;
      }
      
      // Validate the advanced store session
      const isValidSession = await validateSession(shop, accessToken);
      if (!isValidSession) {
        console.log("❌ Advanced store session is invalid.");
        return;
      }
    } else {
      // Use development store with OAuth (existing logic)
      const prisma = (await import("./db.server.js")).default;
      const session = await prisma.session.findFirst();
      
      if (!session) {
        console.log("No Shopify session found. Cannot sync inventory.");
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
        return;
      }

      shop = session.shop;
      accessToken = session.accessToken;
    }
    
    // Get parts from Monitor for testing (get a few to find one with stock)
    console.log("🔍 Fetching parts from Monitor for stock sync test...");
    
    const parts = await fetchPartsForStock(10); // Get more parts to find one with actual stock
    
    if (parts.length === 0) {
      console.log('❌ No parts found in Monitor with stock data');
      return;
    }
    
    // Get Shopify products for mapping
    console.log("🔍 Fetching Shopify products with Monitor IDs for mapping...");
    let shopifyProducts = [];
    
    try {
      shopifyProducts = await getShopifyProductsWithMonitorIds(shop, accessToken);
    } catch (error) {
      console.log('⚠️  Shopify API throttled - cannot run proper test without product mappings');
      console.log('   Please wait for API throttling to clear and try again');
      return;
    }
    
    // Create a map of Monitor ID to Shopify product data
    const monitorIdToShopifyMap = new Map();
    shopifyProducts.forEach(product => {
      monitorIdToShopifyMap.set(product.monitorId, product);
    });

    // Find a part that has both a corresponding Shopify product AND actual stock
    let testPart = null;
    let testProduct = null;
    
    for (const part of parts) {
      const shopifyProduct = monitorIdToShopifyMap.get(part.Id);
      if (shopifyProduct) {
        // Check if this part has any non-zero stock balances
        const stockData = getStockDataFromPartLocations(part.PartLocations);
        const hasStock = Object.values(stockData).some(balance => balance > 0);
        
        if (hasStock) {
          console.log(`🎯 Found part with actual stock: ${part.PartNumber} (${part.Id})`);
          testPart = part;
          testProduct = shopifyProduct;
          break;
        } else {
          console.log(`⚠️  Part ${part.PartNumber} has Shopify mapping but no stock - continuing search...`);
        }
      }
    }
    
    // If no part with stock found, use the first available match
    if (!testPart) {
      for (const part of parts) {
        const shopifyProduct = monitorIdToShopifyMap.get(part.Id);
        if (shopifyProduct) {
          console.log(`⚠️  Using part without stock for basic testing: ${part.PartNumber}`);
          testPart = part;
          testProduct = shopifyProduct;
          break;
        }
      }
    }
    
    if (!testPart || !testProduct) {
      console.log('❌ No Monitor parts found with corresponding Shopify products');
      console.log('   This means either:');
      console.log('   1. No Shopify variants have monitor_id metafields matching the Monitor parts');
      console.log('   2. The Monitor parts returned don\'t match any existing Shopify variants');
      console.log('   Please check your monitor_id metafield mappings in Shopify');
      return;
    }
    
    console.log(`✅ Found test part: ${testPart.PartNumber} (Monitor ID: ${testPart.Id})`);
    console.log(`✅ Mapped to Shopify: ${testProduct.productTitle} (${testProduct.sku})`);
    
    try {
      // Get stock data from PartLocations (always get, even if empty)
      const allWarehouseStock = getStockDataFromPartLocations(testPart.PartLocations);
      
      if (Object.keys(allWarehouseStock).length === 0) {
        console.log('⚠️  No stock data found in mapped warehouses for this part - will populate with zeros');
      }
      
      // Get stock control data for this product (always get, even if empty)
      const partData = await fetchPartByPartNumberFromMonitor(testPart.PartNumber);
      const stockControlJson = partData ? generateStockControlJson(partData.PartPlanningInformations) : {};
      
      // Determine stock status based on current stock and stock control (always determine)
      const stockStatus = determineStockStatus(allWarehouseStock, stockControlJson);
      
      // Get Shopify locations with monitor_id mapping
      console.log("🔍 Fetching Shopify locations for inventory updates...");
      const locations = await getShopifyLocations(shop, accessToken);
      const locationMap = new Map();
      
      locations.forEach(location => {
        if (location.monitorId) {
          locationMap.set(location.monitorId, location);
        }
      });
      
      // Show what we're about to update
      console.log('\n🎯 SINGLE TEST UPDATE - ACTUAL SHOPIFY CHANGES');
      console.log('===============================================');
      console.log(`Monitor Part: ${testPart.PartNumber} (ID: ${testPart.Id})`);
      console.log(`Shopify Product: ${testProduct.productTitle}`);
      console.log(`Shopify Variant: ${testProduct.sku} (${testProduct.variantId})`);
      
      // 1. Update metafields
      const metafieldSuccess = await updateVariantMetafields(
        shop,
        accessToken,
        testProduct.variantId,
        allWarehouseStock,
        stockControlJson,
        stockStatus
      );

      if (metafieldSuccess) {
        console.log('✅ Successfully updated metafields:');
        
        // Show what was updated for all warehouses
        for (const [warehouseId, metafieldKey] of Object.entries(WAREHOUSE_METAFIELD_MAPPING)) {
          const stock = allWarehouseStock[warehouseId] || 0;
          const warehouseName = WAREHOUSE_JSON_MAPPING[warehouseId];
          console.log(`   ${metafieldKey}: ${stock} (${warehouseName})`);
        }
        
        console.log(`   custom.stock_control: ${JSON.stringify(stockControlJson)}`);
        console.log(`   custom.stock_status: "${stockStatus}"`);
      } else {
        console.log('❌ Failed to update metafields');
      }
      
      // 2. Update inventory levels
      console.log('\n📦 Updating inventory levels...');
      let inventoryUpdated = false;
      
      // Process all warehouses in our mapping, not just those with stock data
      for (const warehouseId of Object.keys(WAREHOUSE_METAFIELD_MAPPING)) {
        const currentBalance = allWarehouseStock[warehouseId] || 0; // Use 0 if no stock data
        const warehouseName = WAREHOUSE_JSON_MAPPING[warehouseId] || 'Unknown';
        console.log(`   Processing ${warehouseName} warehouse - Monitor balance: ${currentBalance}`);
        
        const shopifyLocation = locationMap.get(warehouseId);
        if (!shopifyLocation) {
          console.log(`   ⚠️  No Shopify location mapped for ${warehouseName} warehouse`);
          continue;
        }

        // Get inventory item ID for this variant
        const inventoryItemId = await getInventoryItemId(shop, accessToken, testProduct.variantId);
        if (!inventoryItemId) {
          console.log(`   ❌ Could not get inventory item ID for variant`);
          continue;
        }

        // Ensure inventory item is stocked at location (activation check)
        const isStocked = await ensureInventoryItemAtLocation(shop, accessToken, inventoryItemId, shopifyLocation.id);
        if (!isStocked) {
          console.log(`   ❌ Failed to ensure inventory item is activated at location ${shopifyLocation.name}`);
          continue;
        }

        // ALWAYS update inventory level in Shopify with current Monitor balance
        console.log(`   🔄 Updating Shopify inventory level to ${Math.floor(currentBalance)} units...`);
        const success = await updateShopifyInventoryLevel(
          shop, 
          accessToken, 
          inventoryItemId, 
          shopifyLocation.id, 
          currentBalance
        );

        if (success) {
          console.log(`   ✅ Successfully synced ${shopifyLocation.name}: ${Math.floor(currentBalance)} units`);
          inventoryUpdated = true;
        } else {
          console.log(`   ❌ Failed to update inventory at ${shopifyLocation.name}`);
        }
      }
      
      // Summary
      console.log('\n📊 SINGLE TEST RESULTS:');
      console.log('========================');
      
      if (metafieldSuccess) {
        const stockMetafieldCount = Object.keys(WAREHOUSE_METAFIELD_MAPPING).length; // All warehouses are now updated
        const controlMetafieldCount = 1; // Always add stock_control now
        const totalMetafields = stockMetafieldCount + controlMetafieldCount + 1; // +1 for stock_status
        
        console.log(`✅ Metafields updated: ${totalMetafields} total`);
        console.log(`   • Stock metafields: ${stockMetafieldCount} (all warehouses)`);
        console.log(`   • Stock control: ${controlMetafieldCount}`);
        console.log(`   • Stock status: 1`);
      } else {
        console.log(`❌ Metafields failed to update`);
      }
      
      if (inventoryUpdated) {
        const inventoryUpdateCount = Object.keys(WAREHOUSE_METAFIELD_MAPPING).filter(warehouseId => locationMap.get(warehouseId)).length;
        console.log(`✅ Inventory levels updated: ${inventoryUpdateCount} locations`);
      } else {
        console.log(`⚠️  No inventory levels updated (no matching locations or API errors)`);
      }
      
      if (metafieldSuccess || inventoryUpdated) {
        console.log('\n🎉 Single test PASSED! The sync logic is working correctly.');
        console.log('   You can now run the full inventory sync with confidence.');
      } else {
        console.log('\n❌ Single test FAILED! Please check the configuration and try again.');
      }
      
    } catch (error) {
      console.error('❌ Error in single test:', error);
      console.log('\n💡 Single test failed - please check the error above and try again.');
    }
    
    console.log('\n🧪 Single test completed');
    return;
  }

  let shop, accessToken;

  if (currentUseAdvancedStore) {
    // Use Advanced store configuration
    console.log("🔧 Using Advanced store configuration...");
    shop = process.env.ADVANCED_STORE_DOMAIN;
    accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    console.log(`🏪 Shop: ${shop ? 'Set' : 'Missing'}`);
    console.log(`🔑 Access Token: ${accessToken ? 'Set' : 'Missing'}`);

    if (!shop || !accessToken) {
      console.log("❌ Advanced store configuration missing!");
      return;
    }
    
    // Validate the advanced store session
    console.log("🔍 Validating advanced store session...");
    const isValidSession = await validateSession(shop, accessToken);
    console.log(`✅ Session validation result: ${isValidSession}`);
    if (!isValidSession) {
      console.log("❌ Advanced store session is invalid.");
      return;
    }
  } else {
    // Use development store with OAuth (existing logic)
    const prisma = (await import("./db.server.js")).default;
    const session = await prisma.session.findFirst();
    
    if (!session) {
      console.log("No Shopify session found. Cannot sync inventory.");
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
    let locations = [];
    
    try {
      locations = await getShopifyLocations(shop, accessToken);
    } catch (error) {
      console.error("❌ Failed to fetch Shopify locations:", error.message);
      console.log("   This could be due to API throttling or network issues");
      console.log("   Please wait a moment and try again");
      return;
    }
    
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

    // Get all parts from Monitor with stock data
    console.log("Fetching parts from Monitor for stock sync...");
    const parts = await fetchPartsForStock();
    
    if (parts.length === 0) {
      console.log("❌ No parts found in Monitor with stock data.");
      return;
    }

    console.log(`Found ${parts.length} parts from Monitor to process`);

    // Get all products with monitor_id metafields for mapping
    console.log("Fetching Shopify products with Monitor IDs for mapping...");
    let shopifyProducts = [];
    
    try {
      shopifyProducts = await getShopifyProductsWithMonitorIds(shop, accessToken);
    } catch (error) {
      console.error("❌ Failed to fetch Shopify products:", error.message);
      console.log("   This could be due to API throttling or network issues");
      console.log("   Please wait a moment and try again");
      return;
    }
    
    // Create a map of Monitor ID to Shopify product data
    const monitorIdToShopifyMap = new Map();
    shopifyProducts.forEach(product => {
      monitorIdToShopifyMap.set(product.monitorId, product);
    });

    console.log(`Found ${shopifyProducts.length} Shopify products with Monitor IDs for mapping`);

    let successCount = 0;
    let errorCount = 0;

    // Process each part from Monitor
    for (const part of parts) {
      const displayName = part.PartNumber || `Part ID: ${part.Id}`;
      console.log(`Processing part ${displayName} (Monitor ID: ${part.Id})...`);
      
      try {
        // Find corresponding Shopify product variant
        const shopifyProduct = monitorIdToShopifyMap.get(part.Id);
        if (!shopifyProduct) {
          console.log(`  No Shopify product found for Monitor ID ${part.Id}`);
          continue;
        }

        // Get stock data from PartLocations (always get, even if empty)
        const allWarehouseStock = getStockDataFromPartLocations(part.PartLocations);
        
        if (Object.keys(allWarehouseStock).length > 0) {
          console.log(`  Found stock data for warehouses: ${Object.keys(allWarehouseStock).join(', ')}`);
        } else {
          console.log(`  No stock data found in mapped warehouses for part ${displayName} - will populate with zeros`);
        }

        // Get stock control data for this product (always get, even if empty)
        const partData = await fetchPartByPartNumberFromMonitor(part.PartNumber);
        const stockControlJson = partData ? generateStockControlJson(partData.PartPlanningInformations) : {};
        
        // Determine stock status based on current stock and stock control (always determine)
        const stockStatus = determineStockStatus(allWarehouseStock, stockControlJson);
        
        // Always update variant metafields with stock data, stock control, and stock status
        const metafieldSuccess = await updateVariantMetafields(
          shop,
          accessToken,
          shopifyProduct.variantId,
          allWarehouseStock,
          stockControlJson,
          stockStatus
        );

        if (metafieldSuccess) {
          const stockMetafieldUpdates = Object.entries(WAREHOUSE_METAFIELD_MAPPING)
            .map(([warehouseId, metafieldKey]) => {
              const stock = allWarehouseStock[warehouseId] || 0;
              return `${metafieldKey}=${stock}`;
            })
            .join(', ');
          
          const controlUpdates = 'custom.stock_control=JSON'; // Always updated now
          const statusUpdate = `custom.stock_status="${stockStatus}"`;
          
          const allUpdates = [stockMetafieldUpdates, controlUpdates, statusUpdate].join(', ');
          
          console.log(`  ✅ Updated metafields: ${allUpdates}`);
        } else {
          console.log(`  ⚠️  Failed to update metafields for ${displayName}`);
        }

        // Update Shopify inventory levels for each warehouse (including those with 0 stock)
        let inventoryUpdated = false;
        
        // Process all warehouses in our mapping, not just those with stock data
        for (const warehouseId of Object.keys(WAREHOUSE_METAFIELD_MAPPING)) {
          const currentBalance = allWarehouseStock[warehouseId] || 0; // Use 0 if no stock data
          const warehouseName = WAREHOUSE_JSON_MAPPING[warehouseId] || 'Unknown';
          console.log(`  Processing ${warehouseName} warehouse (${warehouseId}) - Monitor balance: ${currentBalance}`);

          // Find the corresponding Shopify location
          const shopifyLocation = locationMap.get(warehouseId);
          if (!shopifyLocation) {
            console.log(`    ⚠️  No Shopify location mapped for ${warehouseName} warehouse`);
            continue;
          }

          // Get inventory item ID for this variant
          const inventoryItemId = await getInventoryItemId(shop, accessToken, shopifyProduct.variantId);
          if (!inventoryItemId) {
            console.log(`    ❌ Could not get inventory item ID for variant`);
            continue;
          }

          // Ensure inventory item is stocked at location (activation check)
          const isStocked = await ensureInventoryItemAtLocation(shop, accessToken, inventoryItemId, shopifyLocation.id);
          if (!isStocked) {
            console.log(`    ❌ Failed to ensure inventory item is activated at location ${shopifyLocation.name}`);
            continue;
          }

          // ALWAYS update inventory level in Shopify with current Monitor balance
          console.log(`    🔄 Updating Shopify inventory level to ${Math.floor(currentBalance)} units...`);
          const success = await updateShopifyInventoryLevel(
            shop, 
            accessToken, 
            inventoryItemId, 
            shopifyLocation.id, 
            currentBalance
          );

          if (success) {
            console.log(`    ✅ Successfully synced ${shopifyLocation.name}: ${Math.floor(currentBalance)} units`);
            inventoryUpdated = true;
          } else {
            console.log(`    ❌ Failed to update inventory at ${shopifyLocation.name}`);
          }
        }

        if (inventoryUpdated || metafieldSuccess) {
          successCount++;
        } else {
          errorCount++;
        }

      } catch (error) {
        console.error(`  ❌ Error processing part ${displayName}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n✅ Inventory sync completed!`);
    console.log(`  Successfully updated: ${successCount} variants (inventory levels + stock metafields)`);
    console.log(`  Errors: ${errorCount} variants`);

  } catch (error) {
    console.error("❌ Failed to sync inventory:", error);
    throw error;
  }
}

// Only run when executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  // Display usage instructions
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📋 Inventory Sync Job Usage:

This job syncs inventory levels from Monitor to Shopify locations and updates
custom metafields on product variants with current stock values from all warehouses.

Warehouse to Metafield Mapping:
  933124852911871989 → custom.stock_vittsjo
  933124156053429919 → custom.stock_ronas  
  1189106270728482943 → custom.stock_lund
  933126667535575191 → custom.stock_sundsvall
  933125224426542349 → custom.stock_goteborg
  933126074830088482 → custom.stock_stockholm

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
🚀 Starting Inventory & Metafield Sync Job
📦 Syncs inventory levels and updates stock metafields for all warehouses
📝 Use --help for usage instructions
  `);

  // Run the sync
  // syncInventory();
}
