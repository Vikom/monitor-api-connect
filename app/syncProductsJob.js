import "@shopify/shopify-api/adapters/node";
import { fetchProductsFromMonitor, fetchARTFSCFromMonitor, fetchEntityChangeLogsFromMonitor, fetchProductsByIdsFromMonitor, fetchSingleProductByPartNumberFromMonitor, fetchOutletPriceFromMonitor, clearFailedARTFSCFetches, reportFailedARTFSCFetches } from "./utils/monitor.server.js";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import fetch from "node-fetch";
dotenv.config();

// Unit mapping from Monitor StandardUnitId to unit codes
const STANDARD_UNIT_MAPPING = {
  "896454559822157228": "st",        // Styck
  "896454559822157331": "mm",        // Millimeter
  "896454559822157366": "m²",        // Kvadratmeter
  "896454559822157389": "kg",        // Kilo
  "896454559822157424": "m",         // Meter
  "964635041975763896": "m³",        // Kubikmeter
  "989630543418881598": "h",         // Timme
  "1066716939765765413": "frp",      // Förpackning
  "1067959871794544563": "l",        // Liter
  "1068890724534919021": "rle",      // Rulle
  "1068891474006718462": "pal",      // Pall
  "1069043501891593759": "pkt",      // Paket
  "1069043554504943125": "krt",      // Kartong
  "1069043662952867563": "pås",      // Påse
  "1069044050573666032": "Sk"        // Säck
};

// Function to get unit code from StandardUnitId
function getUnitCodeFromStandardUnitId(standardUnitId) {
  if (!standardUnitId) return null;
  const unitCode = STANDARD_UNIT_MAPPING[standardUnitId.toString()];
  return unitCode || null;
}

// Get command line arguments to determine which store to sync to
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a') || global.useAdvancedStore;
const isManualRun = args.includes('--manual') || args.includes('-m');

// Single product sync mode
const isSingleProductSync = args.includes('--single') || args.includes('-s');
let singlePartNumber = null;
if (isSingleProductSync) {
  // Single product sync requires both --manual and --advanced flags
  if (!isManualRun || !useAdvancedStore) {
    console.error('❌ --single flag requires both --manual and --advanced flags');
    console.log('Usage: node app/syncProductsJob.js --advanced --manual --single <PartNumber>');
    console.log('Run "node app/syncProductsJob.js --help" for more information.');
    process.exit(1);
  }
  
  // Find the PartNumber argument after --single or -s
  const singleIndex = args.findIndex(arg => arg === '--single' || arg === '-s');
  if (singleIndex !== -1 && singleIndex + 1 < args.length) {
    singlePartNumber = args[singleIndex + 1];
  } else {
    console.error('❌ --single flag requires a PartNumber argument');
    console.log('Usage: node app/syncProductsJob.js --advanced --manual --single <PartNumber>');
    console.log('Run "node app/syncProductsJob.js --help" for more information.');
    process.exit(1);
  }
}

// Store this globally for cron access
global.useAdvancedStore = useAdvancedStore;

console.log(`🎯 Target store: ${useAdvancedStore ? 'Advanced Store' : 'Development Store'}`);
if (isManualRun) {
  console.log(`🔧 Manual run mode: ${isManualRun ? 'Enabled' : 'Disabled'}`);
}
if (isSingleProductSync) {
  console.log(`🔍 Single product sync mode: ${singlePartNumber}`);
}

// Function to log Railway's outbound IP for Monitor API whitelisting
async function logRailwayIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    console.log(`RAILWAY OUTBOUND IP: ${data.ip}`);
    console.log('================================');
  } catch (error) {
    console.log('❌ Could not determine outbound IP:', error.message);
  }
}

// Log IP at startup
logRailwayIP();

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
  
  const testQuery = `query {
    shop {
      id
      name
    }
  }`;

  try {
    const result = await makeGraphQLRequest(shop, accessToken, testQuery, "session validation");
    
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

// Helper function for making GraphQL requests with error handling and retry logic
async function makeGraphQLRequest(shop, accessToken, query, operation = "GraphQL request", maxRetries = 2) {
  const fetch = (await import('node-fetch')).default;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query }),
      });
      
      // Check if response is OK
      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - wait briefly and retry
          console.warn(`⚠️  Rate limited during ${operation} (attempt ${attempt}/${maxRetries}). Retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Brief 1s wait for rate limit
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Check content type
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Received non-JSON response: ${contentType}. This might indicate rate limiting or server error.`);
      }
      
      const result = await response.json();
      return result;
      
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`❌ Failed ${operation} after ${maxRetries} attempts: ${error.message}`);
        throw error;
      }
      
      console.warn(`⚠️  ${operation} failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying...`);
    }
  }
}

// Helper function to generate metafields for a variation, including ARTFSC data
async function generateMetafieldsForVariation(variation) {
  const metafields = [
    {
      namespace: "custom",
      key: "monitor_id",
      value: variation.id.toString(),
      type: "single_line_text_field"
    }
  ];

  // Add custom dimension and volume metafields if they exist
  if (variation.ExtraFields?.ARTLENGTH) {
    metafields.push({
      namespace: "custom",
      key: "length",
      value: Number(variation.ExtraFields.ARTLENGTH).toFixed(2),
      type: "number_decimal"
    });
  }

  if (variation.ExtraFields?.ARTWIDTH) {
    metafields.push({
      namespace: "custom",
      key: "width",
      value: Number(variation.ExtraFields.ARTWIDTH).toFixed(2),
      type: "number_decimal"
    });
  }

  if (variation.ExtraFields?.ARTDEPTH) {
    metafields.push({
      namespace: "custom",
      key: "depth",
      value: Number(variation.ExtraFields.ARTDEPTH).toFixed(2),
      type: "number_decimal"
    });
  }

  if (variation.volume != null) {
    metafields.push({
      namespace: "custom",
      key: "volume",
      value: Number(variation.volume).toFixed(2),
      type: "number_decimal"
    });
  }

  if (variation.PurchaseQuantityPerPackage != null) {
    metafields.push({
      namespace: "custom",
      key: "quantity_package",
      value: Number(variation.PurchaseQuantityPerPackage).toFixed(2),
      type: "number_decimal"
    });
  }

  // Add standard unit metafield if StandardUnitId is available
  if (variation.StandardUnitId) {
    const unitCode = getUnitCodeFromStandardUnitId(variation.StandardUnitId);
    if (unitCode) {
      metafields.push({
        namespace: "custom",
        key: "standard_unit",
        value: unitCode,
        type: "single_line_text_field"
      });
    }
    
    // Also store the raw StandardUnitId for pricing API
    metafields.push({
      namespace: "custom",
      key: "unitid",
      value: variation.StandardUnitId.toString(),
      type: "single_line_text_field"
    });
  }

  if (variation.partCodeId) {
    metafields.push({
      namespace: "custom",
      key: "partcode_id",
      value: variation.partCodeId,
      type: "single_line_text_field"
    });
  }

  // Add outlet metafield if ProductGroup is 1229581166640460381
  if (variation.productGroupId === "1229581166640460381") {
    metafields.push({
      namespace: "custom",
      key: "outlet",
      value: "true",
      type: "boolean"
    });
  }

  // Fetch ARTFSC data if the variation has the ARTFSC field
  if (variation.hasARTFSC) {
    try {
      console.log(`Fetching ARTFSC data for product ${variation.id}...`);
      const artfscDescription = await fetchARTFSCFromMonitor(variation.id);
      if (artfscDescription) {
        console.log(`Found ARTFSC: ${artfscDescription} for product ${variation.id}`);
        metafields.push({
          namespace: "custom",
          key: "fsc_pefc",
          value: artfscDescription,
          type: "single_line_text_field"
        });
      } else {
        console.log(`No ARTFSC description found for product ${variation.id}`);
      }
    } catch (error) {
      console.error(`Failed to fetch ARTFSC for product ${variation.id}:`, error);
      // Continue without the ARTFSC metafield rather than failing the entire sync
    }
  }

  return metafields;
}

