import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import { fetchProductsFromMonitor, fetchARTFSCFromMonitor, fetchEntityChangeLogsFromMonitor, fetchProductsByIdsFromMonitor } from "./utils/monitor.js";
import { pollForNewOrders } from "./orderPollJob.js";
import { syncInventory } from "./syncInventoryJob.js";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
dotenv.config();

// Get command line arguments to determine which store to sync to
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a');

// Store this globally for cron access
global.useAdvancedStore = useAdvancedStore;

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

  if (variation.VolumePerUnit != null) {
    metafields.push({
      namespace: "custom",
      key: "volume",
      value: Number(variation.VolumePerUnit).toFixed(2),
      type: "single_line_text_field"
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

async function syncProducts(isIncrementalSync = false) {
  let shop, accessToken;
  
  // Use global variable if set (from cron), otherwise use the original variable
  const currentUseAdvancedStore = global.useAdvancedStore !== undefined ? global.useAdvancedStore : useAdvancedStore;

  if (currentUseAdvancedStore) {
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
      console.log("No Shopify session found. Cannot sync products.");
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

  console.log("✅ Store session is valid. Starting product sync...");
  
  if (isIncrementalSync) {
    console.log("🔄 Running incremental sync (changes only)...");
  } else {
    console.log("🔄 Running full sync (all products)...");
  }
  
  // Use the low-level GraphQL client from @shopify/shopify-api
  try {
    /*console.log("About to instantiate GraphqlClient");
    const admin = new shopifyConfig.clients.Graphql({
      session: {
        shop: shop,
        accessToken: accessToken,
      },
      apiVersion: "2024-01", // or your current ApiVersion
    });
    console.log("GraphqlClient instantiated successfully");*/
    let products;
    try {
      if (isIncrementalSync) {
        // Fetch only changed products
        console.log("Fetching entity change logs from Monitor...");
        const changedProductIds = await fetchEntityChangeLogsFromMonitor();
        
        if (changedProductIds.length === 0) {
          console.log("✅ No product changes found in the last 48 hours. Sync complete.");
          return;
        }
        
        console.log(`Found ${changedProductIds.length} products with changes. Fetching product details...`);
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
    
    // Group products by productName (ARTWEBKAT)
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
        const productGroupCollectionId = await findExistingCollection(shop, accessToken, productGroupId, productGroupDescription);
        if (productGroupCollectionId) {
          collectionIds.push(productGroupCollectionId);
        }
      }
      
      if (partCodeId && partCodeDescription) {
        console.log(`  🏷️  Finding collection for PartCode: "${partCodeDescription}" (ID: ${partCodeId})`);
        const partCodeCollectionId = await findExistingCollection(shop, accessToken, partCodeId, partCodeDescription);
        if (partCodeCollectionId) {
          collectionIds.push(partCodeCollectionId);
        }
      }
      
      // Check if product already exists in Shopify by productName
      const existingProduct = await findExistingProductByName(shop, accessToken, productName);
      
      if (existingProduct) {
        console.log(`Product "${productName}" already exists, adding new variations if needed`);
        await addVariationsToExistingProduct(shop, accessToken, existingProduct.id, variations);
        
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
    }
    
    console.log(`✅ Product sync completed! Processed ${productGroups.size} product groups.`);
  } catch (err) {
    console.error("Failed to instantiate GraphqlClient:", err);
    throw err;
  }
}

// Helper function to find existing product by productName
async function findExistingProductByName(shop, accessToken, productName) {
  const fetch = (await import('node-fetch')).default;
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
    
    const checkRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: checkQuery }),
    });
    
    const checkJson = await checkRes.json();
    
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
    
    // Now create variants using productVariantsBulkCreate (this will automatically create the option)
    await createProductVariants(shop, accessToken, productId, variations);
    
    return productId;
  } else if (json.data?.productCreate?.userErrors) {
    console.log(`User error creating product: ${json.data.productCreate.userErrors.map(e => e.message).join(", ")}`);
    return null;
  } else {
    console.log("Unknown error creating product:", JSON.stringify(json));
    return null;
  }
}

