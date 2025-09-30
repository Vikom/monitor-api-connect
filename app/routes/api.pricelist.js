import { json } from "@remix-run/node";
import PDFDocument from "pdfkit";
import https from "https";
import { sendPricelistEmail } from "../utils/email.js";

// HTTPS agent to handle self-signed certificates
const agent = new https.Agent({ rejectUnauthorized: false });

// Monitor API configuration
const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;
const OUTLET_PRICE_LIST_ID = "1289997006982727753";

// Simple session management for this endpoint
let sessionId = null;

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Handle GET/OPTIONS requests for CORS
export async function loader({ request }) {
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }

  // For GET requests, return method not allowed
  return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

export async function action({ request }) {
  const method = request.method;

  if (method !== "POST") {
    return json({ error: "Method not allowed" }, { 
      status: 405,
      headers: corsHeaders()
    });
  }

  try {
    const body = await request.json();
    const {
      customer_id,
      customer_email,
      customer_company,
      monitor_id,
      format = 'pdf',
      selection_method,
      collections = [],
      products = [],
      shop
    } = body;

    // Validate required fields
    if (!customer_id) {
      return json({ error: 'Customer ID is required' }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

    if (!customer_email) {
      return json({ error: 'Customer email is required' }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

    if (!monitor_id || monitor_id.trim() === '') {
      return json({ 
        error: 'Customer Monitor ID is required for pricing. Please ensure the customer has a monitor_id set in their custom fields.' 
      }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

    if (!shop) {
      return json({ error: "Shop domain is required" }, { 
        status: 400, 
        headers: corsHeaders() 
      });
    }

    console.log('=== PRICELIST REQUEST DEBUG ===');
    console.log('Raw request body:', JSON.stringify(body, null, 2));
    console.log('Parsed fields:');
    console.log('  - Customer ID:', customer_id);
    console.log('  - Customer Email:', customer_email);
    console.log('  - Customer Company:', customer_company);
    console.log('  - Monitor ID:', monitor_id);
    console.log('  - Format:', format);
    console.log('  - Selection method:', selection_method);
    console.log('  - Collections:', collections);
    console.log('  - Products:', products);
    console.log('  - Shop:', shop);
    console.log('=== END PRICELIST REQUEST DEBUG ===');

    // For private apps, use direct API credentials from environment
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN || process.env.ADVANCED_STORE_ADMIN_TOKEN;
    
    if (!accessToken) {
      console.error('🟦 No SHOPIFY_ACCESS_TOKEN or ADVANCED_STORE_ADMIN_TOKEN found in environment');
      return json({ 
        error: "Private app access token not configured", 
        suggestion: "Add SHOPIFY_ACCESS_TOKEN or check ADVANCED_STORE_ADMIN_TOKEN in Railway environment variables"
      }, { status: 500, headers: corsHeaders() });
    }
    
    console.log(`🟦 Using private app credentials for ${shop}`);

    // Fetch products based on selection method
    let productList = [];
    
    switch (selection_method) {
      case 'collections':
        productList = await fetchProductsByCollections(collections, shop, accessToken);
        break;
      case 'products':
        productList = await fetchProductsByIds(products, shop, accessToken);
        break;
      case 'all':
        productList = await fetchAllProducts(shop, accessToken);
        break;
      default:
        return json({ error: 'Invalid selection method' }, { 
          status: 400,
          headers: corsHeaders()
        });
    }

    console.log(`Found ${productList.length} products to process`);

    // Get pricing for all products with global timeout
    console.log('🔄 Starting pricing fetch with 2-minute timeout...');
    let priceData = [];
    
    try {
      priceData = await Promise.race([
        fetchPricingForProducts(productList, customer_id, shop, accessToken, monitor_id),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Pricing fetch timed out after 2 minutes')), 120000)
        )
      ]);
      console.log(`✅ Generated pricing data for ${priceData.length} items`);
    } catch (pricingError) {
      console.error('⚠️ Pricing fetch failed, creating fallback price data:', pricingError.message);
      
      // Create fallback price data with original prices
      priceData = [];
      for (const product of productList) {
        if (product.variants?.edges) {
          for (const variantEdge of product.variants.edges) {
            const variant = variantEdge.node;
            priceData.push({
              productTitle: product.title,
              variantTitle: variant.title || 'Default',
              sku: variant.sku || '',
              originalPrice: parseFloat(variant.price) || 0,
              customerPrice: null,
              priceSource: "pricing-error",
              monitorId: variant.monitorIdMetafield?.value || '',
              standardUnit: variant.standardUnitMetafield?.value || 'st',
              width: variant.widthMetafield?.value || '',
              depth: variant.depthMetafield?.value || '',
              length: variant.lengthMetafield?.value || '',
              formattedPrice: 'Prisfel - kontakta oss'
            });
          }
        }
      }
      console.log(`⚠️ Created fallback pricing data for ${priceData.length} items`);
    }

    // Generate file and send via email
    if (format === 'pdf') {
      console.log('🔄 Starting PDF generation...');
      const pdfBuffer = await generatePDF(priceData, customer_email, customer_company);
      console.log(`✅ PDF generated successfully: ${pdfBuffer.length} bytes`);
      
      console.log(`📧 Sending email to: ${customer_email}`);
      // Send email with PDF attachment
      const emailResult = await sendPricelistEmail(
        customer_email, 
        customer_company, 
        pdfBuffer, 
        'pdf', 
        priceData
      );
      console.log(`✅ Email sent successfully: ${emailResult.messageId}`);
      
      return json({ 
        success: true, 
        message: 'Prislistan har skickats till din e-postadress',
        messageId: emailResult.messageId,
        filename: emailResult.filename
      }, { 
        status: 200,
        headers: corsHeaders()
      });
    } else if (format === 'csv') {
      console.log('🔄 Starting CSV generation...');
      const csvData = generateCSV(priceData);
      const csvBuffer = Buffer.from(csvData, 'utf8');
      console.log(`✅ CSV generated successfully: ${csvBuffer.length} bytes`);
      
      console.log(`📧 Sending email to: ${customer_email}`);
      // Send email with CSV attachment
      const emailResult = await sendPricelistEmail(
        customer_email, 
        customer_company, 
        csvBuffer, 
        'csv', 
        priceData
      );
      console.log(`✅ Email sent successfully: ${emailResult.messageId}`);
      
      return json({ 
        success: true, 
        message: 'Prislistan har skickats till din e-postadress',
        messageId: emailResult.messageId,
        filename: emailResult.filename
      }, { 
        status: 200,
        headers: corsHeaders()
      });
    } else {
      return json({ error: 'Invalid format. Use "pdf" or "csv"' }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

  } catch (error) {
    console.error('❌ Error generating price list:', error);
    console.error('Error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to generate price list';
    if (error.message.includes('EMAIL_PASSWORD')) {
      errorMessage = 'Email configuration error - missing password';
    } else if (error.message.includes('SMTP') || error.message.includes('Authentication')) {
      errorMessage = 'Email sending failed - authentication error';
    } else if (error.message.includes('PDF') || error.message.includes('generatePDF')) {
      errorMessage = 'PDF generation failed';
    } else if (error.message.includes('CSV') || error.message.includes('generateCSV')) {
      errorMessage = 'CSV generation failed';
    }
    
    return json({ 
      error: errorMessage, 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { 
      status: 500,
      headers: corsHeaders()
    });
  }
}

/**
 * Fetch products by collection IDs using Shopify API
 * @param {Array} collections - Array of collection IDs (string) or collection objects ({id, monitor_id})
 */
async function fetchProductsByCollections(collections, shop, accessToken) {
  console.log(`Fetching products from ${collections.length} collections`);
  const products = [];
  
  try {
    for (const collection of collections) {
      try {
        // Handle different formats: number, string ID, or object with {id, monitor_id}
        let collectionId, collectionMonitorId;
        
        if (typeof collection === 'number') {
          // Collection ID as number (most common from frontend)
          collectionId = collection.toString();
          collectionMonitorId = null;
        } else if (typeof collection === 'string') {
          // Collection ID as string
          collectionId = collection;
          collectionMonitorId = null;
        } else if (typeof collection === 'object' && collection.id) {
          // Object with id and monitor_id
          collectionId = collection.id.toString();
          collectionMonitorId = collection.monitor_id;
        } else {
          console.error(`Invalid collection format:`, collection);
          continue;
        }
        
        console.log(`Fetching products from collection ${collectionId}${collectionMonitorId ? ` (Monitor ID: ${collectionMonitorId})` : ''}`);
        
        // Use GraphQL to fetch products from collection
        const query = `
          query GetCollectionProducts($id: ID!) {
            collection(id: $id) {
              id
              title
              products(first: 250) {
                edges {
                  node {
                    id
                    title
                    handle
                    tags
                    variants(first: 100) {
                      edges {
                        node {
                          id
                          title
                          sku
                          price
                          inventoryQuantity
                          monitorIdMetafield: metafield(namespace: "custom", key: "monitor_id") {
                            value
                          }
                          standardUnitMetafield: metafield(namespace: "custom", key: "standard_unit") {
                            value
                          }
                          widthMetafield: metafield(namespace: "custom", key: "width") {
                            value
                          }
                          depthMetafield: metafield(namespace: "custom", key: "depth") {
                            value
                          }
                          lengthMetafield: metafield(namespace: "custom", key: "length") {
                            value
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const variables = {
          id: `gid://shopify/Collection/${collectionId}`
        };

        const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query, variables })
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.data?.collection?.products?.edges) {
            const collectionProducts = data.data.collection.products.edges.map(edge => {
              const product = edge.node;
              console.log(`Product ${product.id} (${product.title}) has ${product.variants?.edges?.length || 0} variants`);
              
              // Log variant details (reduced logging to avoid rate limits)
              if (product.variants?.edges) {
                product.variants.edges.forEach((variantEdge, index) => {
                  const variant = variantEdge.node;
                  const monitorId = variant.monitorIdMetafield?.value;
                  console.log(`  Variant ${index + 1}: ID=${variant.id}, SKU=${variant.sku}, MonitorID=${monitorId || 'NONE'}`);
                });
              }
              
              // If we have a collection Monitor ID, we could potentially use it for optimization
              // For now, we still fetch individual variant Monitor IDs as before
              return product;
            });
            products.push(...collectionProducts);
            console.log(`Added ${collectionProducts.length} products from collection ${collectionId}`);
          } else if (data.errors) {
            console.error(`GraphQL errors for collection ${collectionId}:`, data.errors);
          } else {
            console.log(`No products found in collection ${collectionId}`);
          }
        } else {
          const errorText = await response.text();
          console.error(`Failed to fetch products from collection ${collectionId}:`, response.status, errorText);
        }
      } catch (error) {
        console.error(`Error fetching products from collection ${collection}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in fetchProductsByCollections:', error);
  }
  
  console.log(`Total products fetched: ${products.length}`);
  return products;
}

/**
 * Fetch specific products by product IDs using Shopify API
 * @param {Array} products - Array of product IDs (string) or product objects ({id, monitor_id})
 */
async function fetchProductsByIds(products, shop, accessToken) {
  console.log(`Fetching ${products.length} specific products`);
  const fetchedProducts = [];
  
  try {
    for (const product of products) {
      try {
        // Handle different formats: number, string ID, or object with {id, monitor_id}
        let productId, productMonitorId;
        
        if (typeof product === 'number') {
          // Product ID as number (most common from frontend)
          productId = product.toString();
          productMonitorId = null;
        } else if (typeof product === 'string') {
          // Product ID as string
          productId = product;
          productMonitorId = null;
        } else if (typeof product === 'object' && product.id) {
          // Object with id and monitor_id
          productId = product.id.toString();
          productMonitorId = product.monitor_id;
        } else {
          console.error(`Invalid product format:`, product);
          continue;
        }
        
        console.log(`Fetching product ${productId}${productMonitorId ? ` (Monitor ID: ${productMonitorId})` : ''}`);
        
        // Use GraphQL to fetch product details
        const query = `
          query GetProduct($id: ID!) {
            product(id: $id) {
              id
              title
              handle
              tags
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    inventoryQuantity
                    monitorIdMetafield: metafield(namespace: "custom", key: "monitor_id") {
                      value
                    }
                    standardUnitMetafield: metafield(namespace: "custom", key: "standard_unit") {
                      value
                    }
                    widthMetafield: metafield(namespace: "custom", key: "width") {
                      value
                    }
                    depthMetafield: metafield(namespace: "custom", key: "depth") {
                      value
                    }
                    lengthMetafield: metafield(namespace: "custom", key: "length") {
                      value
                    }
                  }
                }
              }
            }
          }
        `;

        const variables = {
          id: `gid://shopify/Product/${productId}`
        };

        const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query, variables })
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.data?.product) {
            const fetchedProduct = data.data.product;
            console.log(`Product ${fetchedProduct.id} (${fetchedProduct.title}) has ${fetchedProduct.variants?.edges?.length || 0} variants`);
            
            // Log variant details (reduced logging to avoid rate limits)
            if (fetchedProduct.variants?.edges) {
              fetchedProduct.variants.edges.forEach((variantEdge, index) => {
                const variant = variantEdge.node;
                const monitorId = variant.monitorIdMetafield?.value;
                console.log(`  Variant ${index + 1}: ID=${variant.id}, SKU=${variant.sku}, MonitorID=${monitorId || 'NONE'}`);
              });
            }
            
            // If we have a product Monitor ID from the frontend, we could use it for optimization
            // For now, we still fetch individual variant Monitor IDs as before
            fetchedProducts.push(fetchedProduct);
            console.log(`Fetched product: ${fetchedProduct.title}`);
          } else if (data.errors) {
            console.error(`GraphQL errors for product ${productId}:`, data.errors);
          } else {
            console.log(`No product found for ${productId}`);
          }
        } else {
          const errorText = await response.text();
          console.error(`Failed to fetch product ${productId}:`, response.status, errorText);
        }
      } catch (error) {
        console.error(`Error fetching product ${product}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in fetchProductsByIds:', error);
  }
  
  console.log(`Total products fetched: ${fetchedProducts.length}`);
  return fetchedProducts;
}

/**
 * Fetch all products using Shopify API
 */
async function fetchAllProducts(shop, accessToken) {
  console.log('Fetching all products');
  const products = [];
  
  try {
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query GetAllProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                handle
                tags
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                      inventoryQuantity
                      monitorIdMetafield: metafield(namespace: "custom", key: "monitor_id") {
                        value
                      }
                      standardUnitMetafield: metafield(namespace: "custom", key: "standard_unit") {
                        value
                      }
                      widthMetafield: metafield(namespace: "custom", key: "width") {
                        value
                      }
                      depthMetafield: metafield(namespace: "custom", key: "depth") {
                        value
                      }
                      lengthMetafield: metafield(namespace: "custom", key: "length") {
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const variables = { first: 100 };
      if (cursor) {
        variables.after = cursor;
      }

      const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data?.products) {
          const pageProducts = data.data.products.edges.map(edge => edge.node);
          products.push(...pageProducts);
          
          hasNextPage = data.data.products.pageInfo.hasNextPage;
          cursor = data.data.products.pageInfo.endCursor;
          
          console.log(`Fetched ${pageProducts.length} products, total: ${products.length}`);
        } else {
          hasNextPage = false;
        }
      } else {
        console.error('Failed to fetch products page:', response.status);
        hasNextPage = false;
      }
    }
  } catch (error) {
    console.error('Error in fetchAllProducts:', error);
  }
  
  console.log(`Total products fetched: ${products.length}`);
  return products;
}

/**
 * Fetch pricing for multiple products using existing pricing logic
 */
async function fetchPricingForProducts(products, customerId, shop, accessToken, customerMonitorId = null) {
  console.log(`🔄 Fetching pricing for ${products.length} products`);
  console.log(`🔑 Using customer Monitor ID: ${customerMonitorId}`);
  const priceData = [];
  let processedCount = 0;
  
  // Use provided customerMonitorId or fetch from Shopify metafields as fallback
  let finalCustomerMonitorId = customerMonitorId;
  if (!finalCustomerMonitorId) {
    console.log('No customer Monitor ID provided, trying to fetch from Shopify metafields...');
    finalCustomerMonitorId = await fetchCustomerMonitorId(customerId, shop, accessToken);
    console.log(`Fetched customer Monitor ID from metafields: ${finalCustomerMonitorId}`);
  }
  
  for (const product of products) {
    try {
      const isOutletProduct = product.tags?.includes('outlet') || false;
      console.log(`🔄 Processing product: ${product.title} (ID: ${product.id}), outlet: ${isOutletProduct}`);
      
      // Check if product has variants
      if (!product.variants?.edges || product.variants.edges.length === 0) {
        console.log(`Product ${product.id} has no variants, skipping...`);
        continue;
      }
      
      // Get pricing for each variant
      for (const variantEdge of product.variants?.edges || []) {
        const variant = variantEdge.node;
        const variantId = variant.id;
        const monitorId = variant.monitorIdMetafield?.value;
        const standardUnit = variant.standardUnitMetafield?.value || 'st';
        const width = variant.widthMetafield?.value || '';
        const depth = variant.depthMetafield?.value || '';
        const length = variant.lengthMetafield?.value || '';
        
        console.log(`Processing variant ${variant.id}: SKU=${variant.sku}, monitorId=${monitorId || 'MISSING'}, unit=${standardUnit}, dimensions=${width}x${depth}x${length}, isOutlet=${isOutletProduct}, customerMonitorId=${finalCustomerMonitorId}`);
        
        // Skip variants without Monitor IDs since they can't be priced
        if (!monitorId) {
          console.log(`Skipping variant ${variant.id} - no Monitor ID found`);
          // Still add to results but with a note that Monitor ID is missing
          priceData.push({
            productTitle: product.title,
            variantTitle: variant.title || 'Default',
            sku: variant.sku || '',
            originalPrice: parseFloat(variant.price) || 0,
            customerPrice: null,
            priceSource: "no-monitor-id",
            monitorId: '',
            standardUnit: standardUnit,
            width: width,
            depth: depth,
            length: length,
            formattedPrice: 'Pris saknas'
          });
          continue;
        }
        
        try {
          // Use existing pricing logic with timeout
          let price = null;
          let priceSource = "no-price";
          
          if (monitorId) {
            if (isOutletProduct) {
              console.log(`Getting outlet price for Monitor ID: ${monitorId}`);
              try {
                // Add timeout wrapper for outlet price
                const outletPrice = await Promise.race([
                  fetchOutletPrice(monitorId),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Outlet price fetch timeout')), 30000)
                  )
                ]);
                if (outletPrice !== null && outletPrice > 0) {
                  price = outletPrice;
                  priceSource = "outlet";
                  console.log(`Found outlet price: ${outletPrice}`);
                } else {
                  console.log(`No outlet price found for Monitor ID: ${monitorId}`);
                }
              } catch (outletError) {
                console.error(`Error fetching outlet price for ${monitorId}:`, outletError.message);
                priceSource = "outlet-error";
              }
            } else if (finalCustomerMonitorId) {
              console.log(`Getting customer-specific price for customer ${finalCustomerMonitorId}, part ${monitorId}`);
              try {
                // Add timeout wrapper for customer price
                const customerPrice = await Promise.race([
                  fetchCustomerPartPrice(finalCustomerMonitorId, monitorId),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Customer price fetch timeout')), 30000)
                  )
                ]);
                if (customerPrice !== null && customerPrice > 0) {
                  price = customerPrice;
                  priceSource = "customer-specific";
                  console.log(`Found customer-specific price: ${customerPrice}`);
                } else {
                  console.log(`No customer-specific price found for customer ${finalCustomerMonitorId}, part ${monitorId}`);
                }
              } catch (customerError) {
                console.error(`Error fetching customer price for ${finalCustomerMonitorId}, part ${monitorId}:`, customerError.message);
                priceSource = "customer-error";
              }
            } else {
              console.log(`No customer Monitor ID available for pricing lookup`);
            }
          } else {
            console.log(`No Monitor ID found for variant ${variant.id}`);
          }
          
          priceData.push({
            productTitle: product.title,
            variantTitle: variant.title || 'Default',
            sku: variant.sku || '',
            originalPrice: parseFloat(variant.price) || 0,
            customerPrice: price,
            priceSource: priceSource,
            monitorId: monitorId || '',
            standardUnit: standardUnit,
            width: width,
            depth: depth,
            length: length,
            formattedPrice: price ? formatPrice(price) : 'Ingen prissättning'
          });
        } catch (variantError) {
          console.error(`Error fetching pricing for variant ${variantId}:`, variantError);
          // Add product with original price as fallback
          priceData.push({
            productTitle: product.title,
            variantTitle: variant.title || 'Default',
            sku: variant.sku || '',
            originalPrice: parseFloat(variant.price) || 0,
            customerPrice: null,
            priceSource: "error",
            monitorId: '',
            standardUnit: standardUnit,
            width: width,
            depth: depth,
            length: length,
            formattedPrice: 'Prisfel'
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error processing product ${product.id}:`, error);
    }
    
    processedCount++;
    console.log(`📊 Progress: ${processedCount}/${products.length} products processed`);
  }
  
  console.log(`Generated pricing data for ${priceData.length} variants`);
  return priceData;
}