// Helper function to fetch and process a single product by PartNumber from Monitor
async function fetchSingleProductByPartNumber(partNumber) {
  try {
    console.log(`Fetching product by PartNumber: ${partNumber} from Monitor API...`);
    const part = await fetchSingleProductByPartNumberFromMonitor(partNumber);
    
    if (!part) {
      console.log(`No part found with PartNumber: ${partNumber}`);
      return [];
    }
    
    // Check if the part has ARTWEBNAME (required for sync)
    const productName = part.ExtraFields?.find(f => f.Identifier === "ARTWEBNAME");
    if (!productName?.StringValue || productName.StringValue.trim() === "") {
      console.log(`Part ${partNumber} found but has no ARTWEBNAME set. Skipping sync.`);
      return [];
    }
    
    console.log(`Found part: ${part.PartNumber} - ${productName.StringValue}`);
    
    // Transform the Monitor part data to match the format expected by syncProducts
    const productVariation = part.ExtraFields?.find(f => f.Identifier === "ARTWEBVAR");
    const finalProductName = productName.StringValue;
    const finalProductVariation = (productVariation?.StringValue && productVariation.StringValue.trim() !== "")
      ? productVariation.StringValue
      : part.PartNumber;

    // Convert ExtraFields array to an object for easier access in sync job
    const extraFieldsObj = {};
    if (Array.isArray(part.ExtraFields)) {
      part.ExtraFields.forEach(field => {
        if (field.Identifier) {
          // Use the appropriate value based on the field type
          let value = null;
          if (field.DecimalValue !== null && field.DecimalValue !== undefined) {
            value = field.DecimalValue;
          } else if (field.StringValue !== null && field.StringValue !== undefined) {
            value = field.StringValue;
          } else if (field.IntegerValue !== null && field.IntegerValue !== undefined) {
            value = field.IntegerValue;
          } else if (field.SelectedOptionId !== null && field.SelectedOptionId !== undefined) {
            value = field.SelectedOptionId;
          } else if (field.SelectedOptionIds !== null && field.SelectedOptionIds !== undefined) {
            value = field.SelectedOptionIds;
          }
          
          if (value !== null) {
            extraFieldsObj[field.Identifier] = value;
          }
        }
      });
    }

    // Check if this product is in the outlet product group (1229581166640460381)
    const isOutletProduct = part.ProductGroupId === "1229581166640460381";
    let productPrice = null;
    
    if (isOutletProduct) {
      console.log(`Fetching outlet price for product ${part.PartNumber} (ID: ${part.Id})`);
      const outletPrice = await fetchOutletPriceFromMonitor(part.Id);
      if (outletPrice) {
        console.log(`Found outlet price ${outletPrice} for product ${part.PartNumber}`);
        productPrice = outletPrice;
      }
      // If no outlet price found, productPrice remains null even for outlet products
    }
    // For non-outlet products, productPrice remains null to force dynamic pricing
    
    const processedProduct = {
      id: part.Id,
      name: part.PartNumber,
      sku: part.PartNumber,
      description: part.Description || "",
      // Only set price for outlet products with valid outlet price, otherwise null
      price: productPrice,
      weight: part.WeightPerUnit,
      length: part.Length,
      width: part.Width,
      height: part.Height,
      volume: part.VolumePerUnit,
      category: part.CategoryString,
      barcode: part.Gs1Code,
      status: part.Status,
      productName: finalProductName,
      productVariation: finalProductVariation,
      PurchaseQuantityPerPackage: part.QuantityPerPackage,
      StandardUnitId: part.StandardUnitId,
      // Map both ProductGroup and PartCode for Shopify collections
      productGroupId: part.ProductGroup?.Id || null,
      productGroupDescription: part.ProductGroup?.Description || null,
      partCodeId: part.PartCode?.Id || null,
      partCodeDescription: part.PartCode?.Description || null,
      // Convert ExtraFields array to object for easier access
      ExtraFields: extraFieldsObj,
      // Flag to indicate if this product has ARTFSC (for async fetching)
      hasARTFSC: extraFieldsObj.ARTFSC !== undefined,
      // Pricing metadata
      isOutletProduct: isOutletProduct,
      hasOutletPrice: productPrice !== null,
      originalStandardPrice: part.StandardPrice,
    };
    
    console.log(`✅ Successfully processed single product: ${finalProductName} (${part.PartNumber})`);
    return [processedProduct];
    
  } catch (error) {
    console.error(`Error fetching single product by PartNumber ${partNumber}:`, error);
    throw error;
  }
}