// Helper function to get the primary location for inventory tracking
async function getPrimaryLocation(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
  const query = `query {
    locations(first: 10) {
      edges {
        node {
          id
          name
          isPrimary
          fulfillsOnlineOrders
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
    return null;
  }

  const locations = json.data?.locations?.edges?.map(edge => edge.node) || [];
  
  // Find the primary location first
  let primaryLocation = locations.find(location => location.isPrimary);
  
  // If no primary location, find one that fulfills online orders
  if (!primaryLocation) {
    primaryLocation = locations.find(location => location.fulfillsOnlineOrders);
  }
  
  // If still nothing, use the first location
  if (!primaryLocation && locations.length > 0) {
    primaryLocation = locations[0];
  }

  if (primaryLocation) {
    console.log(`Using location: ${primaryLocation.name} (ID: ${primaryLocation.id})`);
    return primaryLocation;
  } else {
    console.error("No suitable location found for inventory tracking");
    return null;
  }
}

// Helper function to create product variants using productVariantsBulkCreate
async function createProductVariants(shop, accessToken, productId, variations) {
  const fetch = (await import('node-fetch')).default;
  
  console.log(`Creating variants for product ${productId} with ${variations.length} variations`);
  
  // First, get the product options to find the option IDs we need
  const productOptions = await getProductOptions(shop, accessToken, productId);
  console.log('Product options for variant creation:', JSON.stringify(productOptions, null, 2));
  
  // Find a suitable option for the variants (prefer "Variation" or "Title")
  let variantOption = productOptions.find(option => option.name === "Variation") || 
                     productOptions.find(option => option.name === "Title");
  
  // If no suitable option exists, we need to create one
  if (!variantOption) {
    console.log("No suitable option found, creating 'Variation' option...");
    variantOption = await createProductOption(shop, accessToken, productId, "Variation");
    if (!variantOption) {
      console.error("Failed to create product option");
      return;
    }
  }
  
  console.log(`Found/created option with ID: ${variantOption.id}, name: ${variantOption.name}`);
  
  // Get the primary location for inventory tracking
  console.log("Getting primary location for inventory tracking...");
  const primaryLocation = await getPrimaryLocation(shop, accessToken);
  
  // Create variants array for bulk creation (without SKU - we'll update it after creation)
  const variants = await Promise.all(variations.map(async (variation) => {
    const metafields = await generateMetafieldsForVariation(variation);

    const variantData = {
      price: variation.price != null ? variation.price.toString() : "0",
      barcode: variation.barcode || "",
      inventoryPolicy: "CONTINUE",
      taxable: true,
      optionValues: [
        {
          optionId: variantOption.id,
          name: variation.productVariation || "Default"
        }
      ],
      metafields: metafields
    };

    // Add inventory quantities if we have a primary location
    if (primaryLocation) {
      variantData.inventoryQuantities = [
        {
          availableQuantity: 0, // Set initial quantity to 0, will be updated by inventory sync
          locationId: primaryLocation.id
        }
      ];
    }

    return variantData;
  }));

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
    return;
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
      
      // Update inventory management and weight
      await updateVariantInventoryAndWeight(shop, accessToken, variant.id, variation, primaryLocation);
    }
    
    createdVariants.forEach((variant, index) => {
      console.log(`  Variant ${index + 1}: ${variant.title} (ID: ${variant.id})`);
    });
  } else if (json.data?.productVariantsBulkCreate?.userErrors) {
    console.log(`❌ User error creating variants: ${json.data.productVariantsBulkCreate.userErrors.map(e => e.message).join(", ")}`);
    console.log('Full user errors:', JSON.stringify(json.data.productVariantsBulkCreate.userErrors, null, 2));
  } else {
    console.log("Unknown error creating variants:", JSON.stringify(json));
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
    return;
  }

  // Get the product options to find the option IDs we need
  const productOptions = await getProductOptions(shop, accessToken, productId);
  
  // Find a suitable option for the variants (prefer "Variation" or "Title")
  let variantOption = productOptions.find(option => option.name === "Variation") || 
                     productOptions.find(option => option.name === "Title");
  
  if (!variantOption) {
    console.log("No suitable option found, creating 'Variation' option...");
    variantOption = await createProductOption(shop, accessToken, productId, "Variation");
    if (!variantOption) {
      console.error("Failed to create product option");
      return;
    }
  }

  // Get the primary location for inventory tracking
  console.log("Getting primary location for inventory tracking...");
  const primaryLocation = await getPrimaryLocation(shop, accessToken);

  // Create variants array for bulk creation (without SKU - we'll update it after creation)
  const variants = await Promise.all(newVariations.map(async (variation) => {
    const metafields = await generateMetafieldsForVariation(variation);

    const variantData = {
      price: variation.price != null ? variation.price.toString() : "0",
      barcode: variation.barcode || "",
      inventoryPolicy: "CONTINUE",
      taxable: true,
      optionValues: [
        {
          optionId: variantOption.id,
          name: variation.productVariation || "Default"
        }
      ],
      metafields: metafields
    };

    // Add inventory quantities if we have a primary location
    if (primaryLocation) {
      variantData.inventoryQuantities = [
        {
          availableQuantity: 0, // Set initial quantity to 0, will be updated by inventory sync
          locationId: primaryLocation.id
        }
      ];
    }

    return variantData;
  }));

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
      
      // Update inventory management and weight
      await updateVariantInventoryAndWeight(shop, accessToken, variant.id, variation, primaryLocation);
    }
  } else if (json.data?.productVariantsBulkCreate?.userErrors) {
    console.log(`User error adding variants: ${json.data.productVariantsBulkCreate.userErrors.map(e => e.message).join(", ")}`);
  }
}

// Helper function to create a product option
async function createProductOption(shop, accessToken, productId, optionName) {
  const fetch = (await import('node-fetch')).default;
  
  const mutation = `mutation productOptionCreate($productId: ID!, $option: OptionCreateInput!) {
    productOptionCreate(productId: $productId, option: $option) {
      productOption {
        id
        name
        position
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    productId: productId,
    option: {
      name: optionName,
      values: [
        {
          name: "Default"
        }
      ]
    }
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
    console.error("GraphQL errors creating product option:", JSON.stringify(json.errors, null, 2));
    return null;
  }

  if (json.data?.productOptionCreate?.productOption) {
    const option = json.data.productOptionCreate.productOption;
    console.log(`Created product option: ${option.name} with ID: ${option.id}`);
    return option;
  } else if (json.data?.productOptionCreate?.userErrors) {
    console.log(`User error creating product option: ${json.data.productOptionCreate.userErrors.map(e => e.message).join(", ")}`);
    return null;
  } else {
    console.log("Unknown error creating product option:", JSON.stringify(json));
    return null;
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

// Helper function to ensure inventory tracking at location
async function ensureInventoryTracking(shop, accessToken, inventoryItemId, locationId) {
  const fetch = (await import('node-fetch')).default;
  
  // First, activate inventory at the location using GraphQL
  const mutation = `mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
      inventoryLevel {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    inventoryItemId: `gid://shopify/InventoryItem/${inventoryItemId}`,
    locationId: locationId,
    available: 0
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
    console.error("GraphQL errors activating inventory:", JSON.stringify(json.errors, null, 2));
    return false;
  }

  if (json.data?.inventoryActivate?.userErrors?.length > 0) {
    // Inventory might already be active, which is fine
    const errors = json.data.inventoryActivate.userErrors;
    const alreadyActiveError = errors.find(err => 
      err.message.includes('already active') || 
      err.message.includes('already stocked') ||
      err.message.includes('already tracked')
    );
    
    if (!alreadyActiveError) {
      console.error("User errors activating inventory:", errors);
      return false;
    } else {
      console.log(`    Inventory already active for item ${inventoryItemId} at location`);
      return true;
    }
  }

  console.log(`    Activated inventory tracking for item ${inventoryItemId} at location`);
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
  const fetch = (await import('node-fetch')).default;
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
      products(first: 250, query: "id:${productId}") {
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
  
  return result.data?.collection?.products?.edges?.length > 0;
}

// Schedule to run every hour - only for advanced store with incremental sync
cron.schedule("0 * * * *", () => {
  console.log("[CRON] Running scheduled incremental product sync...");
  
  // Check if advanced store is configured
  const advancedStoreDomain = process.env.ADVANCED_STORE_DOMAIN;
  const advancedStoreToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;
  
  if (!advancedStoreDomain || !advancedStoreToken) {
    console.log("❌ [CRON] Advanced store configuration missing - skipping scheduled sync");
    console.log("Please ensure ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are set in your .env file");
    return;
  }
  
  console.log(`[CRON] Running incremental sync for Advanced store: ${advancedStoreDomain}`);
  
  // Set global flag to use advanced store for this cron run
  const originalUseAdvancedStore = global.useAdvancedStore;
  global.useAdvancedStore = true;
  
  syncProducts(true) // true = incremental sync
    .then(() => {
      console.log("[CRON] ✅ Scheduled incremental sync completed successfully");
    })
    .catch((error) => {
      console.error("[CRON] ❌ Scheduled incremental sync failed:", error);
    })
    .finally(() => {
      // Restore original flag
      global.useAdvancedStore = originalUseAdvancedStore;
    });
});

// Schedule order polling every 15 minutes - alternative to webhooks
cron.schedule("*/15 * * * *", () => {
  console.log("[ORDER-POLL] Checking for new orders...");
  pollForNewOrders().catch((error) => {
    console.error("[ORDER-POLL] ❌ Order polling failed:", error);
  });
});

// Schedule inventory sync every 30 minutes
cron.schedule("*/30 * * * *", () => {
  console.log("[INVENTORY-SYNC] Running scheduled inventory sync...");
  
  // Check if advanced store is configured
  const advancedStoreDomain = process.env.ADVANCED_STORE_DOMAIN;
  const advancedStoreToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;
  
  if (!advancedStoreDomain || !advancedStoreToken) {
    console.log("❌ [INVENTORY-SYNC] Advanced store configuration missing - skipping scheduled sync");
    return;
  }
  
  console.log(`[INVENTORY-SYNC] Running inventory sync for Advanced store: ${advancedStoreDomain}`);
  
  // Set global flag to use advanced store for this cron run
  const originalUseAdvancedStore = global.useAdvancedStore;
  global.useAdvancedStore = true;
  
  syncInventory()
    .then(() => {
      console.log("[INVENTORY-SYNC] ✅ Scheduled inventory sync completed successfully");
    })
    .catch((error) => {
      console.error("[INVENTORY-SYNC] ❌ Scheduled inventory sync failed:", error);
    })
    .finally(() => {
      // Restore original flag
      global.useAdvancedStore = originalUseAdvancedStore;
    });
});

// Display usage instructions
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Product Sync Job Usage:

To sync ALL products to development store (OAuth):
  node app/syncProductsJob.js

To sync ALL products to Advanced store:
  node app/syncProductsJob.js --advanced
  node app/syncProductsJob.js -a

🕐 Scheduled Sync:
  The job runs automatically every hour for the Advanced store with incremental sync
  (only syncs products that have changed in the last 48 hours)

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
⏰ Scheduled incremental sync runs every hour for Advanced store
`);

// Check if this is running as a worker process (with --advanced flag)
const isWorkerMode = useAdvancedStore;

if (isWorkerMode) {
  // In worker mode, just set up the cron schedule and keep the process alive
  console.log("🔄 Running in worker mode - cron schedule is active");
  console.log("⏰ Next incremental sync will run at the top of the next hour");
  
  // Keep the process alive by not calling syncProducts() immediately
  // The cron job will handle the scheduling
} else {
  // Run the sync immediately (full sync by default) - for manual execution
  syncProducts();
}
