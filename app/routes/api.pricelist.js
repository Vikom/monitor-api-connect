import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server.js";
import PDFDocument from "pdfkit";
import { Parser as Json2csvParser } from "json2csv";

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

// Handle OPTIONS request for CORS
export async function options() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

export async function action({ request }) {
  const method = request.method;

  if (method === "OPTIONS") {
    return options();
  }

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

    console.log('=== PRICELIST REQUEST DEBUG ===');
    console.log('Customer ID:', customer_id);
    console.log('Customer Email:', customer_email);
    console.log('Selection method:', selection_method);
    console.log('Format:', format);
    console.log('Collections:', collections);
    console.log('Products:', products);
    console.log('Shop:', shop);
    console.log('=== END PRICELIST REQUEST DEBUG ===');

    // Get shop domain from request or headers
    const shopDomain = shop || request.headers.get('X-Shopify-Shop-Domain') || request.headers.get('host');
    
    // Fetch products based on selection method
    let productList = [];
    
    switch (selection_method) {
      case 'collections':
        productList = await fetchProductsByCollections(collections, shopDomain);
        break;
      case 'products':
        productList = await fetchProductsByIds(products, shopDomain);
        break;
      case 'all':
        productList = await fetchAllProducts(shopDomain);
        break;
      default:
        return json({ error: 'Invalid selection method' }, { 
          status: 400,
          headers: corsHeaders()
        });
    }

    console.log(`Found ${productList.length} products to process`);

    // Get pricing for all products
    const priceData = await fetchPricingForProducts(productList, customer_id, shopDomain);

    console.log(`Generated pricing data for ${priceData.length} items`);

    // Generate file based on format
    if (format === 'pdf') {
      const pdfBuffer = await generatePDF(priceData, customer_email);
      
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
 */
async function fetchProductsByCollections(collectionIds, shopDomain) {
  console.log(`Fetching products from ${collectionIds.length} collections`);
  const products = [];
  
  try {
    // Get session for the shop
    const session = await getShopifySession(shopDomain);
    if (!session) {
      console.error('No Shopify session found for shop:', shopDomain);
      return [];
    }

    for (const collectionId of collectionIds) {
      try {
        console.log(`Fetching products from collection ${collectionId}`);
        
        // Use GraphQL to fetch products from collection
        const query = `
          query GetCollectionProducts($id: ID!) {
            collection(id: "gid://shopify/Collection/${collectionId}") {
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
                          metafield(namespace: "monitor", key: "id") {
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

        const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': session.accessToken,
          },
          body: JSON.stringify({ query, variables: { id: collectionId } })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data?.collection?.products?.edges) {
            const collectionProducts = data.data.collection.products.edges.map(edge => edge.node);
            products.push(...collectionProducts);
            console.log(`Added ${collectionProducts.length} products from collection ${collectionId}`);
          }
        } else {
          console.error(`Failed to fetch products from collection ${collectionId}:`, response.status);
        }
      } catch (error) {
        console.error(`Error fetching products from collection ${collectionId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in fetchProductsByCollections:', error);
  }
  
  console.log(`Total products fetched: ${products.length}`);
  return products;
}

/**
 * Fetch products by product IDs using Shopify API
 */
async function fetchProductsByIds(productIds, shopDomain) {
  console.log(`Fetching ${productIds.length} specific products`);
  const products = [];
  
  try {
    // Get session for the shop
    const session = await getShopifySession(shopDomain);
    if (!session) {
      console.error('No Shopify session found for shop:', shopDomain);
      return [];
    }

    // Batch fetch products (GraphQL allows up to 250 products in one query)
    const batchSize = 100;
    for (let i = 0; i < productIds.length; i += batchSize) {
      const batch = productIds.slice(i, i + batchSize);
      const gids = batch.map(id => `gid://shopify/Product/${id}`);
      
      const query = `
        query GetProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
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
                    metafield(namespace: "monitor", key: "id") {
                      value
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken,
        },
        body: JSON.stringify({ query, variables: { ids: gids } })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data?.nodes) {
          products.push(...data.data.nodes.filter(node => node)); // Filter out null nodes
        }
      } else {
        console.error(`Failed to fetch product batch:`, response.status);
      }
    }
  } catch (error) {
    console.error('Error in fetchProductsByIds:', error);
  }
  
  console.log(`Total products fetched: ${products.length}`);
  return products;
}

/**
 * Fetch all products using Shopify API
 */
async function fetchAllProducts(shopDomain) {
  console.log('Fetching all products');
  const products = [];
  
  try {
    // Get session for the shop
    const session = await getShopifySession(shopDomain);
    if (!session) {
      console.error('No Shopify session found for shop:', shopDomain);
      return [];
    }

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
                      metafield(namespace: "monitor", key: "id") {
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

      const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken,
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
 * Get Shopify session for the given shop domain
 */
async function getShopifySession(shopDomain) {
  try {
    // Try to find an active session for this shop
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    if (sessions && sessions.length > 0) {
      // Get the most recent session
      const session = sessions[sessions.length - 1];
      if (session && session.accessToken) {
        return session;
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting Shopify session:', error);
    return null;
  }
}

/**
 * Fetch pricing for multiple products using existing pricing logic
 */
async function fetchPricingForProducts(products, customerId, shopDomain) {
  console.log(`Fetching pricing for ${products.length} products`);
  const priceData = [];
  
  // Get customer's Monitor ID
  const customerMonitorId = await fetchCustomerMonitorId(customerId, shopDomain);
  
  for (const product of products) {
    try {
      const isOutletProduct = product.tags?.includes('outlet') || false;
      
      // Get pricing for each variant
      for (const variantEdge of product.variants?.edges || []) {
        const variant = variantEdge.node;
        const variantId = variant.id;
        const monitorId = variant.metafield?.value;
        
        try {
          // Use existing pricing logic
          let price = null;
          let priceSource = "no-price";
          
          if (monitorId) {
            if (isOutletProduct) {
              // Get outlet price
              const outletPrice = await fetchOutletPrice(monitorId);
              if (outletPrice !== null && outletPrice > 0) {
                price = outletPrice;
                priceSource = "outlet";
              }
            } else if (customerMonitorId) {
              // Get customer-specific price
              const customerPrice = await fetchCustomerPartPrice(customerMonitorId, monitorId);
              if (customerPrice !== null && customerPrice > 0) {
                price = customerPrice;
                priceSource = "customer-specific";
              }
            }
          }
          
          priceData.push({
            productTitle: product.title,
            variantTitle: variant.title || 'Default',
            sku: variant.sku || '',
            originalPrice: parseFloat(variant.price) || 0,
            customerPrice: price,
            priceSource: priceSource,
            availability: (variant.inventoryQuantity > 0) ? 'I lager' : 'Ej i lager',
            inventoryQuantity: variant.inventoryQuantity || 0,
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
            availability: (variant.inventoryQuantity > 0) ? 'I lager' : 'Ej i lager',
            inventoryQuantity: variant.inventoryQuantity || 0,
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
async function generatePDF(priceData, customerEmail) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Header
      doc.fontSize(20).text('Prislista', { align: 'center' });
      doc.fontSize(12).text(`Kund: ${customerEmail}`, { align: 'center' });
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
        availability: 320,
        price: 400,
        source: 480
      };
      
      // Headers
      doc.font('Helvetica-Bold');
      doc.text('Produkt', colPositions.product, tableTop);
      doc.text('Variant', colPositions.variant, tableTop);
      doc.text('Artikelnr', colPositions.sku, tableTop);
      doc.text('Status', colPositions.availability, tableTop);
      doc.text('Pris', colPositions.price, tableTop);
      doc.text('Typ', colPositions.source, tableTop);
      
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
        doc.text(item.availability, colPositions.availability, yPosition);
        doc.text(item.formattedPrice, colPositions.price, yPosition);
        doc.text(getPriceSourceLabel(item.priceSource), colPositions.source, yPosition);
        
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
  const fields = [
    { label: 'Produkt', value: 'productTitle' },
    { label: 'Variant', value: 'variantTitle' },
    { label: 'Artikelnummer', value: 'sku' },
    { label: 'Ursprungspris', value: 'originalPrice' },
    { label: 'Kundpris', value: 'customerPrice' },
    { label: 'Formaterat pris', value: 'formattedPrice' },
    { label: 'Pristyp', value: (row) => getPriceSourceLabel(row.priceSource) },
    { label: 'Tillgänglighet', value: 'availability' },
    { label: 'Lagersaldo', value: 'inventoryQuantity' },
    { label: 'Monitor ID', value: 'monitorId' }
  ];
  
  const json2csvParser = new Json2csvParser({ fields, delimiter: ';' });
  return json2csvParser.parse(priceData);
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
async function fetchCustomerMonitorId(customerId, shopDomain) {
  try {
    const session = await getShopifySession(shopDomain);
    if (!session) {
      return null;
    }

    const query = `
      query GetCustomerMonitorId($id: ID!) {
        customer(id: "${customerId}") {
          id
          metafield(namespace: "monitor", key: "id") {
            value
          }
        }
      }
    `;

    const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({ query })
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