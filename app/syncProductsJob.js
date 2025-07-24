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
      console.log("Fetched products", JSON.stringify(products));
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
      
      if (!productGroups.has(product.productName)) {
        productGroups.set(product.productName, []);
      }
      productGroups.get(product.productName).push(product);
    }

    const shop = session.shop;
    const accessToken = session.accessToken;

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
            metafields(first: 5, namespace: "custom", keys: ["product_name"]) {
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
  
  // Create variants array from all variations
  const variants = variations.map(variation => ({
    price: variation.price != null ? variation.price.toString() : "0",
    sku: variation.sku || "",
    weight: variation.weight != null && !isNaN(Number(variation.weight)) ? Number(variation.weight) : 0,
    barcode: variation.barcode || "",
    inventoryManagement: "shopify",
    inventoryPolicy: "deny",
    option1: variation.productVariation || "Default"
  }));

  const mutation = `mutation productCreate($input: ProductInput!) { 
    productCreate(input: $input) { 
      product { 
        id 
        title 
        status 
        variants(first: 10) {
          edges {
            node {
              id
              sku
              title
            }
          }
        }
      } 
      userErrors { 
        field 
        message 
      } 
    } 
  }`;
  
  const variables = {
    input: {
      title: productName,
      descriptionHtml: `<p>${variations[0].extraDescription || ""}</p>`,
      status: "ACTIVE",
      vendor: variations[0].vendor || "Default Vendor",
      options: ["Variation"],
      variants: variants,
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
    console.log(`Created product: ${json.data.productCreate.product.title} with ${json.data.productCreate.product.variants.edges.length} variants`);
    
    // Now add monitor_id metafields to each variant
    await addMonitorIdToVariants(shop, accessToken, json.data.productCreate.product.variants.edges, variations);
    
  } else if (json.data?.productCreate?.userErrors) {
    console.log(`User error creating product: ${json.data.productCreate.userErrors.map(e => e.message).join(", ")}`);
  } else {
    console.log("Unknown error creating product:", JSON.stringify(json));
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

  // Add each new variation as a separate variant
  for (const variation of newVariations) {
    const mutation = `mutation productVariantCreate($input: ProductVariantInput!) {
      productVariantCreate(input: $input) {
        productVariant {
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
      input: {
        productId: productId,
        price: variation.price != null ? variation.price.toString() : "0",
        sku: variation.sku || "",
        weight: variation.weight != null && !isNaN(Number(variation.weight)) ? Number(variation.weight) : 0,
        barcode: variation.barcode || "",
        inventoryManagement: "shopify",
        inventoryPolicy: "deny",
        option1: variation.productVariation || "Default",
        metafields: [
          {
            namespace: "custom",
            key: "monitor_id",
            value: variation.id.toString(),
            type: "single_line_text_field"
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
      console.error("Shopify GraphQL errors:", JSON.stringify(json.errors, null, 2));
    } else if (json.data?.productVariantCreate?.productVariant) {
      console.log(`Added variant: ${json.data.productVariantCreate.productVariant.sku} to product ${productId}`);
    } else if (json.data?.productVariantCreate?.userErrors) {
      console.log(`User error adding variant: ${json.data.productVariantCreate.userErrors.map(e => e.message).join(", ")}`);
    }
  }
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
            metafields(first: 5, namespace: "custom", keys: ["monitor_id"]) {
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

// Helper function to add monitor_id metafields to variants
async function addMonitorIdToVariants(shop, accessToken, variantEdges, variations) {
  const fetch = (await import('node-fetch')).default;
  
  // Match variants with variations by index (assuming they're in the same order)
  for (let i = 0; i < Math.min(variantEdges.length, variations.length); i++) {
    const variant = variantEdges[i].node;
    const variation = variations[i];
    
    const mutation = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
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
      metafields: [
        {
          ownerId: variant.id,
          namespace: "custom",
          key: "monitor_id",
          value: variation.id.toString(),
          type: "single_line_text_field"
        }
      ]
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
      console.error("GraphQL errors adding monitor_id:", JSON.stringify(json.errors, null, 2));
    } else if (json.data?.metafieldsSet?.userErrors?.length > 0) {
      console.log(`User error adding monitor_id: ${json.data.metafieldsSet.userErrors.map(e => e.message).join(", ")}`);
    } else {
      console.log(`Added monitor_id ${variation.id} to variant ${variant.sku}`);
    }
  }
}

// Schedule to run every hour
/*cron.schedule("0 * * * *", () => {
  console.log("[CRON] Syncing products to Shopify...");
  syncProducts();
});*/

// Run once on startup as well
syncProducts();
