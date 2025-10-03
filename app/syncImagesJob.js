import "@shopify/shopify-api/adapters/node";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
dotenv.config();

// Get command line arguments to determine which store to sync to
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a');
const forceAssignImages = args.includes('--force-assign') || args.includes('-f');
const singleTestMode = args.includes('--single-test');

console.log(`🎯 Target store: ${useAdvancedStore ? 'Advanced Store' : 'Development Store'}`);
console.log(`🔧 Force assign images: ${forceAssignImages ? 'Yes' : 'No'}`);
console.log(`🧪 Single test mode: ${singleTestMode ? 'Yes (only first product)' : 'No'}`);

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

const IMAGES_DIR = path.join(process.cwd(), "images-sync", "images-all");
const CSV_PATH = path.join(process.cwd(), "images-sync", "images-sonsab-all.csv");

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
      
      // New CSV format: Artikelnummer;column2;ImageName1;ImageName2(optional)
      if (columns.length >= 3) {
        const artikelnummer = columns[0].trim(); // Artikelnummer (SKU)
        const imageName1 = columns[2].trim(); // First image name (3rd column)
        const imageName2 = columns.length >= 4 ? columns[3].trim() : ''; // Second image name (4th column, optional)
        
        const images = [];
        
        // Check first image
        if (imageName1) {
          const imageFile1 = `${imageName1}.webp`;
          const imagePath1 = path.join(IMAGES_DIR, imageFile1);
          
          if (fs.existsSync(imagePath1)) {
            images.push(imageFile1);
            console.log(`Mapped SKU ${artikelnummer} -> ${imageFile1}`);
          }
        }
        
        // Check second image if it exists
        if (imageName2) {
          const imageFile2 = `${imageName2}.webp`;
          const imagePath2 = path.join(IMAGES_DIR, imageFile2);
          
          if (fs.existsSync(imagePath2)) {
            images.push(imageFile2);
            console.log(`Mapped SKU ${artikelnummer} -> ${imageFile2} (second image)`);
          }
        }
        
        // Store the images array for this SKU
        if (images.length > 0) {
          mapping.set(artikelnummer, images);
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

  // Determine MIME type based on file extension
  const isJpg = fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg');
  const mimeType = isJpg ? "image/jpeg" : "image/webp";

  const variables = {
    input: [
      {
        filename: fileName,
        mimeType: mimeType,
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
    const fileName = path.basename(imagePath);
    const isJpg = fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg');
    const contentType = isJpg ? 'image/jpeg' : 'image/webp';
    
    formData.append('file', imageBuffer, {
      filename: fileName,
      contentType: contentType
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

// Phase 2: Assign images to variants for a product
async function assignImagesToVariantsForProduct(shop, accessToken, product, imageMapping) {
  const fetch = (await import('node-fetch')).default;
  
  try {
    console.log(`\n🔗 Assigning images to variants for: ${product.title}`);
    
    // Get current images for this product via REST API
    const numericProductId = product.id.split('/').pop();
    const response = await fetch(`https://${shop}/admin/api/2025-01/products/${numericProductId}/images.json`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    });

    if (!response.ok) {
      console.error(`  ❌ Failed to fetch images for product ${numericProductId}`);
      return false;
    }

    const result = await response.json();
    const productImages = result.images || [];
    
    if (productImages.length === 0) {
      console.log(`  ℹ️  No images found for product`);
      return false;
    }

    console.log(`  📸 Found ${productImages.length} images on product`);

    // Group variants by SKU and find the first image for each SKU
    const skuToVariantIds = new Map();
    
    for (const variantEdge of product.variants.edges) {
      const variant = variantEdge.node;
      if (variant.sku && imageMapping.has(variant.sku)) {
        if (!skuToVariantIds.has(variant.sku)) {
          skuToVariantIds.set(variant.sku, []);
        }
        skuToVariantIds.get(variant.sku).push(variant.id);
      }
    }

    if (skuToVariantIds.size === 0) {
      console.log(`  ℹ️  No variants with matching SKUs found`);
      return false;
    }

    // For each SKU, find the matching image and assign it to variants
    let assignedCount = 0;
    for (const [sku, variantIds] of skuToVariantIds) {
      const imageFiles = imageMapping.get(sku);
      if (imageFiles && Array.isArray(imageFiles) && imageFiles.length > 0) {
        const firstImageName = imageFiles[0].replace('.webp', ''); // Remove extension for matching
        
        // Find the image in productImages that matches this SKU
        const matchingImage = productImages.find(img => 
          img.alt && img.alt.includes(firstImageName)
        );
        
        if (matchingImage) {
          console.log(`  🎯 Assigning ${firstImageName}.webp to ${variantIds.length} variants for SKU ${sku}`);
          await assignImageToVariants(shop, accessToken, product.id, variantIds, matchingImage.id);
          assignedCount++;
        } else {
          console.log(`  ⚠️  Could not find matching image for SKU ${sku} (looking for: ${firstImageName})`);
        }
      }
    }

    console.log(`  ✅ Assigned images to variants for ${assignedCount} SKUs`);
    return assignedCount > 0;

  } catch (error) {
    console.error(`  ❌ Error assigning images to variants for product ${product.title}:`, error);
    return false;
  }
}



// Helper function to upload image to Shopify (Phase 1: Upload only)
async function uploadImageToProduct(shop, accessToken, productId, imagePath, skuForImage) {
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
          alt: skuForImage ? `${skuForImage} - ${fileName.replace(/\.(webp|jpg|jpeg)$/i, '')}` : fileName.replace(/\.(webp|jpg|jpeg)$/i, ''),
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
      
      return {
        ...uploadedMedia,
        fileName: fileName,
        skuForImage: skuForImage
      };
    } else if (result.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
      console.error(`Media upload errors for ${fileName}:`, result.data.productCreateMedia.mediaUserErrors);
    }

    return null;
  } catch (error) {
    console.error(`Error uploading image ${imagePath}:`, error);
    return null;
  }
}

// Helper function to assign image to variants using REST API
async function assignImageToVariants(shop, accessToken, productId, variantIds, restImageId) {
  const fetch = (await import('node-fetch')).default;
  
  console.log(`    Assigning image ${restImageId} to ${variantIds.length} variants...`);
  
  for (const variantId of variantIds) {
    try {
      // Extract numeric ID from GraphQL ID
      const numericVariantId = variantId.split('/').pop();
      
      const response = await fetch(`https://${shop}/admin/api/2025-01/variants/${numericVariantId}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          variant: {
            id: parseInt(numericVariantId),
            image_id: parseInt(restImageId)
          }
        }),
      });

      if (response.ok) {
        console.log(`      ✅ Assigned image to variant ${numericVariantId}`);
      } else {
        const errorText = await response.text();
        console.error(`      ❌ Failed to assign image to variant ${numericVariantId}: ${response.status} ${response.statusText}`);
        console.error(`      Response: ${errorText}`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`      Error assigning image to variant ${variantId}:`, error);
    }
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

    // Two-phase approach for better reliability and performance
    const productsToProcess = singleTestMode ? products.slice(0, 1) : products;
    
    if (singleTestMode && productsToProcess.length > 0) {
      console.log(`🧪 Single test mode: Processing only "${productsToProcess[0].title}"`);
    }

    console.log(`\n🚀 Starting Phase 1: Uploading images to products...`);
    
    // PHASE 1: Upload all images to their products
    for (const product of productsToProcess) {
      console.log(`\n📸 Uploading images for: ${product.title}`);
      
      // Check if product already has images
      const existingImages = product.images.edges || [];
      if (existingImages.length > 0 && !forceAssignImages) {
        console.log(`  ℹ️  Product already has ${existingImages.length} images, skipping upload...`);
        continue;
      } else if (existingImages.length > 0 && forceAssignImages) {
        console.log(`  ⚠️  Product has ${existingImages.length} images, but force assign is enabled, skipping upload...`);
        continue;
      }

      // Find images for this product's variants
      const imagesToUpload = [];
      const processedImagePaths = new Set();
      
      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        if (variant.sku) {
          const imageFiles = imageMapping.get(variant.sku);
          if (imageFiles && Array.isArray(imageFiles)) {
            // Process all images for this SKU (can be 1 or 2 images)
            for (const imageFileName of imageFiles) {
              const imagePath = path.join(IMAGES_DIR, imageFileName);
              
              // Only add unique images (prevent duplicates within the same product)
              if (fs.existsSync(imagePath) && !processedImagePaths.has(imagePath)) {
                processedImagePaths.add(imagePath);
                imagesToUpload.push({
                  path: imagePath,
                  sku: variant.sku,
                  fileName: imageFileName
                });
                console.log(`  📋 Found image for SKU ${variant.sku}: ${imageFileName}`);
              }
            }
          }
        }
      }

      // Upload all images for this product
      if (imagesToUpload.length > 0) {
        console.log(`  ⬆️  Uploading ${imagesToUpload.length} images...`);
        
        for (let i = 0; i < imagesToUpload.length; i++) {
          const imageInfo = imagesToUpload[i];
          const uploadedMedia = await uploadImageToProduct(
            shop, 
            accessToken, 
            product.id, 
            imageInfo.path,
            imageInfo.sku
          );
          
          if (uploadedMedia) {
            productsWithImages++;
          }
          
          // Rate limiting delay
          if (i < imagesToUpload.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } else {
        console.log(`  ℹ️  No new images to upload for this product`);
      }

      processedProducts++;
      
      // Progress tracking
      if (processedProducts % 10 === 0) {
        console.log(`📊 Phase 1 Progress: ${processedProducts}/${productsToProcess.length} products processed`);
      }
      
      // Short delay between products
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n✅ Phase 1 Complete! Uploaded images to ${productsWithImages} products`);
    console.log(`\n🔗 Starting Phase 2: Assigning images to variants...`);

    // PHASE 2: Assign images to variants
    let variantAssignmentCount = 0;
    
    for (const product of productsToProcess) {
      const wasAssigned = await assignImagesToVariantsForProduct(shop, accessToken, product, imageMapping);
      if (wasAssigned) {
        variantAssignmentCount++;
      }
      
      // Progress tracking for phase 2
      const currentIndex = productsToProcess.indexOf(product) + 1;
      if (currentIndex % 10 === 0) {
        console.log(`📊 Phase 2 Progress: ${currentIndex}/${productsToProcess.length} products processed`);
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n✅ Phase 2 Complete! Assigned images to variants for ${variantAssignmentCount} products`);

    console.log(`\n🎉 Image sync completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   • Processed ${processedProducts} products${singleTestMode ? ' (single test mode)' : ''}`);
    console.log(`   • Added images to ${productsWithImages} products`);
    console.log(`   • Assigned variants for ${variantAssignmentCount} products`);

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
  node app/syncImagesJob.js --force-assign    (assign images to variants even if products have images)
  node app/syncImagesJob.js --single-test     (process only the first product for testing)

To sync to Advanced store:
  node app/syncImagesJob.js --advanced
  node app/syncImagesJob.js -a
  node app/syncImagesJob.js -a --force-assign
  node app/syncImagesJob.js -a --single-test

Flags:
  --advanced, -a        Use Advanced store configuration
  --force-assign, -f    Assign images to variants even if products already have images
  --single-test         Process only the first product (all variants) for testing purposes

Configuration:
  Uses images-sonsab-all.csv with format: Artikelnummer;column2;ImageName1;ImageName2(optional)
  All images are .webp format in images-all directory
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
