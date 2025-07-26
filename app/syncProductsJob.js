import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import { fetchProductsFromMonitor } from "./utils/monitor.js";
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

async function syncProducts() {
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

  console.log("✅ Shopify session is valid. Starting product sync...");
  // Use the low-level GraphQL client from @shopify/shopify-api
  try {
    /*console.log("About to instantiate GraphqlClient");
    const admin = new shopifyConfig.clients.Graphql({
      session: {
        shop: session.shop,
        accessToken: session.accessToken,
      },
      apiVersion: "2024-01", // or your current ApiVersion
    });
    console.log("GraphqlClient instantiated successfully");*/
    let products;
    try {
      products = await fetchProductsFromMonitor();
      console.log(`Fetched ${products.length} products from Monitor API`);
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

    const shop = session.shop;
    const accessToken = session.accessToken;

    console.log(`Found ${productGroups.size} unique product groups to process`);
    
    // Show grouping summary
    for (const [productName, variations] of productGroups) {
      console.log(`Group: "${productName}" has ${variations.length} variations: [${variations.map(v => v.productVariation).join(', ')}]`);
    }

    // Process each product group
    for (const [productName, variations] of productGroups) {
      console.log(`Processing product: ${productName} with ${variations.length} variations`);
      
      // Check if product already exists in Shopify by productName
      const existingProduct = await findExistingProductByName(shop, accessToken, productName);
      
      if (existingProduct) {
        console.log(`Product "${productName}" already exists, adding new variations if needed`);
        await addVariationsToExistingProduct(shop, accessToken, existingProduct.id, variations);
      } else {
        console.log(`Creating new product: ${productName}`);
        await createNewProductWithVariations(shop, accessToken, productName, variations);
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
async function createNewProductWithVariations(shop, accessToken, productName, variations) {
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
      descriptionHtml: `<p>${variations[0].extraDescription || ""}</p>`,
      status: "ACTIVE",
      vendor: variations[0].vendor || "Default Vendor",
      metafields: [
        {
          namespace: "custom",
          key: "product_name",
          value: productName,
          type: "single_line_text_field"
        }
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
    return;
  }
  
  if (json.data?.productCreate?.product) {
    const productId = json.data.productCreate.product.id;
    console.log(`Created product: ${json.data.productCreate.product.title} with ID: ${productId}`);
    
    // Now create variants using productVariantsBulkCreate (this will automatically create the option)
    await createProductVariants(shop, accessToken, productId, variations);
    
  } else if (json.data?.productCreate?.userErrors) {
    console.log(`User error creating product: ${json.data.productCreate.userErrors.map(e => e.message).join(", ")}`);
  } else {
    console.log("Unknown error creating product:", JSON.stringify(json));
  }
}

// Helper function to create product variants using productVariantsBulkCreate
async function createProductVariants(shop, accessToken, productId, variations) {
  const fetch = (await import('node-fetch')).default;
  
  console.log(`Creating variants for product ${productId} with ${variations.length} variations`);
  
  // First, get the product options to find the option IDs we need
  const productOptions = await getProductOptions(shop, accessToken, productId);
  console.log('Product options for variant creation:', JSON.stringify(productOptions, null, 2));
  
  // Find the "Title" option (automatically created by Shopify)
  const titleOption = productOptions.find(option => option.name === "Title");
  
  if (!titleOption) {
    console.error("Could not find 'Title' option in product options");
    console.error("Available options:", productOptions.map(opt => opt.name));
    return;
  }
  
  console.log(`Found title option with ID: ${titleOption.id}`);
  
  // Create variants array for bulk creation (without SKU - we'll update it after creation)
  const variants = variations.map(variation => ({
    price: variation.price != null ? variation.price.toString() : "0",
    barcode: variation.barcode || "",
    inventoryPolicy: "DENY",
    taxable: true,
    optionValues: [
      {
        optionId: titleOption.id,
        name: variation.productVariation || "Default"
      }
    ],
    metafields: [
      {
        namespace: "custom",
        key: "monitor_id",
        value: variation.id.toString(),
        type: "single_line_text_field"
      },
      {
        namespace: "custom",
        key: "weight", 
        value: (variation.weight != null && !isNaN(Number(variation.weight)) ? Number(variation.weight) : 0).toString(),
        type: "single_line_text_field"
      }
    ]
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
    
    // Update each variant with its SKU
    for (let i = 0; i < createdVariants.length && i < variations.length; i++) {
      const variant = createdVariants[i];
      const variation = variations[i];
      if (variation.sku) {
        await updateVariantSku(shop, accessToken, variant.id, variation.sku);
      }
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
  const variationOption = productOptions.find(option => option.name === "Variation");
  
  if (!variationOption) {
    console.error("Could not find 'Variation' option in existing product");
    return;
  }

  // Create variants array for bulk creation (without SKU - we'll update it after creation)
  const variants = newVariations.map(variation => ({
    price: variation.price != null ? variation.price.toString() : "0",
    barcode: variation.barcode || "",
    inventoryPolicy: "DENY",
    taxable: true,
    optionValues: [
      {
        optionId: variationOption.id,
        name: variation.productVariation || "Default"
      }
    ],
    metafields: [
      {
        namespace: "custom",
        key: "monitor_id",
        value: variation.id.toString(),
        type: "single_line_text_field"
      },
      {
        namespace: "custom",
        key: "weight",
        value: (variation.weight != null && !isNaN(Number(variation.weight)) ? Number(variation.weight) : 0).toString(),
        type: "single_line_text_field"
      }
    ]
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
    
    // Update each variant with its SKU
    for (let i = 0; i < createdVariants.length && i < newVariations.length; i++) {
      const variant = createdVariants[i];
      const variation = newVariations[i];
      if (variation.sku) {
        await updateVariantSku(shop, accessToken, variant.id, variation.sku);
      }
    }
  } else if (json.data?.productVariantsBulkCreate?.userErrors) {
    console.log(`User error adding variants: ${json.data.productVariantsBulkCreate.userErrors.map(e => e.message).join(", ")}`);
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

// Schedule to run every hour
/*cron.schedule("0 * * * *", () => {
  console.log("[CRON] Syncing products to Shopify...");
  syncProducts();
});*/

// Run once on startup as well
syncProducts();