export async function syncProducts(isIncrementalSync = false, singlePartNumberParam = null) {
  let shop, accessToken;
  
  // Use global variable if set (from cron), otherwise use the original variable
  const currentUseAdvancedStore = global.useAdvancedStore !== undefined ? global.useAdvancedStore : useAdvancedStore;

  if (currentUseAdvancedStore) {
    // Use Advanced store configuration
    shop = process.env.ADVANCED_STORE_DOMAIN;
    accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    if (!shop || !accessToken) {
      console.log("❌ Advanced store configuration missing!");
      return;
    }

    console.log(`🔗 Using Advanced store: ${shop}`);
    
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
      console.log("No Shopify session found. Cannot sync products.");
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

  console.log("✅ Store session is valid. Starting product sync...");
  
  // Clear any previous failed ARTFSC fetches
  clearFailedARTFSCFetches();
  
  // Initialize tracking for products with failed variant creation
  global.productsWithFailedVariants = [];
  
  // Determine if we're doing single product sync based on parameter or global flag
  const isSingleSync = singlePartNumberParam || (typeof isSingleProductSync !== 'undefined' && isSingleProductSync);
  const partNumberToSync = singlePartNumberParam || (typeof singlePartNumber !== 'undefined' ? singlePartNumber : null);
  
  if (isSingleSync && partNumberToSync) {
    console.log(`🔍 Running single product sync for PartNumber: ${partNumberToSync}`);
  } else if (isIncrementalSync) {
    console.log("🔄 Running incremental sync (changes only)...");
  } else {
    console.log("🔄 Running full sync (all products)...");
  }
  
  // Use the low-level GraphQL client from @shopify/shopify-api
  try {
    let products;
    try {
      if (isSingleSync && partNumberToSync) {
        // Fetch single product by PartNumber
        console.log(`Fetching single product by PartNumber: ${partNumberToSync}`);
        products = await fetchSingleProductByPartNumber(partNumberToSync);
        
        if (!products || products.length === 0) {
          console.log(`❌ No product found with PartNumber: ${partNumberToSync}`);
          return;
        }
        
        console.log(`✅ Found product: ${products[0].productName} (${products[0].name})`);
      } else if (isIncrementalSync) {
        // Fetch only changed products
        console.log("Fetching entity change logs from Monitor...");
        const changedProductIds = await fetchEntityChangeLogsFromMonitor('products');
        
        if (changedProductIds.length === 0) {
          console.log("✅ No product changes found in the last 24 hours. Sync complete.");
          return;
        }
        
        console.log(`Found ${changedProductIds.length} products with changes, fetching product details...`);
        products = await fetchProductsByIdsFromMonitor(changedProductIds);
        console.log(`Fetched ${products.length} changed products from Monitor API`);
      } else {
        // Fetch all products (existing behavior)
        products = await fetchProductsFromMonitor();
        console.log(`Fetched ${products.length} products from Monitor API`);
      }
      
      if (!Array.isArray(products) || products.length === 0) {
        console.log("No products found to sync.");
        return;
      }
    } catch (err) {
      console.error("Error fetching products", err);
      return;
    }
    
    // Group products by productName (ARTWEBNAME)
    const productGroups = new Map();
    
    for (const product of products) {
      if (!product.productName || product.productName.trim() === "") {
        console.warn("Skipping product with blank productName:", product);
        continue;
      }
      
      console.log(`Grouping product: "${product.productName}" with variation: "${product.productVariation}"`);
      
      if (!productGroups.has(product.productName)) {
        productGroups.set(product.productName, []);
        console.log(`  -> Created new group for: "${product.productName}"`);
      } else {
        console.log(`  -> Added to existing group for: "${product.productName}"`);
      }
      productGroups.get(product.productName).push(product);
    }

    console.log(`Found ${productGroups.size} unique product groups to process`);
    
    // Track failed products for retry
    const failedProducts = new Map();
    let processedCount = 0;
    
    // Get the Online Store sales channel ID for publishing products
    console.log("Getting Online Store sales channel ID...");
    const onlineStoreSalesChannelId = await getOnlineStoreSalesChannelId(shop, accessToken);
    if (!onlineStoreSalesChannelId) {
      console.warn("⚠️  Could not get Online Store sales channel ID. Products will be created but not published.");
    }
    
    // Show grouping summary
    for (const [productName, variations] of productGroups) {
      console.log(`Group: "${productName}" has ${variations.length} variations: [${variations.map(v => v.productVariation).join(', ')}]`);
    }

    // Process each product group
    for (const [productName, variations] of productGroups) {
      console.log(`Processing product: ${productName} with ${variations.length} variations`);
      
      // Get collections for both ProductGroup and PartCode
      const productGroupId = variations[0]?.productGroupId;
      const productGroupDescription = variations[0]?.productGroupDescription;
      const partCodeId = variations[0]?.partCodeId;
      const partCodeDescription = variations[0]?.partCodeDescription;
      
      const collectionIds = [];
      
      if (productGroupId && productGroupDescription) {
        console.log(`  🏷️  Finding collection for ProductGroup: "${productGroupDescription}" (ID: ${productGroupId})`);
        try {
          const productGroupCollectionId = await findExistingCollection(shop, accessToken, productGroupId, productGroupDescription);
          if (productGroupCollectionId) {
            collectionIds.push(productGroupCollectionId);
          }
        } catch (error) {
          console.warn(`⚠️  Failed to find ProductGroup collection "${productGroupDescription}": ${error.message}. Continuing without this collection...`);
        }
      }
      
      if (partCodeId && partCodeDescription) {
        console.log(`  🏷️  Finding collection for PartCode: "${partCodeDescription}" (ID: ${partCodeId})`);
        try {
          const partCodeCollectionId = await findExistingCollection(shop, accessToken, partCodeId, partCodeDescription);
          if (partCodeCollectionId) {
            collectionIds.push(partCodeCollectionId);
          }
        } catch (error) {
          console.warn(`⚠️  Failed to find PartCode collection "${partCodeDescription}": ${error.message}. Continuing without this collection...`);
        }
      }
      
      // Check if product already exists in Shopify by productName
      let existingProduct;
      try {
        existingProduct = await findExistingProductByName(shop, accessToken, productName);
      } catch (error) {
        console.error(`⚠️  Failed to check existing product "${productName}": ${error.message}`);
        console.log(`⏭️  Adding "${productName}" to failed products list for retry...`);
        failedProducts.set(productName, { variations, error: error.message });
        continue;
      }
      
      try {
        if (existingProduct) {
          console.log(`Product "${productName}" already exists, adding new variations if needed`);
          const variationsAdded = await addVariationsToExistingProduct(shop, accessToken, existingProduct.id, variations);
          
          if (!variationsAdded) {
            console.error(`❌ Failed to add variations to existing product ${existingProduct.id}. Some variants may be missing.`);
            // Track this for reporting
            if (!global.productsWithFailedVariants) {
              global.productsWithFailedVariants = [];
            }
            global.productsWithFailedVariants.push({
              productId: existingProduct.id,
              productName,
              variationCount: variations.length,
              timestamp: new Date().toISOString(),
              isExistingProduct: true
            });
          }
          
          // Add product to all collections
          for (const collectionId of collectionIds) {
            await addProductToCollection(shop, accessToken, existingProduct.id, collectionId);
          }
          
          // Ensure existing product is published to Online Store
          if (onlineStoreSalesChannelId) {
            await publishProductToOnlineStore(shop, accessToken, existingProduct.id, onlineStoreSalesChannelId);
          }
        } else {
          console.log(`Creating new product: ${productName}`);
          const newProductId = await createNewProductWithVariations(shop, accessToken, productName, variations, onlineStoreSalesChannelId);
          
          if (newProductId) {
            // Add product to all collections
            for (const collectionId of collectionIds) {
              await addProductToCollection(shop, accessToken, newProductId, collectionId);
            }
            
            // Publish new product to Online Store
            if (onlineStoreSalesChannelId) {
              await publishProductToOnlineStore(shop, accessToken, newProductId, onlineStoreSalesChannelId);
            }
          }
        }
        
        processedCount++;
        console.log(`✅ Successfully processed "${productName}" (${processedCount}/${productGroups.size})`);
        
      } catch (error) {
        console.error(`⚠️  Failed to process product "${productName}": ${error.message}`);
        console.log(`⏭️  Adding "${productName}" to failed products list for retry...`);
        failedProducts.set(productName, { variations, error: error.message });
        continue;
      }
    }
    
    // Summary of first pass
    console.log(`\n📊 First pass completed:`);
    console.log(`   ✅ Successfully processed: ${processedCount} products`);
    console.log(`   ❌ Failed products: ${failedProducts.size} products`);
    
    // Retry failed products once
    let retrySuccessCount = 0;
    let retryFailedCount = 0;
    
    if (failedProducts.size > 0) {
      console.log(`\n🔄 Retrying ${failedProducts.size} failed products...`);
      
      for (const [productName, { variations }] of failedProducts) {
        console.log(`🔄 Retrying product: ${productName}`);
        
        try {
          // Get collections for both ProductGroup and PartCode
          const productGroupId = variations[0]?.productGroupId;
          const productGroupDescription = variations[0]?.productGroupDescription;
          const partCodeId = variations[0]?.partCodeId;
          const partCodeDescription = variations[0]?.partCodeDescription;
          
          const collectionIds = [];
          
          if (productGroupId && productGroupDescription) {
            try {
              const productGroupCollectionId = await findExistingCollection(shop, accessToken, productGroupId, productGroupDescription);
              if (productGroupCollectionId) {
                collectionIds.push(productGroupCollectionId);
              }
            } catch (error) {
              console.warn(`⚠️  [Retry] Failed to find ProductGroup collection "${productGroupDescription}": ${error.message}. Continuing without this collection...`);
            }
          }
          
          if (partCodeId && partCodeDescription) {
            try {
              const partCodeCollectionId = await findExistingCollection(shop, accessToken, partCodeId, partCodeDescription);
              if (partCodeCollectionId) {
                collectionIds.push(partCodeCollectionId);
              }
            } catch (error) {
              console.warn(`⚠️  [Retry] Failed to find PartCode collection "${partCodeDescription}": ${error.message}. Continuing without this collection...`);
            }
          }
          
          // Check if any variation has status = 6 (outlet), add outlet collection as last collection
          /*const hasOutletVariant = variations.some(variation => variation.status === 6);
          if (hasOutletVariant) {
            const outletCollectionId = "gid://shopify/Collection/651232051534";
            collectionIds.push(outletCollectionId);
          }*/
          
          // Check if product already exists in Shopify by productName
          const existingProduct = await findExistingProductByName(shop, accessToken, productName);
          
          if (existingProduct) {
            console.log(`Product "${productName}" already exists, adding new variations if needed`);
            const variationsAdded = await addVariationsToExistingProduct(shop, accessToken, existingProduct.id, variations);
            
            if (!variationsAdded) {
              console.error(`❌ [Retry] Failed to add variations to existing product ${existingProduct.id}. Some variants may be missing.`);
              // Track this for reporting
              if (!global.productsWithFailedVariants) {
                global.productsWithFailedVariants = [];
              }
              global.productsWithFailedVariants.push({
                productId: existingProduct.id,
                productName,
                variationCount: variations.length,
                timestamp: new Date().toISOString(),
                isExistingProduct: true,
                isRetryAttempt: true
              });
            }
            
            // Add product to all collections
            for (const collectionId of collectionIds) {
              await addProductToCollection(shop, accessToken, existingProduct.id, collectionId);
            }
            
            // Ensure existing product is published to Online Store
            if (onlineStoreSalesChannelId) {
              await publishProductToOnlineStore(shop, accessToken, existingProduct.id, onlineStoreSalesChannelId);
            }
          } else {
            console.log(`Creating new product: ${productName}`);
            const newProductId = await createNewProductWithVariations(shop, accessToken, productName, variations, onlineStoreSalesChannelId);
            
            if (newProductId) {
              // Add product to all collections
              for (const collectionId of collectionIds) {
                await addProductToCollection(shop, accessToken, newProductId, collectionId);
              }
              
              // Publish new product to Online Store
              if (onlineStoreSalesChannelId) {
                await publishProductToOnlineStore(shop, accessToken, newProductId, onlineStoreSalesChannelId);
              }
            }
          }
          
          retrySuccessCount++;
          console.log(`✅ Retry successful for "${productName}"`);
          
        } catch (error) {
          retryFailedCount++;
          console.error(`❌ Retry failed for "${productName}": ${error.message}`);
        }
      }
      
      console.log(`\n📊 Retry results:`);
      console.log(`   ✅ Retry successful: ${retrySuccessCount} products`);
      console.log(`   ❌ Still failed: ${retryFailedCount} products`);
      
      // List products that still failed after retry
      if (retryFailedCount > 0) {
        console.log(`\n🚨 Products that failed both attempts:`);
        let stillFailedCount = 0;
        for (const [productName, { variations }] of failedProducts) {
          try {
            await findExistingProductByName(shop, accessToken, productName);
          } catch {
            stillFailedCount++;
            console.log(`   ${stillFailedCount}. "${productName}" (${variations.length} variations)`);
          }
        }
      }
    }
    
    const totalSuccessful = processedCount + (failedProducts.size > 0 ? retrySuccessCount || 0 : 0);
    const totalFailed = failedProducts.size - (retrySuccessCount || 0);
    
    console.log(`\n🎯 Final Summary:`);
    console.log(`   📦 Total products processed: ${productGroups.size}`);
    console.log(`   ✅ Successfully synced: ${totalSuccessful}`);
    console.log(`   ❌ Failed to sync: ${totalFailed}`);
    console.log(`   📈 Success rate: ${((totalSuccessful / productGroups.size) * 100).toFixed(1)}%`);
    
    if (totalFailed === 0) {
      console.log(`\n🎉 All products synced successfully!`);
    } else {
      console.log(`\n⚠️  ${totalFailed} products could not be synced. Check the logs above for details.`);
    }
    
    // Report products with failed variant creation
    if (global.productsWithFailedVariants && global.productsWithFailedVariants.length > 0) {
      console.log(`\n🚨 Products with Failed Variant Creation:`);
      console.log(`   Found ${global.productsWithFailedVariants.length} products with variant creation failures:`);
      console.log(`   These products may have "inventory not tracked" issues and need manual attention.\n`);
      
      const newProducts = global.productsWithFailedVariants.filter(p => !p.isExistingProduct);
      const existingProducts = global.productsWithFailedVariants.filter(p => p.isExistingProduct);
      
      if (newProducts.length > 0) {
        const criticalFailures = newProducts.filter(p => p.criticalFailure);
        const fallbackProducts = newProducts.filter(p => p.fallbackUsed && !p.criticalFailure);
        const completeFailures = newProducts.filter(p => !p.fallbackUsed && !p.criticalFailure);
        
        if (criticalFailures.length > 0) {
          console.log(`\n CRITICAL: Products with NO VARIANTS Created (${criticalFailures.length}): `);
          console.log(`   These products exist in Shopify but have ZERO variants with Monitor data!`);
          criticalFailures.forEach((product, index) => {
            console.log(`      ${index + 1}. "${product.productName}" (ID: ${product.productId})`);
            console.log(`         - Expected ${product.variationCount} variants, created ${product.createdVariants} variants`);
            console.log(`         - Failed at: ${product.timestamp}`);
            console.log(`         - Issue: Both bulk creation AND fallback variant creation failed`);
            console.log(`         - Status: Product shows "inventory not tracked" - NO Monitor data linked`);
            console.log(`         - Action: URGENT - Check product data and create variants manually\n`);
          });
        }
        
        if (fallbackProducts.length > 0) {
          console.log(`   📦 New Products with Fallback Variants (${fallbackProducts.length}):`);
          fallbackProducts.forEach((product, index) => {
            console.log(`      ${index + 1}. "${product.productName}" (ID: ${product.productId})`);
            console.log(`         - Expected ${product.variationCount} variants, created ${product.createdVariants} fallback variant`);
            console.log(`         - Failed at: ${product.timestamp}`);
            console.log(`         - Issue: Bulk variant creation failed, used fallback with first variation`);
            console.log(`         - Status: Product has 1 working variant with Monitor data`);
            console.log(`         - Action: Check remaining ${product.variationCount - 1} variants need manual creation\n`);
          });
        }
        
        if (completeFailures.length > 0) {
          console.log(`   ❌ New Products with Other Variant Failures (${completeFailures.length}):`);
          completeFailures.forEach((product, index) => {
            console.log(`      ${index + 1}. "${product.productName}" (ID: ${product.productId})`);
            console.log(`         - Expected ${product.variationCount} variants`);
            console.log(`         - Failed at: ${product.timestamp}`);
            console.log(`         - Issue: Product created but variant creation failed in unexpected way`);
            console.log(`         - Action: Check product status and create variants manually\n`);
          });
        }
      }
      
      if (existingProducts.length > 0) {
        console.log(`   🔄 Existing Products with Failed Variant Additions (${existingProducts.length}):`);
        existingProducts.forEach((product, index) => {
          console.log(`      ${index + 1}. "${product.productName}" (ID: ${product.productId})`);
          console.log(`         - Expected to add ${product.variationCount} variants`);
          console.log(`         - Failed at: ${product.timestamp}`);
          console.log(`         - Issue: Failed to add new variants to existing product`);
          console.log(`         - Action: Check if variants were partially created or need manual addition\n`);
        });
      }
      
      console.log(`⚠️  IMPORTANT: These ${global.productsWithFailedVariants.length} products need manual review in Shopify admin.`);
      console.log(`   - New products without variants will show "inventory not tracked"`);
      console.log(`   - Existing products may be missing some expected variants`);
      
      // Count and highlight critical failures at the end
      const criticalFailures = global.productsWithFailedVariants.filter(p => p.criticalFailure);
      if (criticalFailures.length > 0) {
        console.log(`\nFINAL ALERT: ${criticalFailures.length} PRODUCTS HAVE ZERO VARIANTS! `);
        console.log(`These products exist in Shopify but are completely disconnected from Monitor data.`);
        console.log(`Product names: ${criticalFailures.map(p => `"${p.productName}"`).join(', ')}`);
        console.log(`IMMEDIATE ACTION REQUIRED FOR ${criticalFailures.length} PRODUCTS!`);
      }
    }
    
    // Report any failed ARTFSC fetches
    reportFailedARTFSCFetches();
  } catch (err) {
    console.error("Failed to instantiate GraphqlClient:", err);
    throw err;
  }
}

// Helper function to find existing product by productName
async function findExistingProductByName(shop, accessToken, productName) {
  let endCursor = null;
  let hasNextPage = true;
  
  while (hasNextPage) {
    const checkQuery = `query {
      products(first: 50${endCursor ? `, after: "${endCursor}"` : ""}) {
        edges {
          cursor
          node {
            id
            title
            metafields(first: 5, namespace: "custom") {
              edges {
                node {
                  key
                  value
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
    
    try {
      const checkJson = await makeGraphQLRequest(shop, accessToken, checkQuery, `checking products for "${productName}"`);
      
      if (checkJson.errors) {
        console.error("GraphQL errors while checking products:", JSON.stringify(checkJson.errors, null, 2));
        break;
      }
      
      if (checkJson.data?.products?.edges) {
        for (const edge of checkJson.data.products.edges) {
          const metafields = edge.node.metafields.edges;
          const productNameMetafield = metafields.find(mf => mf.node.key === "product_name" && mf.node.value === productName);
          if (productNameMetafield) {
            return { id: edge.node.id, title: edge.node.title };
          }
        }
      }
      
      hasNextPage = checkJson.data?.products?.pageInfo?.hasNextPage || false;
      endCursor = checkJson.data?.products?.pageInfo?.endCursor;
    } catch (error) {
      console.error(`⚠️  Error checking products for "${productName}": ${error.message}`);
      console.log(`⏭️  Skipping product check and continuing...`);
      break;
    }
  }
  
  return null;
}



// Helper function to create a new product with all its variations
async function createNewProductWithVariations(shop, accessToken, productName, variations, onlineStoreSalesChannelId) {
  const fetch = (await import('node-fetch')).default;
  
  // First, create the product without any options to avoid creating default variants
  const mutation = `mutation productCreate($product: ProductCreateInput!) { 
    productCreate(product: $product) { 
      product { 
        id 
        title 
        status 
      } 
      userErrors { 
        field 
        message 
      } 
    } 
  }`;
  
  const variables = {
    product: {
      title: productName,
      // descriptionHtml: `<p>${variations[0].extraDescription || ""}</p>`,
      status: "ACTIVE",
      vendor: variations[0].vendor || "Sonsab",
      metafields: [
        {
          namespace: "custom",
          key: "product_name",
          value: productName,
          type: "single_line_text_field"
        },
        ...(variations[0].productGroupId ? [{
          namespace: "custom",
          key: "monitor_product_group_id",
          value: variations[0].productGroupId,
          type: "single_line_text_field"
        }] : []),
        ...(variations[0].partCodeId ? [{
          namespace: "custom",
          key: "monitor_part_code_id",
          value: variations[0].partCodeId,
          type: "single_line_text_field"
        }] : [])
      ],
    },
  };

  const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });
  
  const json = await fetchRes.json();
  
  if (json.errors) {
    console.error("Shopify GraphQL errors:", JSON.stringify(json.errors, null, 2));
    return null;
  }
  
  if (json.data?.productCreate?.product) {
    const productId = json.data.productCreate.product.id;
    console.log(`Created product: ${json.data.productCreate.product.title} with ID: ${productId}`);
    
    // First, rename the default "Title" option to "Storlek" using REST API
    const optionRenamed = await renameProductOptionToStorlek(shop, accessToken, productId);
    if (!optionRenamed) {
      console.warn(`⚠️  Failed to rename option to 'Storlek' for product ${productId}. Will use 'Title' instead.`);
    }
    
    // Now create variants using productVariantsBulkCreate (this will automatically create the option)
    const variantsCreated = await createProductVariants(shop, accessToken, productId, variations);
    
    if (!variantsCreated) {
      console.error(`❌ Failed to create variants for product ${productId}. Attempting to create at least one variant...`);
      
      // Try to create at least one variant with the first variation's data
      const fallbackVariantCreated = await createFallbackVariant(shop, accessToken, productId, variations[0]);
      
      if (!fallbackVariantCreated) {
        console.error(`❌ Failed to create even a fallback variant for product ${productId}. Product will remain without variants - CRITICAL ISSUE.`);
        // Track this as a critical failure but don't delete the product
        if (!global.productsWithFailedVariants) {
          global.productsWithFailedVariants = [];
        }
        global.productsWithFailedVariants.push({
          productId,
          productName,
          variationCount: variations.length,
          createdVariants: 0,
          timestamp: new Date().toISOString(),
          criticalFailure: true,
          fallbackUsed: false
        });
        return productId; // Still return the product ID so collections can be assigned
      }
      
      console.log(`✅ Created fallback variant for product ${productId}`);
      // Track this product for reporting
      if (!global.productsWithFailedVariants) {
        global.productsWithFailedVariants = [];
      }
      global.productsWithFailedVariants.push({
        productId,
        productName,
        variationCount: variations.length,
        createdVariants: 1,
        timestamp: new Date().toISOString(),
        fallbackUsed: true
      });
    }
    
    // Clean up the default "Default Title" variant that Shopify automatically creates
    await removeDefaultTitleVariant(shop, accessToken, productId);
    
    return productId;
  } else if (json.data?.productCreate?.userErrors) {
    console.log(`User error creating product: ${json.data.productCreate.userErrors.map(e => e.message).join(", ")}`);
    return null;
  } else {
    console.log("Unknown error creating product:", JSON.stringify(json));
    return null;
  }
}

// Helper function to get all Shopify locations with their monitor_id metafields
async function getAllLocationsForInventory(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    locations(first: 50) {
      edges {
        node {
          id
          name
          isPrimary
          fulfillsOnlineOrders
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

  const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const json = await fetchRes.json();

  if (json.errors) {
    console.error("GraphQL errors getting locations:", JSON.stringify(json.errors, null, 2));
    return { allLocations: [], mappedLocations: [] };
  }

  const allLocations = json.data?.locations?.edges?.map(edge => edge.node) || [];
  
  // Separate locations with monitor_id mapping from those without
  const mappedLocations = [];
  const unmappedLocations = [];
  
  allLocations.forEach(location => {
    const monitorIdMetafield = location.metafields.edges.find(mf => mf.node.key === "monitor_id");
    if (monitorIdMetafield) {
      mappedLocations.push({
        ...location,
        monitorId: monitorIdMetafield.node.value
      });
    } else {
      unmappedLocations.push(location);
    }
  });

  console.log(`Found ${mappedLocations.length} locations with Monitor mapping and ${unmappedLocations.length} without`);
  
  if (mappedLocations.length > 0) {
    console.log("Locations with Monitor mapping:");
    mappedLocations.forEach(loc => {
      console.log(`  - ${loc.name} (Monitor ID: ${loc.monitorId})`);
    });
  }

  // If no mapped locations, fall back to primary location for basic inventory tracking
  if (mappedLocations.length === 0 && unmappedLocations.length > 0) {
    let fallbackLocation = unmappedLocations.find(loc => loc.isPrimary) ||
                          unmappedLocations.find(loc => loc.fulfillsOnlineOrders) ||
                          unmappedLocations[0];
    
    if (fallbackLocation) {
      console.log(`⚠️  No Monitor-mapped locations found. Using fallback location: ${fallbackLocation.name}`);
      return { allLocations, mappedLocations: [], fallbackLocation };
    }
  }

  return { allLocations, mappedLocations, fallbackLocation: null };
}

// Helper function to create product variants using productVariantsBulkCreate
async function createProductVariants(shop, accessToken, productId, variations) {
  const fetch = (await import('node-fetch')).default;
  
  console.log(`Creating variants for product ${productId} with ${variations.length} variations`);
  
  // First, get the product options to find the option IDs we need
  const productOptions = await getProductOptions(shop, accessToken, productId);
  console.log('Product options for variant creation:', JSON.stringify(productOptions, null, 2));
  
  // Find "Storlek" option, or use "Title" option if it exists (for existing products)
  let variantOption = productOptions.find(option => option.name === "Storlek");
  
  // If "Storlek" option doesn't exist, use the existing "Title" option (for legacy products)
  if (!variantOption) {
    variantOption = productOptions.find(option => option.name === "Title");
    if (variantOption) {
      console.log("Using existing 'Title' option for variants (legacy product)");
    } else {
      console.error("No suitable option found for variants");
      return false;
    }
  } else {
    console.log("Using 'Storlek' option for variants");
  }
  
  console.log(`Found/created option with ID: ${variantOption.id}, name: ${variantOption.name}`);
  
  // Get all locations for inventory tracking
  console.log("Getting locations for inventory tracking...");
  const { mappedLocations, fallbackLocation } = await getAllLocationsForInventory(shop, accessToken);
  
  // Determine which locations to use for initial inventory setup
  let inventoryLocations = [];
  if (mappedLocations.length > 0) {
    // Use mapped locations (these will be properly synced by inventory job)
    inventoryLocations = mappedLocations;
    console.log(`Will set up inventory tracking at ${mappedLocations.length} Monitor-mapped locations`);
  } else if (fallbackLocation) {
    // Use fallback location for basic inventory tracking
    inventoryLocations = [fallbackLocation];
    console.log(`Will set up inventory tracking at fallback location: ${fallbackLocation.name}`);
  } else {
    console.warn("⚠️  No locations available for inventory tracking. Variants will be created without inventory management.");
  }
  
  // Create variants array for bulk creation (without SKU - we'll update it after creation)
  // Add validation and sanitization for each variation
  const variants = [];
  
  for (const variation of variations) {
    try {
      // Validate essential data
      if (!variation || !variation.id) {
        console.warn(`Skipping variation with missing ID:`, variation);
        continue;
      }
      
      // Sanitize price - ensure it's a valid number
      let price = "0";
      if (variation.price != null && !isNaN(Number(variation.price)) && Number(variation.price) >= 0) {
        price = Number(variation.price).toFixed(2);
      }
      
      // Sanitize barcode - remove any invalid characters
      let barcode = "";
      if (variation.barcode && typeof variation.barcode === 'string') {
        barcode = variation.barcode.trim().replace(/[^\w-]/g, '');
      }
      
      // Sanitize option value name - ensure it's not empty or too long
      let optionValueName = "Default";
      if (variation.productVariation && typeof variation.productVariation === 'string') {
        optionValueName = variation.productVariation.trim();
        // Shopify has a limit on option value length
        if (optionValueName.length > 255) {
          optionValueName = optionValueName.substring(0, 255);
        }
      }
      
      // Get metafields with error handling
      let metafields = [];
      try {
        metafields = await generateMetafieldsForVariation(variation);
      } catch (metafieldError) {
        console.warn(`Failed to generate metafields for variation ${variation.id}: ${metafieldError.message}`);
        // Create at least the monitor_id metafield
        metafields = [{
          namespace: "custom",
          key: "monitor_id",
          value: variation.id.toString(),
          type: "single_line_text_field"
        }];
      }

      const variantData = {
        price: price,
        barcode: barcode,
        inventoryPolicy: "CONTINUE",
        taxable: true,
        optionValues: [
          {
            optionId: variantOption.id,
            name: optionValueName
          }
        ],
        metafields: metafields
      };

      // Add inventory quantities for all available locations
      if (inventoryLocations.length > 0) {
        variantData.inventoryQuantities = inventoryLocations.map(location => ({
          availableQuantity: 0, // Set initial quantity to 0, will be updated by inventory sync
          locationId: location.id
        }));
      }

      variants.push(variantData);
      
    } catch (variationError) {
      console.error(`Error processing variation ${variation?.id}: ${variationError.message}`);
      console.warn(`Skipping problematic variation:`, variation);
      continue;
    }
  }
  
  // Ensure we have at least one variant to create
  if (variants.length === 0) {
    console.error(`No valid variants could be created from ${variations.length} variations`);
    return false;
  }
  
  console.log(`Successfully prepared ${variants.length} out of ${variations.length} variants for creation`);

  console.log(`Prepared ${variants.length} variants:`, JSON.stringify(variants, null, 2));

  const mutation = `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        sku
        title
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    productId: productId,
    variants: variants
  };

  const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const json = await fetchRes.json();

  console.log('GraphQL response for variant creation:', JSON.stringify(json, null, 2));

  if (json.errors) {
    console.error("Shopify GraphQL errors creating variants:", JSON.stringify(json.errors, null, 2));
    return false;
  }

  if (json.data?.productVariantsBulkCreate?.productVariants) {
    console.log(`✅ Created ${json.data.productVariantsBulkCreate.productVariants.length} variants for product ${productId}`);
    const createdVariants = json.data.productVariantsBulkCreate.productVariants;
    
    // Update each variant with its SKU, weight, and inventory management
    for (let i = 0; i < createdVariants.length && i < variations.length; i++) {
      const variant = createdVariants[i];
      const variation = variations[i];
      
      // Update SKU
      if (variation.sku) {
        await updateVariantSku(shop, accessToken, variant.id, variation.sku);
      }
      
      // Update inventory management and weight (pass first available location for weight update)
      const locationForUpdate = inventoryLocations.length > 0 ? inventoryLocations[0] : null;
      await updateVariantInventoryAndWeight(shop, accessToken, variant.id, variation, locationForUpdate);
    }
    
    createdVariants.forEach((variant, index) => {
      console.log(`  Variant ${index + 1}: ${variant.title} (ID: ${variant.id})`);
    });
    return true;
  } else if (json.data?.productVariantsBulkCreate?.userErrors) {
    console.log(`❌ User error creating variants: ${json.data.productVariantsBulkCreate.userErrors.map(e => e.message).join(", ")}`);
    console.log('Full user errors:', JSON.stringify(json.data.productVariantsBulkCreate.userErrors, null, 2));
    return false;
  } else {
    console.log("Unknown error creating variants:", JSON.stringify(json));
    return false;
  }
}

// Helper function to create a fallback variant when bulk creation fails
async function createFallbackVariant(shop, accessToken, productId, variation) {
  const fetch = (await import('node-fetch')).default;
  
  try {
    console.log(`Creating fallback variant for product ${productId}...`);
    
    // Validate variation data first
    if (!variation || !variation.id) {
      console.error("Invalid variation data for fallback variant");
      return false;
    }
    
    // Get the product options first
    const productOptions = await getProductOptions(shop, accessToken, productId);
    let variantOption = productOptions.find(option => option.name === "Storlek") || 
                       productOptions.find(option => option.name === "Title");
    
    if (!variantOption) {
      console.error("No suitable option found for fallback variant");
      return false;
    }
    
    // Get metafields for the variation with fallback to minimal data
    let metafields = [];
    try {
      metafields = await generateMetafieldsForVariation(variation);
    } catch (metafieldError) {
      console.warn(`Failed to generate full metafields for fallback variant: ${metafieldError.message}`);
      // Ensure we at least have the monitor_id metafield
      metafields = [{
        namespace: "custom",
        key: "monitor_id",
        value: variation.id.toString(),
        type: "single_line_text_field"
      }];
    }
    
    // Get locations for inventory
    const { mappedLocations, fallbackLocation } = await getAllLocationsForInventory(shop, accessToken);
    let inventoryLocations = [];
    if (mappedLocations.length > 0) {
      inventoryLocations = mappedLocations;
    } else if (fallbackLocation) {
      inventoryLocations = [fallbackLocation];
    }
    
    // Sanitize data similar to main variant creation
    let price = "0";
    if (variation.price != null && !isNaN(Number(variation.price)) && Number(variation.price) >= 0) {
      price = Number(variation.price).toFixed(2);
    }
    
    let barcode = "";
    if (variation.barcode && typeof variation.barcode === 'string') {
      barcode = variation.barcode.trim().replace(/[^\w-]/g, '');
    }
    
    let optionValueName = "Default";
    if (variation.productVariation && typeof variation.productVariation === 'string') {
      optionValueName = variation.productVariation.trim();
      if (optionValueName.length > 255) {
        optionValueName = optionValueName.substring(0, 255);
      }
    }
    
    // Create single variant using productVariantsBulkCreate
    const variantData = {
      price: price,
      barcode: barcode,
      inventoryPolicy: "CONTINUE",
      taxable: true,
      optionValues: [
        {
          optionId: variantOption.id,
          name: optionValueName
        }
      ],
      metafields: metafields
    };

    // Add inventory quantities if locations available
    if (inventoryLocations.length > 0) {
      variantData.inventoryQuantities = inventoryLocations.map(location => ({
        availableQuantity: 0,
        locationId: location.id
      }));
    }

    const mutation = `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          title
        }
        userErrors {
          field
          message
        }
      }
    }`;

    const variables = {
      productId: productId,
      variants: [variantData]
    };

    const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const json = await fetchRes.json();

    if (json.errors) {
      console.error("GraphQL errors creating fallback variant:", JSON.stringify(json.errors, null, 2));
      return false;
    }

    if (json.data?.productVariantsBulkCreate?.productVariants?.length > 0) {
      const createdVariant = json.data.productVariantsBulkCreate.productVariants[0];
      console.log(`✅ Created fallback variant: ${createdVariant.title} (ID: ${createdVariant.id})`);
      
      // Update SKU and inventory management
      if (variation.sku) {
        await updateVariantSku(shop, accessToken, createdVariant.id, variation.sku);
      }
      
      const locationForUpdate = inventoryLocations.length > 0 ? inventoryLocations[0] : null;
      await updateVariantInventoryAndWeight(shop, accessToken, createdVariant.id, variation, locationForUpdate);
      
      return true;
    } else if (json.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
      console.error("User errors creating fallback variant:", json.data.productVariantsBulkCreate.userErrors);
      return false;
    }
    
    return false;
  } catch (error) {
    console.error(`Error creating fallback variant: ${error.message}`);
    return false;
  }
}



// Helper function to remove the default "Default Title" variant that Shopify creates automatically
async function removeDefaultTitleVariant(shop, accessToken, productId) {
  const fetch = (await import('node-fetch')).default;
  
  try {
    // Get all variants for the product
    const variants = await getExistingVariants(shop, accessToken, productId);
    
    // Find the variant with "Default Title" or similar default names
    const defaultVariant = variants.find(variant => {
      // Check if this variant doesn't have a monitor_id (meaning it's the default one we didn't create)
      return !variant.monitorId;
    });
    
    if (!defaultVariant) {
      console.log(`    No default variant found to remove for product ${productId}`);
      return true;
    }
    
    // Extract the numeric ID from the GraphQL ID
    const numericVariantId = defaultVariant.id.split('/').pop();
    
    // Delete the default variant using REST API
    const deleteResponse = await fetch(`https://${shop}/admin/api/2025-01/variants/${numericVariantId}.json`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error(`Failed to delete default variant ${defaultVariant.id}: ${deleteResponse.status} ${errorText}`);
      return false;
    }

    console.log(`    ✅ Removed default variant for product ${productId}`);
    return true;
    
  } catch (error) {
    console.error(`Error removing default variant: ${error.message}`);
    return false;
  }
}

// Helper function to rename the default "Title" option to "Storlek" using REST API
async function renameProductOptionToStorlek(shop, accessToken, productId) {
  const fetch = (await import('node-fetch')).default;
  
  // Extract the numeric ID from the GraphQL ID
  const numericProductId = productId.split('/').pop();
  
  try {
    // First, get the product to find the option ID
    const getResponse = await fetch(`https://${shop}/admin/api/2025-01/products/${numericProductId}.json`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    });

    if (!getResponse.ok) {
      console.error(`Failed to get product for option rename: ${getResponse.status}`);
      return false;
    }

    const productData = await getResponse.json();
    const product = productData.product;
    
    if (!product.options || product.options.length === 0) {
      console.error("No options found on product");
      return false;
    }

    // Find the "Title" option
    const titleOption = product.options.find(opt => opt.name === "Title");
    if (!titleOption) {
      console.log("No 'Title' option found to rename");
      return false;
    }

    // Update the option name to "Storlek"
    const updateData = {
      product: {
        id: parseInt(numericProductId),
        options: product.options.map(opt => ({
          id: opt.id,
          name: opt.name === "Title" ? "Storlek" : opt.name,
          position: opt.position
        }))
      }
    };

    const updateResponse = await fetch(`https://${shop}/admin/api/2025-01/products/${numericProductId}.json`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(updateData),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`Failed to rename option: ${updateResponse.status} ${errorText}`);
      return false;
    }

    console.log(`    ✅ Renamed 'Title' option to 'Storlek' for product ${productId}`);
    return true;
    
  } catch (error) {
    console.error(`Error renaming option to 'Storlek': ${error.message}`);
    return false;
  }
}

