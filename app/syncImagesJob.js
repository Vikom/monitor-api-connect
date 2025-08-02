import "@shopify/shopify-api/adapters/node";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
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

const IMAGES_DIR = path.join(process.cwd(), "images-sync", "formatted-72dpi");
const CSV_PATH = path.join(process.cwd(), "images-sync", "images-sonsab.csv");

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

// Helper function to parse CSV and create SKU to image mapping
function loadImageMapping() {
  try {
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = csvContent.split('\n');
    const mapping = new Map();

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(';');
      if (columns.length >= 4) {
        const partNumber = columns[0].trim(); // Artikelnummer (SKU)
        const category = columns[3].trim(); // Artikelkategori (potential image name)
        
        // Try to find matching image file
        const imageFileName = findImageFile(category);
        if (imageFileName) {
          mapping.set(partNumber, imageFileName);
          console.log(`Mapped SKU ${partNumber} -> ${imageFileName}`);
        }
      }
    }

    console.log(`Loaded ${mapping.size} SKU to image mappings`);
    return mapping;
  } catch (error) {
    console.error("Error loading image mapping:", error);
    return new Map();
  }
}

// Helper function to find image file based on category
function findImageFile(category) {
  if (!category) return null;

  try {
    const files = fs.readdirSync(IMAGES_DIR);
    
    // Direct match: category.webp
    const directMatch = `${category}.webp`;
    if (files.includes(directMatch)) {
      return directMatch;
    }

    // Case-insensitive match
    const lowerCategory = category.toLowerCase();
    for (const file of files) {
      if (file.toLowerCase() === `${lowerCategory}.webp`) {
        return file;
      }
    }

    // Partial match (category contains part of filename or vice versa)
    for (const file of files) {
      const fileName = file.replace('.webp', '').toLowerCase();
      if (fileName.includes(lowerCategory) || lowerCategory.includes(fileName)) {
        return file;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error finding image file for category ${category}:`, error);
    return null;
  }
}

// Helper function to get all products from Shopify with their variants
async function getAllShopifyProducts(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  const products = [];
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
            images(first: 10) {
              edges {
                node {
                  id
                  url
                  altText
                }
              }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  title
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
        console.error("GraphQL errors while fetching products:", JSON.stringify(result.errors, null, 2));
        break;
      }

      if (result.data?.products?.edges) {
        for (const edge of result.data.products.edges) {
          products.push(edge.node);
        }
      }

      hasNextPage = result.data?.products?.pageInfo?.hasNextPage || false;
      endCursor = result.data?.products?.pageInfo?.endCursor;
    } catch (error) {
      console.error("Error fetching products:", error);
      break;
    }
  }

  return products;
}

// Helper function to create staged upload target
async function createStagedUpload(shop, accessToken, fileName) {
  const fetch = (await import('node-fetch')).default;

  const mutation = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    input: [
      {
        filename: fileName,
        mimeType: "image/webp",
        httpMethod: "POST",
        resource: "IMAGE"
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
      console.error("GraphQL errors creating staged upload:", JSON.stringify(result.errors, null, 2));
      return null;
    }

    if (result.data?.stagedUploadsCreate?.stagedTargets?.[0]) {
      return result.data.stagedUploadsCreate.stagedTargets[0];
    } else if (result.data?.stagedUploadsCreate?.userErrors?.length > 0) {
      console.error("User errors creating staged upload:", result.data.stagedUploadsCreate.userErrors);
    }

    return null;
  } catch (error) {
    console.error("Error creating staged upload:", error);
    return null;
  }
}

// Helper function to upload file to staged URL
async function uploadFileToStaged(stagedTarget, imagePath) {
  const fetch = (await import('node-fetch')).default;
  const FormData = (await import('form-data')).default;

  try {
    const formData = new FormData();
    
    // Add all the parameters from Shopify
    for (const param of stagedTarget.parameters) {
      formData.append(param.name, param.value);
    }
    
    // Add the file
    const imageBuffer = fs.readFileSync(imagePath);
    formData.append('file', imageBuffer, {
      filename: path.basename(imagePath),
      contentType: 'image/webp'
    });

    const response = await fetch(stagedTarget.url, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      return stagedTarget.resourceUrl;
    } else {
      console.error(`Failed to upload to staged URL: ${response.status} ${response.statusText}`);
      const responseText = await response.text();
      console.error("Response:", responseText);
      return null;
    }
  } catch (error) {
    console.error("Error uploading file to staged URL:", error);
    return null;
  }
}

// Helper function to upload image to Shopify
async function uploadImageToProduct(shop, accessToken, productId, imagePath, isFirst = false) {
  const fetch = (await import('node-fetch')).default;
  
  try {
    const fileName = path.basename(imagePath);

    // Step 1: Create staged upload
    console.log(`    Creating staged upload for ${fileName}...`);
    const stagedTarget = await createStagedUpload(shop, accessToken, fileName);
    if (!stagedTarget) {
      console.error(`Failed to create staged upload for ${fileName}`);
      return null;
    }

    // Step 2: Upload file to staged URL
    console.log(`    Uploading ${fileName} to staged URL...`);
    const resourceUrl = await uploadFileToStaged(stagedTarget, imagePath);
    if (!resourceUrl) {
      console.error(`Failed to upload ${fileName} to staged URL`);
      return null;
    }

    // Step 3: Create media using the staged upload
    console.log(`    Creating media from staged upload...`);
    const mutation = `mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
      productCreateMedia(media: $media, productId: $productId) {
        media {
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
        mediaUserErrors {
          field
          message
        }
      }
    }`;

    const variables = {
      productId: productId,
      media: [
        {
          alt: fileName.replace('.webp', ''),
          mediaContentType: "IMAGE",
          originalSource: resourceUrl
        }
      ]
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
      console.error(`GraphQL errors uploading image ${fileName}:`, JSON.stringify(result.errors, null, 2));
      return null;
    }

    if (result.data?.productCreateMedia?.media?.[0]) {
      const uploadedMedia = result.data.productCreateMedia.media[0];
      console.log(`  ✅ Uploaded ${fileName} to product ${productId}`);
      
      // If this is the first image, set it as featured image
      if (isFirst) {
        await setFeaturedImage(shop, accessToken, productId, uploadedMedia.id);
      }
      
      return uploadedMedia;
    } else if (result.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
      console.error(`Media upload errors for ${fileName}:`, result.data.productCreateMedia.mediaUserErrors);
    }

    return null;
  } catch (error) {
    console.error(`Error uploading image ${imagePath}:`, error);
    return null;
  }
}

// Helper function to set featured image
async function setFeaturedImage(shop, accessToken, productId, mediaId) {
  const fetch = (await import('node-fetch')).default;

  // Use productUpdate mutation to set featured media
  const mutation = `mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        featuredMedia {
          id
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
      id: productId,
      featuredMedia: mediaId
    }
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
      console.error("GraphQL errors setting featured image:", JSON.stringify(result.errors, null, 2));
      return false;
    }

    if (result.data?.productUpdate?.product) {
      console.log(`  ✅ Set featured image for product ${productId}`);
      return true;
    } else if (result.data?.productUpdate?.userErrors?.length > 0) {
      console.error("User errors setting featured image:", result.data.productUpdate.userErrors);
    }

    return false;
  } catch (error) {
    console.error("Error setting featured image:", error);
    return false;
  }
}

async function syncImages() {
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
      console.log("No Shopify session found. Cannot sync images.");
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

  console.log("✅ Store session is valid. Starting image sync...");

  try {
    // Load image mapping from CSV
    const imageMapping = loadImageMapping();
    if (imageMapping.size === 0) {
      console.log("No image mappings found. Please check the CSV file and image directory.");
      return;
    }

    // Get all products from Shopify
    console.log("Fetching products from Shopify...");
    const products = await getAllShopifyProducts(shop, accessToken);
    console.log(`Found ${products.length} products in Shopify`);

    let processedProducts = 0;
    let productsWithImages = 0;

    // Process each product
    for (const product of products) {
      console.log(`\nProcessing product: ${product.title}`);
      
      // Check if product already has images
      const existingImages = product.images.edges || [];
      if (existingImages.length > 0) {
        console.log(`  Product already has ${existingImages.length} images, skipping...`);
        continue;
      }

      // Find images for this product's variants
      const imagesToUpload = [];
      const variantSkus = new Set();

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        if (variant.sku && !variantSkus.has(variant.sku)) {
          variantSkus.add(variant.sku);
          const imageFileName = imageMapping.get(variant.sku);
          if (imageFileName) {
            const imagePath = path.join(IMAGES_DIR, imageFileName);
            if (fs.existsSync(imagePath) && !imagesToUpload.includes(imagePath)) {
              imagesToUpload.push(imagePath);
              console.log(`  Found image for SKU ${variant.sku}: ${imageFileName}`);
            }
          }
        }
      }

      // Upload images if found
      if (imagesToUpload.length > 0) {
        console.log(`  Uploading ${imagesToUpload.length} images...`);
        
        for (let i = 0; i < imagesToUpload.length; i++) {
          const imagePath = imagesToUpload[i];
          const isFirst = i === 0; // First image becomes featured image
          
          await uploadImageToProduct(
            shop, 
            accessToken, 
            product.id, 
            imagePath, 
            isFirst
          );
          
          // Add a small delay between uploads to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
        productsWithImages++;
      } else {
        console.log(`  No images found for any variant SKUs`);
      }

      processedProducts++;
      
      // Add a delay between products to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✅ Image sync completed!`);
    console.log(`Processed ${processedProducts} products`);
    console.log(`Added images to ${productsWithImages} products`);

  } catch (error) {
    console.error("Error during image sync:", error);
  }
}

// Display usage instructions
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Images Sync Job Usage:

To sync to development store (OAuth):
  node app/syncImagesJob.js

To sync to Advanced store:
  node app/syncImagesJob.js --advanced
  node app/syncImagesJob.js -a

Configuration:
  Development store: Uses Prisma session from OAuth flow
  Advanced store: Uses ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN from .env

Make sure your .env file is configured properly before running.
  `);
  process.exit(0);
}

console.log(`
🚀 Starting Images Sync Job
📝 Use --help for usage instructions
`);

// Run the sync
syncImages();