/**
 * Generate PDF from price data
 */
async function generatePDF(priceData, customerEmail, customerCompany) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 30, 
        layout: 'landscape',
        size: 'A4'
      });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Header
      doc.fontSize(20).text('Prislista', { align: 'center' });
      doc.fontSize(12).text(`Kund: ${customerCompany}`, { align: 'center' });
      doc.text(`Datum: ${new Date().toLocaleDateString('sv-SE')}`, { align: 'center' });
      doc.moveDown(2);
      
      // Table headers
      const tableTop = doc.y;
      doc.fontSize(9);
      
      // Define column positions for landscape layout with new columns
      const colPositions = {
        sku: 30,
        product: 110,
        variant: 210,
        width: 300,
        depth: 350,
        length: 400,
        price: 450,
        unit: 520
      };
      
      // Headers
      doc.font('Helvetica-Bold');
      doc.text('Artikelnr', colPositions.sku, tableTop);
      doc.text('Produkt', colPositions.product, tableTop);
      doc.text('Variant', colPositions.variant, tableTop);
      doc.text('Bredd', colPositions.width, tableTop);
      doc.text('Tjocklek', colPositions.depth, tableTop);
      doc.text('Längd', colPositions.length, tableTop);
      doc.text('Pris', colPositions.price, tableTop);
      doc.text('Enhet', colPositions.unit, tableTop);
      
      // Line under headers (extended for landscape)
      doc.moveTo(30, tableTop + 15).lineTo(580, tableTop + 15).stroke();
      
      let yPosition = tableTop + 25;
      doc.font('Helvetica');
      
      // Data rows
      for (const item of priceData) {
        // Check if we need a new page (landscape has more height)
        if (yPosition > 520) {
          doc.addPage();
          yPosition = 80;
        }
        
        doc.text(item.sku || '', colPositions.sku, yPosition, { width: 75 });
        doc.text(item.productTitle.substring(0, 20), colPositions.product, yPosition, { width: 95 });
        doc.text(item.variantTitle.substring(0, 18), colPositions.variant, yPosition, { width: 85 });
        doc.text(item.width || '', colPositions.width, yPosition, { width: 45 });
        doc.text(item.depth || '', colPositions.depth, yPosition, { width: 45 });
        doc.text(item.length || '', colPositions.length, yPosition, { width: 45 });
        doc.text(item.formattedPrice, colPositions.price, yPosition, { width: 65 });
        doc.text(item.standardUnit || 'st', colPositions.unit, yPosition);
        
        yPosition += 18;
      }
      
      // Footer (positioned for landscape layout)
      doc.fontSize(8).text(
        `Genererad: ${new Date().toLocaleString('sv-SE')} | Sidor: ${doc.bufferedPageRange().count}`,
        30,
        560,
        { align: 'center', width: 550 }
      );
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate CSV from price data
 */