// Helper function to add variations to an existing product
async function addVariationsToExistingProduct(shop, accessToken, productId, variations) {
  const fetch = (await import('node-fetch')).default;
  
  // First, get existing variants to check for duplicates
  const existingVariants = await getExistingVariants(shop, accessToken, productId);
  const existingMonitorIds = new Set(existingVariants.map(v => v.monitorId).filter(Boolean));
  
  // Filter out variations that already exist
  const newVariations = variations.filter(variation => !existingMonitorIds.has(variation.id.toString()));
  
  if (newVariations.length === 0) {
    console.log(`All variations already exist for product ${productId}`);
    return true;
  }

  // Get the product options to find the option IDs we need
  const productOptions = await getProductOptions(shop, accessToken, productId);
  
  // Find "Storlek" option, or use "Title" option if it exists (for existing products)
  let variantOption = productOptions.find(option => option.name === "Storlek");
  
  if (!variantOption) {
    variantOption = productOptions.find(option => option.name === "Title");
    if (variantOption) {
      console.log("Using existing 'Title' option for variants (legacy product)");
    } else {
      console.error("No suitable option found for variants");
      return false;
    }
  } else {
    console.log("Using 'Storlek' option for variants");
  }

  // Get all locations for inventory tracking
  console.log("Getting locations for inventory tracking...");
  const { mappedLocations, fallbackLocation } = await getAllLocationsForInventory(shop, accessToken);
  
  // Determine which locations to use for initial inventory setup
  let inventoryLocations = [];
  if (mappedLocations.length > 0) {
    inventoryLocations = mappedLocations;
  } else if (fallbackLocation) {
    inventoryLocations = [fallbackLocation];
  }

  // Create variants array for bulk creation with validation (same as createProductVariants)
  const variants = [];
  
  for (const variation of newVariations) {
    try {
      // Validate essential data
      if (!variation || !variation.id) {
        console.warn(`Skipping variation with missing ID:`, variation);
        continue;
      }
      
      // Sanitize price - ensure it's a valid number
      let price = "0";
      if (variation.price != null && !isNaN(Number(variation.price)) && Number(variation.price) >= 0) {
        price = Number(variation.price).toFixed(2);
      }
      
      // Sanitize barcode - remove any invalid characters
      let barcode = "";
      if (variation.barcode && typeof variation.barcode === 'string') {
        barcode = variation.barcode.trim().replace(/[^\w-]/g, '');
      }
      
      // Sanitize option value name - ensure it's not empty or too long
      let optionValueName = "Default";
      if (variation.productVariation && typeof variation.productVariation === 'string') {
        optionValueName = variation.productVariation.trim();
        // Shopify has a limit on option value length
        if (optionValueName.length > 255) {
          optionValueName = optionValueName.substring(0, 255);
        }
      }
      
      // Get metafields with error handling
      let metafields = [];
      try {
        metafields = await generateMetafieldsForVariation(variation);
      } catch (metafieldError) {
        console.warn(`Failed to generate metafields for variation ${variation.id}: ${metafieldError.message}`);
        // Create at least the monitor_id metafield
        metafields = [{
          namespace: "custom",
          key: "monitor_id",
          value: variation.id.toString(),
          type: "single_line_text_field"
        }];
      }

      const variantData = {
        price: price,
        barcode: barcode,
        inventoryPolicy: "CONTINUE",
        taxable: true,
        optionValues: [
          {
            optionId: variantOption.id,
            name: optionValueName
          }
        ],
        metafields: metafields
      };

      // Add inventory quantities for all available locations
      if (inventoryLocations.length > 0) {
        variantData.inventoryQuantities = inventoryLocations.map(location => ({
          availableQuantity: 0, // Set initial quantity to 0, will be updated by inventory sync
          locationId: location.id
        }));
      }

      variants.push(variantData);
      
    } catch (variationError) {
      console.error(`Error processing variation ${variation?.id}: ${variationError.message}`);
      console.warn(`Skipping problematic variation:`, variation);
      continue;
    }
  }
  
  // Ensure we have at least one variant to create
  if (variants.length === 0) {
    console.warn(`No valid variants could be created from ${newVariations.length} new variations for existing product ${productId}`);
    return true; // Return true since this isn't a critical failure for existing products
  }
  
  console.log(`Successfully prepared ${variants.length} out of ${newVariations.length} new variants for existing product`);

  const mutation = `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        sku
        title
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    productId: productId,
    variants: variants
  };

  const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const json = await fetchRes.json();

  if (json.errors) {
    console.error("Shopify GraphQL errors adding variants:", JSON.stringify(json.errors, null, 2));
    return false;
  } else if (json.data?.productVariantsBulkCreate?.productVariants) {
    console.log(`Added ${json.data.productVariantsBulkCreate.productVariants.length} new variants to product ${productId}`);
    const createdVariants = json.data.productVariantsBulkCreate.productVariants;
    
    // Update each variant with its SKU, weight, and inventory management
    for (let i = 0; i < createdVariants.length && i < newVariations.length; i++) {
      const variant = createdVariants[i];
      const variation = newVariations[i];
      
      // Update SKU
      if (variation.sku) {
        await updateVariantSku(shop, accessToken, variant.id, variation.sku);
      }
      
      // Update inventory management and weight (pass first available location for weight update)
      const locationForUpdate = inventoryLocations.length > 0 ? inventoryLocations[0] : null;
      await updateVariantInventoryAndWeight(shop, accessToken, variant.id, variation, locationForUpdate);
    }
    return true;
  } else if (json.data?.productVariantsBulkCreate?.userErrors) {
    console.log(`User error adding variants: ${json.data.productVariantsBulkCreate.userErrors.map(e => e.message).join(", ")}`);
    return false;
  } else {
    console.log("Unknown error adding variants:", JSON.stringify(json));
    return false;
  }
}



// Helper function to get product options
async function getProductOptions(shop, accessToken, productId) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    product(id: "${productId}") {
      options {
        id
        name
        position
      }
    }
  }`;

  const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const json = await fetchRes.json();

  if (json.errors) {
    console.error("GraphQL errors getting product options:", JSON.stringify(json.errors, null, 2));
    return [];
  }

  return json.data?.product?.options || [];
}

