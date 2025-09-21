import { json } from "@remix-run/node";
import PDFDocument from "pdfkit";

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

    // Get pricing for all products
    const priceData = await fetchPricingForProducts(productList, customer_id, shop, accessToken, monitor_id);

    console.log(`Generated pricing data for ${priceData.length} items`);

    // Generate file based on format
    if (format === 'pdf') {
      const pdfBuffer = await generatePDF(priceData, customer_email, customer_company);
      
      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="price-list-${Date.now()}.pdf"`,
          ...corsHeaders()
        }
      });
    } else if (format === 'csv') {
      const csvData = generateCSV(priceData);
      
      return new Response(csvData, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="price-list-${Date.now()}.csv"`,
          ...corsHeaders()
        }
      });
    } else {
      return json({ error: 'Invalid format. Use "pdf" or "csv"' }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

  } catch (error) {
    console.error('Error generating price list:', error);
    return json({ error: 'Failed to generate price list', details: error.message }, { 
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
                          metafield(namespace: "custom", key: "monitor_id") {
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
          console.log(`GraphQL response for collection ${collectionId}:`, JSON.stringify(data, null, 2));
          
          if (data.data?.collection?.products?.edges) {
            const collectionProducts = data.data.collection.products.edges.map(edge => {
              const product = edge.node;
              console.log(`Product ${product.id} (${product.title}) has ${product.variants?.edges?.length || 0} variants`);
              
              // Log variant details
              if (product.variants?.edges) {
                product.variants.edges.forEach((variantEdge, index) => {
                  const variant = variantEdge.node;
                  console.log(`  Variant ${index + 1}: ID=${variant.id}, SKU=${variant.sku}, MonitorID=${variant.metafield?.value || 'NONE'}`);
                });
              }
              
              // If we have a collection Monitor ID, we could potentially use it for optimization
              // For now, we still fetch individual variant Monitor IDs as before
              return product;
            });
            products.push(...collectionProducts);
            console.log(`Added ${collectionProducts.length} products from collection ${collectionId}`);
          } else {
            console.log(`No products found in collection ${collectionId} - data structure:`, data);
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
                    metafield(namespace: "custom", key: "monitor_id") {
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
          console.log(`GraphQL response for product ${productId}:`, JSON.stringify(data, null, 2));
          
          if (data.data?.product) {
            const fetchedProduct = data.data.product;
            console.log(`Product ${fetchedProduct.id} (${fetchedProduct.title}) has ${fetchedProduct.variants?.edges?.length || 0} variants`);
            
            // Log variant details
            if (fetchedProduct.variants?.edges) {
              fetchedProduct.variants.edges.forEach((variantEdge, index) => {
                const variant = variantEdge.node;
                console.log(`  Variant ${index + 1}: ID=${variant.id}, SKU=${variant.sku}, MonitorID=${variant.metafield?.value || 'NONE'}`);
              });
            }
            
            // If we have a product Monitor ID from the frontend, we could use it for optimization
            // For now, we still fetch individual variant Monitor IDs as before
            fetchedProducts.push(fetchedProduct);
            console.log(`Fetched product: ${fetchedProduct.title}`);
          } else {
            console.log(`No product found for ${productId} - data structure:`, data);
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
                      metafield(namespace: "custom", key: "monitor_id") {
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
  console.log(`Fetching pricing for ${products.length} products`);
  console.log(`Using customer Monitor ID: ${customerMonitorId}`);
  const priceData = [];
  
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
      console.log(`Processing product: ${product.title} (ID: ${product.id}), outlet: ${isOutletProduct}`);
      
      // Check if product has variants
      if (!product.variants?.edges || product.variants.edges.length === 0) {
        console.log(`Product ${product.id} has no variants, skipping...`);
        continue;
      }
      
      // Get pricing for each variant
      for (const variantEdge of product.variants?.edges || []) {
        const variant = variantEdge.node;
        const variantId = variant.id;
        const monitorId = variant.metafield?.value;
        
        console.log(`Processing variant ${variant.id}: SKU=${variant.sku}, monitorId=${monitorId || 'MISSING'}, isOutlet=${isOutletProduct}, customerMonitorId=${finalCustomerMonitorId}`);
        
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
            formattedPrice: 'Saknar Monitor ID'
          });
          continue;
        }
        
        try {
          // Use existing pricing logic
          let price = null;
          let priceSource = "no-price";
          
          if (monitorId) {
            if (isOutletProduct) {
              console.log(`Getting outlet price for Monitor ID: ${monitorId}`);
              // Get outlet price
              const outletPrice = await fetchOutletPrice(monitorId);
              if (outletPrice !== null && outletPrice > 0) {
                price = outletPrice;
                priceSource = "outlet";
                console.log(`Found outlet price: ${outletPrice}`);
              } else {
                console.log(`No outlet price found for Monitor ID: ${monitorId}`);
              }
            } else if (finalCustomerMonitorId) {
              console.log(`Getting customer-specific price for customer ${finalCustomerMonitorId}, part ${monitorId}`);
              // Get customer-specific price
              const customerPrice = await fetchCustomerPartPrice(finalCustomerMonitorId, monitorId);
              if (customerPrice !== null && customerPrice > 0) {
                price = customerPrice;
                priceSource = "customer-specific";
                console.log(`Found customer-specific price: ${customerPrice}`);
              } else {
                console.log(`No customer-specific price found for customer ${finalCustomerMonitorId}, part ${monitorId}`);
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
            formattedPrice: 'Prisfel'
          });
        }
      }
    } catch (error) {
      console.error(`Error processing product ${product.id}:`, error);
    }
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
      const doc = new PDFDocument({ margin: 50 });
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
      doc.fontSize(10);
      
      // Define column positions
      const colPositions = {
        product: 50,
        variant: 150,
        sku: 250,
        price: 350,
        source: 450
      };
      
      // Headers
      doc.font('Helvetica-Bold');
      doc.text('Produkt', colPositions.product, tableTop);
      doc.text('Variant', colPositions.variant, tableTop);
      doc.text('Artikelnr', colPositions.sku, tableTop);
      doc.text('Pris', colPositions.price, tableTop);
      doc.text('Enhet', colPositions.source, tableTop);
      
      // Line under headers
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      
      let yPosition = tableTop + 25;
      doc.font('Helvetica');
      
      // Data rows
      for (const item of priceData) {
        // Check if we need a new page
        if (yPosition > 700) {
          doc.addPage();
          yPosition = 50;
        }
        
        doc.text(item.productTitle.substring(0, 25), colPositions.product, yPosition, { width: 90 });
        doc.text(item.variantTitle.substring(0, 20), colPositions.variant, yPosition, { width: 90 });
        doc.text(item.sku || '', colPositions.sku, yPosition);
        doc.text(item.formattedPrice, colPositions.price, yPosition);
        // doc.text(item.priceSource, colPositions.source, yPosition);
        doc.text('st', colPositions.source, yPosition);
        
        yPosition += 20;
      }
      
      // Footer
      doc.fontSize(8).text(
        `Genererad: ${new Date().toLocaleString('sv-SE')} | Sidor: ${doc.bufferedPageRange().count}`,
        50,
        750,
        { align: 'center' }
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
    'Produkt',
    'Variant', 
    'Artikelnummer',
    'Ursprungspris',
    'Kundpris',
    'Formaterat pris',
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
      escapeCSVField(item.productTitle),
      escapeCSVField(item.variantTitle),
      escapeCSVField(item.sku || ''),
      item.originalPrice || '',
      item.customerPrice || '',
      escapeCSVField(item.formattedPrice),
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
 * Monitor API login (simplified version)
 */
async function login() {
  try {
    if (!monitorUrl || !monitorUsername || !monitorPassword || !monitorCompany) {
      throw new Error('Missing Monitor API environment variables');
    }
    
    const url = `${monitorUrl}/${monitorCompany}/login`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Username: monitorUsername,
        Password: monitorPassword,
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Login failed: ${res.status} ${res.statusText}`);
    }

    const loginResponse = await res.json();
    return loginResponse.SessionId;
  } catch (error) {
    console.error("Monitor API login error:", error);
    throw error;
  }
}

/**
 * Get session ID (simplified version)
 */
async function getSessionId() {
  if (!sessionId) {
    sessionId = await login();
  }
  return sessionId;
}

/**
 * Fetch outlet price (simplified version)
 */
async function fetchOutletPrice(partId) {
  try {
    const session = await getSessionId();
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/PriceListRows?$filter=PriceListId eq '${OUTLET_PRICE_LIST_ID}' and PartId eq '${partId}'`;
    
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": session,
      },
    });

    if (res.status === 401) {
      sessionId = null;
      const newSession = await login();
      const retryRes = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Monitor-SessionId": newSession,
        },
      });
      
      if (retryRes.status === 200) {
        const data = await retryRes.json();
        return data.length > 0 ? data[0].Price : null;
      }
    } else if (res.status === 200) {
      const data = await res.json();
      return data.length > 0 ? data[0].Price : null;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching outlet price:", error);
    return null;
  }
}

/**
 * Fetch customer part price (simplified version)
 */
async function fetchCustomerPartPrice(customerId, partId) {
  try {
    const session = await getSessionId();
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartLinks?$filter=CustomerId eq '${customerId}' and PartId eq '${partId}'`;
    
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": session,
      },
    });

    if (res.status === 401) {
      sessionId = null;
      const newSession = await login();
      const retryRes = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Monitor-SessionId": newSession,
        },
      });
      
      if (retryRes.status === 200) {
        const data = await retryRes.json();
        if (data.length > 0) {
          return data[0].Price;
        }
      }
    } else if (res.status === 200) {
      const data = await res.json();
      if (data.length > 0) {
        return data[0].Price;
      }
    }
    
    // Fallback to price list
    const priceListId = await fetchCustomerPriceListId(customerId);
    if (priceListId) {
      return await fetchPriceFromPriceList(partId, priceListId);
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching customer part price:", error);
    return null;
  }
}

/**
 * Fetch customer price list ID (simplified version)
 */
async function fetchCustomerPriceListId(customerId) {
  try {
    const session = await getSessionId();
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers?$filter=Id eq '${customerId}'`;
    
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": session,
      },
    });

    if (res.status === 200) {
      const customers = await res.json();
      return customers.length > 0 ? customers[0].PriceListId : null;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching customer price list ID:", error);
    return null;
  }
}

/**
 * Fetch price from price list (simplified version)
 */
async function fetchPriceFromPriceList(partId, priceListId) {
  try {
    const session = await getSessionId();
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/PriceListRows?$filter=PriceListId eq '${priceListId}' and PartId eq '${partId}'`;
    
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": session,
      },
    });

    if (res.status === 200) {
      const priceListRows = await res.json();
      return priceListRows.length > 0 ? priceListRows[0].Price : null;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching price from price list:", error);
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