function generateCSV(priceData) {
  // Define CSV headers
  const headers = [
    'Artikelnummer',
    'Produkt',
    'Variant', 
    'Bredd',
    'Tjocklek',
    'Längd',
    'Ursprungspris',
    'Kundpris',
    'Formaterat pris',
    'Enhet',
    'Pristyp',
    'Monitor ID'
  ];
  
  // Create CSV content
  const csvRows = [];
  
  // Add header row
  csvRows.push(headers.join(';'));
  
  // Add data rows
  for (const item of priceData) {
    const row = [
      escapeCSVField(item.sku || ''),
      escapeCSVField(item.productTitle),
      escapeCSVField(item.variantTitle),
      escapeCSVField(item.width || ''),
      escapeCSVField(item.depth || ''),
      escapeCSVField(item.length || ''),
      item.originalPrice || '',
      item.customerPrice || '',
      escapeCSVField(item.formattedPrice),
      escapeCSVField(item.standardUnit || 'st'),
      escapeCSVField(getPriceSourceLabel(item.priceSource)),
      escapeCSVField(item.monitorId || '')
    ];
    csvRows.push(row.join(';'));
  }
  
  return csvRows.join('\n');
}

/**
 * Escape CSV field content
 */
function escapeCSVField(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  // If field contains semicolon, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Import existing functions from pricing-public.js (we'll need to extract these into a shared module)
// For now, I'll include simplified versions here

/**
 * Monitor API login (updated to match working implementation)
 */
async function login() {
  try {
    // Validate environment variables
    if (!monitorUrl || !monitorUsername || !monitorPassword || !monitorCompany) {
      console.error('Missing Monitor API credentials:', {
        hasUrl: !!monitorUrl,
        hasUser: !!monitorUsername,
        hasPass: !!monitorPassword,
        hasCompany: !!monitorCompany
      });
      throw new Error('Missing Monitor API environment variables');
    }
    
    const url = `${monitorUrl}/${monitorCompany}/login`;
    console.log(`Attempting Monitor API login to: ${url} with user: ${monitorUsername}`);
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        Username: monitorUsername,
        Password: monitorPassword,
        ForceRelogin: true,  // Force fresh login
      }),
      agent: url.startsWith('https:') ? agent : undefined,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Monitor login failed: ${res.status} ${res.statusText}`);
      console.error(`Login error response: ${errorText}`);
      throw new Error(`Monitor login failed: ${res.status} - ${errorText}`);
    }

    // Get session ID from response header (like monitor.js), with fallback to body
    let sessionIdFromHeader = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
    const loginResponse = await res.json();
    
    // Try header first, then body (for compatibility)
    const receivedSessionId = sessionIdFromHeader || loginResponse.SessionId;
    
    if (!receivedSessionId) {
      console.error(`No SessionId in header or body. Headers: ${JSON.stringify([...res.headers])}, Body:`, loginResponse);
      throw new Error('No SessionId received from Monitor API');
    }
    
    console.log(`Monitor API login successful, SessionId: ${receivedSessionId.substring(0, 8)}...`);
    console.log(`SessionId source: ${sessionIdFromHeader ? 'header' : 'body'}`);
    sessionId = receivedSessionId;
    return sessionId;
  } catch (error) {
    console.error("Monitor API login error:", error);
    sessionId = null; // Clear any stale session
    throw error;
  }
}

/**
 * Get or refresh session ID (updated to match working implementation)
 */
async function getSessionId() {
  if (!sessionId) {
    sessionId = await login();
  }
  return sessionId;
}

/**
 * Fetch outlet price (updated to match working implementation)
 */
async function fetchOutletPrice(partId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '${OUTLET_PRICE_LIST_ID}'`;
    
    console.log(`Fetching outlet price for part ${partId} from price list ${OUTLET_PRICE_LIST_ID}`);
    console.log(`API URL: ${url}`);
    console.log(`Using session: ${session?.substring(0, 8)}...`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent: url.startsWith('https:') ? agent : undefined,
    });
    
    console.log(`Initial response status: ${res.status}`);
    
    if (res.status === 401) {
      console.log(`Session expired, but let's see the error first...`);
      const errorText = await res.text();
      console.log(`401 Error response: ${errorText}`);
      
      // Session expired, force re-login and retry ONCE
      console.log(`Forcing fresh login...`);
      sessionId = null; // Clear the session
      try {
        session = await login(); // Force fresh login
        console.log(`Re-login successful, new session: ${session?.substring(0, 8)}...`);
        
        res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Monitor-SessionId": session,
          },
          agent: url.startsWith('https:') ? agent : undefined,
        });
        
        console.log(`Retry response status: ${res.status}`);
      } catch (loginError) {
        console.error(`Re-login failed:`, loginError);
        return null;
      }
    }
    
    if (res.status !== 200) {
      console.error(`Failed to fetch outlet price for ${partId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Final error response: ${errorText}`);
      return null;
    }
    
    const prices = await res.json();
    console.log(`Outlet price API response for ${partId}:`, Array.isArray(prices) ? `Array with ${prices.length} items` : prices);
    
    if (!Array.isArray(prices)) {
      console.log(`Outlet price response is not an array for ${partId}`);
      return null;
    }
    
    if (prices.length > 0) {
      console.log(`Found outlet price for ${partId}: ${prices[0].Price}`);
      return prices[0].Price;
    } else {
      console.log(`No outlet prices found for ${partId} in price list ${OUTLET_PRICE_LIST_ID}`);
      
      // DEBUG: Let's check what price lists exist for this part
      console.log(`DEBUG: Checking if part ${partId} exists in other price lists...`);
      try {
        const allPricesUrl = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices?$filter=PartId eq '${partId}'&$top=5`;
        const allPricesRes = await fetch(allPricesUrl, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Monitor-SessionId": session,
          },
          agent: url.startsWith('https:') ? agent : undefined,
        });
        
        if (allPricesRes.ok) {
          const allPrices = await allPricesRes.json();
          console.log(`DEBUG: Found ${allPrices.length} price(s) for part ${partId} in any price list:`);
          allPrices.forEach((price, index) => {
            console.log(`  ${index + 1}. Price: ${price.Price}, PriceList: ${price.PriceListId}, Currency: ${price.CurrencyCode}`);
          });
        } else {
          console.log(`DEBUG: Failed to check all prices for ${partId}: ${allPricesRes.status}`);
        }
      } catch (debugError) {
        console.log(`DEBUG: Error checking all prices:`, debugError.message);
      }
      
      return null;
    }
  } catch (error) {
    console.error("Error fetching outlet price:", error);
    return null;
  }
}

/**
 * Fetch customer part price (using working logic from pricing-public.js)
 */
async function fetchCustomerPartPrice(customerId, partId) {
  try {
    // Step 1: Check for specific customer-part price using CustomerPartLinks
    const session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartLinks`;
    url += `?$filter=CustomerId eq '${customerId}' and PartId eq '${partId}'`;
    
    console.log(`Step 1: Checking for specific customer-part price for customer ${customerId}, part ${partId}`);
    
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent: url.startsWith('https:') ? agent : undefined,
    });

    if (res.status === 401) {
      console.log(`Session expired for customer part links fetch, re-logging in...`);
      sessionId = null;
      const newSession = await login();
      const retryRes = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSession,
        },
        agent: url.startsWith('https:') ? agent : undefined,
      });
      
      if (retryRes.status === 200) {
        const retryData = await retryRes.json();
        console.log(`Customer part links API response for customer ${customerId}, part ${partId}:`, retryData);
        if (Array.isArray(retryData) && retryData.length > 0) {
          const specificPrice = retryData[0].Price;
          console.log(`Step 1 SUCCESS: Found specific customer-part price: ${specificPrice}`);
          return specificPrice;
        }
      } else {
        console.error(`Failed to fetch customer part links after retry for customer ${customerId}, part ${partId}: ${retryRes.status}`);
        const errorText = await retryRes.text();
        console.error(`Error response: ${errorText}`);
      }
    } else if (res.status === 200) {
      const data = await res.json();
      console.log(`Customer part links API response for customer ${customerId}, part ${partId}:`, data);
      if (Array.isArray(data) && data.length > 0) {
        const specificPrice = data[0].Price;
        console.log(`Step 1 SUCCESS: Found specific customer-part price: ${specificPrice}`);
        return specificPrice;
      } else {
        console.log(`Step 1: No specific customer-part price found, proceeding to customer's price list...`);
      }
    } else {
      console.error(`Failed to fetch customer part links for customer ${customerId}, part ${partId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
    }
    
    // Step 2: Fallback to customer's price list
    console.log(`Step 2: Getting customer's price list ID...`);
    const priceListId = await fetchCustomerPriceListId(customerId);
    if (!priceListId) {
      console.log(`Step 2 FAILED: Could not get customer's price list ID`);
      return null;
    }
    
    console.log(`Step 2: Customer's price list ID: ${priceListId}`);
    const priceListPrice = await fetchPriceFromPriceList(partId, priceListId);
    if (priceListPrice) {
      console.log(`Step 2 SUCCESS: Found price in customer's price list: ${priceListPrice}`);
      return priceListPrice;
    } else {
      console.log(`Step 2: No price found in customer's price list`);
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching customer part price:", error);
    return null;
  }
}

/**
 * Fetch customer price list ID (updated to match working implementation)
 */
async function fetchCustomerPriceListId(customerId) {
  try {
    let session = await getSessionId();
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers?$filter=Id eq '${customerId}'`;
    
    console.log(`Fetching customer details for customer ${customerId} to get price list ID`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent: url.startsWith('https:') ? agent : undefined,
    });

    if (res.status === 401) {
      // Session expired, force re-login and retry
      console.log(`Session expired while fetching customer, re-logging in...`);
      sessionId = null; // Clear the session
      session = await login();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": session,
        },
        agent: url.startsWith('https:') ? agent : undefined,
      });
    }

    if (res.status !== 200) {
      console.error(`Failed to fetch customer ${customerId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return null;
    }
    
    const customers = await res.json();
    console.log(`Customer lookup API response for ${customerId}:`, customers);
    
    if (!Array.isArray(customers)) {
      console.log(`Customer response is not an array`);
      return null;
    }
    
    if (customers.length > 0) {
      const priceListId = customers[0].PriceListId;
      console.log(`Found customer's price list ID: ${priceListId}`);
      return priceListId;
    } else {
      console.log(`No customer found with ID ${customerId}`);
      return null;
    }
  } catch (error) {
    console.error("Error fetching customer price list ID:", error);
    return null;
  }
}

/**
 * Fetch price from price list (updated to match working implementation)
 */
async function fetchPriceFromPriceList(partId, priceListId) {
  try {
    let session = await getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '${priceListId}'`;
    
    console.log(`Fetching price for part ${partId} from price list ${priceListId}`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": session,
      },
      agent: url.startsWith('https:') ? agent : undefined,
    });
    
    if (res.status === 401) {
      // Session expired, force re-login and retry
      console.log(`Session expired for price list fetch, re-logging in...`);
      sessionId = null; // Clear the session
      session = await login();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": session,
        },
        agent: url.startsWith('https:') ? agent : undefined,
      });
    }
    
    if (res.status !== 200) {
      console.error(`Failed to fetch price for part ${partId} from price list ${priceListId}: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`Error response: ${errorText}`);
      return null;
    }
    
    const prices = await res.json();
    console.log(`Price list API response for part ${partId}, price list ${priceListId}:`, prices);
    
    if (!Array.isArray(prices)) {
      console.log(`Price list response is not an array`);
      return null;
    }
    
    if (prices.length > 0) {
      console.log(`Found price in price list: ${prices[0].Price}`);
      return prices[0].Price;
    } else {
      console.log(`No price found for part ${partId} in price list ${priceListId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching price from price list for part ${partId}, price list ${priceListId}:`, error);
    return null;
  }
}

/**
 * Fetch customer Monitor ID from Shopify metafields
 */
async function fetchCustomerMonitorId(customerId, shop, accessToken) {
  try {
    const query = `
      query GetCustomerMonitorId($id: ID!) {
        customer(id: $id) {
          id
          metafield(namespace: "custom", key: "monitor_id") {
            value
          }
        }
      }
    `;

    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables: { id: customerId } })
    });

    if (response.ok) {
      const data = await response.json();
      return data.data?.customer?.metafield?.value || null;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching customer Monitor ID:", error);
    return null;
  }
}

/**
 * Format price for display
 */
function formatPrice(price) {
  if (price === null || price === undefined) return 'Ingen prissättning';
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: 2
  }).format(price);
}

/**
 * Get human-readable price source label
 */
function getPriceSourceLabel(priceSource) {
  switch (priceSource) {
    case 'outlet': return 'Outlet';
    case 'customer-specific': return 'Kundspecifik';
    case 'no-price': return 'Ingen prissättning';
    case 'error': return 'Fel';
    default: return 'Okänd';
  }
}