// Helper function to get existing variants with their monitor_ids
async function getExistingVariants(shop, accessToken, productId) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    product(id: "${productId}") {
      variants(first: 100) {
        edges {
          node {
            id
            sku
            metafields(first: 5, namespace: "custom") {
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
  }`;

  const fetchRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const json = await fetchRes.json();

  if (json.errors) {
    console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
    return [];
  }

  if (!json.data?.product?.variants?.edges) {
    return [];
  }

  return json.data.product.variants.edges.map(edge => {
    const monitorIdMetafield = edge.node.metafields.edges.find(mf => mf.node.key === "monitor_id");
    return {
      id: edge.node.id,
      sku: edge.node.sku,
      monitorId: monitorIdMetafield?.node.value
    };
  });
}

// Helper function to update variant SKU after creation using REST API
async function updateVariantSku(shop, accessToken, variantId, sku) {
  const fetch = (await import('node-fetch')).default;
  
  // Extract the numeric ID from the GraphQL ID
  const numericId = variantId.split('/').pop();
  
  const url = `https://${shop}/admin/api/2025-01/variants/${numericId}.json`;
  
  const body = {
    variant: {
      id: parseInt(numericId),
      sku: sku
    }
  };

  const fetchRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify(body),
  });

  if (!fetchRes.ok) {
    const errorText = await fetchRes.text();
    console.error(`REST API error updating variant SKU for ${variantId}: ${fetchRes.status} ${errorText}`);
    return false;
  }

  const json = await fetchRes.json();

  if (json.errors) {
    console.error(`REST API errors updating variant SKU for ${variantId}:`, JSON.stringify(json.errors, null, 2));
    return false;
  }

  console.log(`    Updated SKU for variant ${variantId} to "${sku}"`);
  return true;
}

// Helper function to update variant inventory management and weight using REST API
async function updateVariantInventoryAndWeight(shop, accessToken, variantId, variation, primaryLocation) {
  const fetch = (await import('node-fetch')).default;
  
  // Extract the numeric ID from the GraphQL ID
  const numericId = variantId.split('/').pop();
  
  const url = `https://${shop}/admin/api/2025-01/variants/${numericId}.json`;
  
  const updateData = {
    variant: {
      id: parseInt(numericId),
      inventory_management: "shopify", // Enable inventory tracking
    }
  };

  // Add weight if available
  if (variation.weight != null && !isNaN(Number(variation.weight))) {
    updateData.variant.weight = Math.round(Number(variation.weight) * 100) / 100;
    updateData.variant.weight_unit = "kg";
  }

  const fetchRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify(updateData),
  });

  if (!fetchRes.ok) {
    const errorText = await fetchRes.text();
    console.error(`REST API error updating variant inventory/weight for ${variantId}: ${fetchRes.status} ${errorText}`);
    return false;
  }

  const json = await fetchRes.json();

  if (json.errors) {
    console.error(`REST API errors updating variant inventory/weight for ${variantId}:`, JSON.stringify(json.errors, null, 2));
    return false;
  }

  console.log(`    Updated inventory management and weight for variant ${variantId}`);
  
  // Note: Inventory tracking is enabled via inventory_management: "shopify"
  // The inventory will be automatically available for tracking at locations
  // Use the inventory sync job to set actual quantities
  
  return true;
}

// Helper function to get the Online Store sales channel ID
async function getOnlineStoreSalesChannelId(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    publications(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }`;

  try {
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
      console.error("GraphQL errors getting sales channels:", JSON.stringify(result.errors, null, 2));
      return null;
    }

    // Look for "Online Store" publication
    const publications = result.data?.publications?.edges || [];
    const onlineStore = publications.find(pub => 
      pub.node.name === "Online Store" || pub.node.name === "Online store"
    );

    if (onlineStore) {
      console.log(`Found Online Store sales channel with ID: ${onlineStore.node.id}`);
      return onlineStore.node.id;
    } else {
      console.log("Available sales channels:", publications.map(p => p.node.name));
      console.error("Could not find Online Store sales channel");
      return null;
    }
  } catch (error) {
    console.error("Error getting sales channels:", error);
    return null;
  }
}

// Helper function to publish product to Online Store
async function publishProductToOnlineStore(shop, accessToken, productId, salesChannelId) {
  const fetch = (await import('node-fetch')).default;
  
  const mutation = `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        publicationCount
      }
      shop {
        publicationCount
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    id: productId,
    input: [
      {
        publicationId: salesChannelId
      }
    ]
  };

  try {
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
      // Check if it's an access denied error for publications
      const accessDeniedError = result.errors.find(err => 
        err.extensions?.code === "ACCESS_DENIED" && 
        (err.message.includes("write_publications") || err.message.includes("publishablePublish"))
      );
      
      if (accessDeniedError) {
        console.log(`  ⚠️  Cannot publish product ${productId} - Advanced store token missing write_publications scope`);
        return false;
      }
      
      console.error("GraphQL errors publishing product:", JSON.stringify(result.errors, null, 2));
      return false;
    }

    if (result.data?.publishablePublish?.userErrors?.length > 0) {
      console.error("User errors publishing product:", result.data.publishablePublish.userErrors);
      return false;
    }

    console.log(`  ✅ Published product ${productId} to Online Store`);
    return true;
  } catch (error) {
    console.error("Error publishing product:", error);
    return false;
  }
}

// Helper function to find existing collection with monitor_id metafield
async function findExistingCollection(shop, accessToken, monitorId, collectionTitle) {
  // Try to find existing collection with the monitor_id metafield
  const existingCollection = await findExistingCollectionByMonitorId(shop, accessToken, monitorId);
  if (existingCollection) {
    console.log(`    ✅ Found existing collection: "${existingCollection.title}" (ID: ${existingCollection.id})`);
    return existingCollection.id;
  }

  console.log(`    ⚠️  No existing collection found for "${collectionTitle}" (Monitor ID: ${monitorId})`);
  return null;
}

// Helper function to find existing collection by monitor_id metafield
async function findExistingCollectionByMonitorId(shop, accessToken, monitorId) {
  let endCursor = null;
  let hasNextPage = true;
  
  while (hasNextPage) {
    const query = `query {
      collections(first: 50${endCursor ? `, after: "${endCursor}"` : ""}) {
        edges {
          cursor
          node {
            id
            title
            metafields(first: 5, namespace: "custom") {
              edges {
                node {
                  key
                  value
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
    
    try {
      const result = await makeGraphQLRequest(shop, accessToken, query, `searching for collection with Monitor ID ${monitorId}`);
      
      if (result.errors) {
        console.error("GraphQL errors searching for collections:", JSON.stringify(result.errors, null, 2));
        break;
      }
      
      if (result.data?.collections?.edges) {
        for (const edge of result.data.collections.edges) {
          const collection = edge.node;
          const monitorIdMetafield = collection.metafields.edges.find(
            mf => mf.node.key === "monitor_id" && mf.node.value === monitorId
          );
          
          if (monitorIdMetafield) {
            return {
              id: collection.id,
              title: collection.title
            };
          }
        }
      }
      
      hasNextPage = result.data?.collections?.pageInfo?.hasNextPage || false;
      endCursor = result.data?.collections?.pageInfo?.endCursor;
    } catch (error) {
      console.error(`⚠️  Error searching for collection with Monitor ID ${monitorId}: ${error.message}`);
      console.log(`⏭️  Skipping collection search and continuing...`);
      break;
    }
  }
  
  return null;
}

// Helper function to add a product to a collection
async function addProductToCollection(shop, accessToken, productId, collectionId) {
  const fetch = (await import('node-fetch')).default;
  
  // First check if product is already in the collection
  const isAlreadyInCollection = await checkProductInCollection(shop, accessToken, productId, collectionId);
  if (isAlreadyInCollection) {
    console.log(`    ✅ Product ${productId} already in collection ${collectionId}`);
    return true;
  }
  
  const mutation = `mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }`;
  
  const variables = {
    id: collectionId,
    productIds: [productId]
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
    console.error("GraphQL errors adding product to collection:", JSON.stringify(result.errors, null, 2));
    return false;
  }
  
  if (result.data?.collectionAddProducts?.collection) {
    console.log(`    ✅ Added product ${productId} to collection "${result.data.collectionAddProducts.collection.title}"`);
    return true;
  } else if (result.data?.collectionAddProducts?.userErrors?.length > 0) {
    console.error("User errors adding product to collection:", JSON.stringify(result.data.collectionAddProducts.userErrors, null, 2));
    return false;
  } else {
    console.error("Unexpected response adding product to collection:", JSON.stringify(result, null, 2));
    return false;
  }
}

// Helper function to check if a product is already in a collection
async function checkProductInCollection(shop, accessToken, productId, collectionId) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    collection(id: "${collectionId}") {
      products(first: 250) {
        edges {
          node {
            id
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
    console.error("GraphQL errors checking product in collection:", JSON.stringify(result.errors, null, 2));
    return false;
  }
  
  // Check if the specific product ID is in the collection
  const products = result.data?.collection?.products?.edges || [];
  return products.some(edge => edge.node.id === productId);
}

// Only run when executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  // Display usage instructions
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📋 Product Sync Job Usage:

To sync ALL products to development store (OAuth):
  node app/syncProductsJob.js

To sync ALL products to Advanced store:
  node app/syncProductsJob.js --advanced --manual
  node app/syncProductsJob.js -a -m

To sync a SINGLE product by PartNumber (requires --advanced --manual):
  node app/syncProductsJob.js --advanced --manual --single <PartNumber>

Examples:
  node app/syncProductsJob.js --advanced --manual --single "ABC123"

For scheduled syncs, use the worker:
  node app/worker.js

Configuration:
  Development store: Uses Prisma session from OAuth flow
  Advanced store: Uses ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN from .env

Make sure your .env file is configured properly before running.
  `);
  process.exit(0);
}

console.log(`
🚀 Starting Product Sync Job
📝 Use --help for usage instructions
💡 For scheduled syncs, use: node app/worker.js
`);

// Only allow manual execution when run directly
if (!isManualRun && useAdvancedStore) {
  console.log("⚠️  For automated scheduling, please use: node app/worker.js");
  console.log("⚠️  Direct execution without --manual flag is not recommended for advanced store");
  console.log("� Running incremental sync anyway...");
}

// Run the sync
if (isSingleProductSync) {
  console.log(`🔍 Running single product sync for: ${singlePartNumber}`);
  console.log(`🎯 Target: Advanced store (manual mode)`);
  syncProducts(false, singlePartNumber); // Single product sync, never incremental
} else {
  // Determine sync type based on flags
  const isFullSync = isManualRun || !useAdvancedStore; // Manual mode or dev store = full sync
  const syncType = isFullSync ? "full sync" : "incremental sync";
  console.log(`🚀 Running ${syncType}...`);
  
  syncProducts(!isFullSync); // !isFullSync = incremental sync for advanced store without manual flag
}
}
