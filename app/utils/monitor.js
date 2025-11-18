// app/utils/monitor.js

import prisma from "../db.server.js";
import fetch from "node-fetch";
import https from "https";

// Global array to track failed ARTFSC fetches
export const failedARTFSCFetches = [];

// Function to clear failed ARTFSC fetches (call at start of sync)
export function clearFailedARTFSCFetches() {
  failedARTFSCFetches.length = 0;
}

// Function to report failed ARTFSC fetches (call at end of sync)
export function reportFailedARTFSCFetches() {
  if (failedARTFSCFetches.length === 0) {
    console.log("✅ All ARTFSC fetches completed successfully");
    return;
  }
  
  failedARTFSCFetches.forEach((failure, index) => {
    console.log(`      ${index + 1}. Product ID: ${failure.productId}`);
    console.log(`         Error: ${failure.error}`);
    console.log(`         Time: ${failure.timestamp}`);
  });
  
}

const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

// @TODO
// The SSL certificate used by the server is self-signed so it is important to add an exception for it in integration.

const agent = new https.Agent({ rejectUnauthorized: false });

class MonitorClient {
  constructor() {
    this.sessionId = null;
  }

  async getSessionId() {
    if (this.sessionId) return this.sessionId;
    const session = await prisma.monitorSession.findUnique({ where: { id: 1 } });
    if (session && session.sessionId) {
      this.sessionId = session.sessionId;
      return this.sessionId;
    }
    return this.login();
  }

  async saveSessionId(sessionId) {
    this.sessionId = sessionId;
    await prisma.monitorSession.upsert({
      where: { id: 1 },
      update: { sessionId },
      create: { id: 1, sessionId },
    });
  }

  async login() {
    const url = `${monitorUrl}/${monitorCompany}/login`;
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
        ForceRelogin: true,
      }),
      agent,
    });
    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`Monitor API login failed. Status: ${res.status}, Body: ${errorBody}`);
      throw new Error("Monitor API login failed");
    }
    // Get session ID from response header, not body
    const sessionId = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
    const data = await res.json();
    if (!sessionId) {
      console.error(`No session ID header returned from Monitor API. Response headers: ${JSON.stringify([...res.headers])}, body: ${JSON.stringify(data)}`);
      throw new Error("No session ID header returned from Monitor API");
    }
    if (data.MfaToken) {
      console.error(`MFA required but not handled. MfaToken: ${data.MfaToken}`);
      throw new Error("Monitor API login requires MFA, which is not implemented");
    }
    await this.saveSessionId(sessionId);
    return sessionId;
  }

  async fetchProducts() {
    const sessionId = await this.getSessionId();
    let allProducts = [];
    let skip = 0;
    const pageSize = 100;
    let keepFetching = true;
    while (keepFetching) {
      let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts`;
      url += `?$top=${pageSize}`;
      url += `&$skip=${skip}`;
      url += '&$select=Id,PartNumber,Description,ExtraFields,PartCodeId,StandardPrice,PartCode,ProductGroupId,Status,WeightPerUnit,VolumePerUnit,IsFixedWeight,Gs1Code,Status,QuantityPerPackage,StandardUnitId,PurchaseQuantityPerPackage';
      url += '&$filter=BlockedStatus Neq 2 and Status Le 6 and Status Ge 4';
      url += '&$expand=ExtraFields,ProductGroup,PartCode';
      let res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": sessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const errorBody = await res.text();
        console.error(`Monitor API fetchProducts first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
        // Try to re-login and retry once
        await this.login();
        const newSessionId = await this.getSessionId();
        res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Monitor-SessionId": newSessionId,
          },
          agent,
        });
        if (res.status !== 200) {
          const retryErrorBody = await res.text();
          console.error(`Monitor API fetchProducts retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
          throw new Error("Monitor API fetchProducts failed after re-login");
        }
      }
      const products = await res.json();
      if (!Array.isArray(products)) {
        throw new Error("Monitor API returned unexpected data format");
      }
      allProducts = allProducts.concat(products);
      if (products.length < pageSize) {
        keepFetching = false;
      } else {
        skip += pageSize;
      }
    }
    // Only return products with ARTWEBAKTIV.SelectedOptionId === "1062902127922128278"
    return allProducts.filter(product => {
      if (!Array.isArray(product.ExtraFields)) return false;
      const active = product.ExtraFields.find(f => f.Identifier === "ARTWEBAKTIV");
      const productName = product.ExtraFields.find(f => f.Identifier === "ARTWEBNAME");
      const productVariation = product.ExtraFields.find(f => f.Identifier === "ARTWEBVAR");
      if (productName) console.log(`Product ${product.PartNumber}: ${productName.StringValue}, Variant: ${productVariation ? productVariation.StringValue : "N/A"}`);
      return active && active.SelectedOptionId === "1062902127922128278";
    });
  }

  /**
   * Fetch specific products by their IDs
   * @param {Array<string>} productIds - Array of product IDs to fetch
   * @returns {Promise<Array>} Array of products
   */
  async fetchProductsByIds(productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return [];
    }

    const sessionId = await this.getSessionId();
    console.log(`Fetching ${productIds.length} specific products by ID...`);

    const idFilter = productIds.map(id => `Id eq '${id}'`).join(' or ');
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts`;
    url += '?$select=Id,PartNumber,Description,ExtraFields,PartCodeId,StandardPrice,PartCode,ProductGroupId,Status,WeightPerUnit,VolumePerUnit,IsFixedWeight,Gs1Code,Status,QuantityPerPackage,StandardUnitId,PurchaseQuantityPerPackage';
    // url += `&$filter=(${idFilter}) and Status eq 4`;
    url += `&$filter=(${idFilter}) and Status Le 6 and Status Ge 4`;
    url += '&$expand=ExtraFields,ProductGroup,PartCode';
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchProductsByIds first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await this.login();
      const newSessionId = await this.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchProductsByIds retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchProductsByIds failed after re-login");
      }
    }
    
    const products = await res.json();
    if (!Array.isArray(products)) {
      throw new Error("Monitor API returned unexpected data format");
    }
    
    console.log(`Successfully fetched ${products.length} products by ID`);
    
    // Only return products with ARTWEBAKTIV.SelectedOptionId === "1062902127922128278"
    return products.filter(product => {
      if (!Array.isArray(product.ExtraFields)) return false;
      const active = product.ExtraFields.find(f => f.Identifier === "ARTWEBAKTIV");
      const productName = product.ExtraFields.find(f => f.Identifier === "ARTWEBNAME");
      const productVariation = product.ExtraFields.find(f => f.Identifier === "ARTWEBVAR");
      if (productName) console.log(`Product ${product.PartNumber}: ${productName.StringValue}, Variant: ${productVariation ? productVariation.StringValue : "N/A"}`);
      return active && active.SelectedOptionId === "1062902127922128278";
    });
  }

  /**
   * Fetch a single product by PartNumber with same filtering as fetchProducts()
   * @param {string} partNumber - The part number to fetch
   * @returns {Promise<Object|null>} The product data or null if not found
   */
  async fetchSingleProductByPartNumber(partNumber) {
    const sessionId = await this.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts`;
    url += `?$filter=PartNumber eq '${partNumber}' and BlockedStatus Neq 2 and Status Le 6 and Status Ge 4`;
    url += '&$select=Id,PartNumber,Description,ExtraFields,PartCodeId,StandardPrice,PartCode,ProductGroupId,Status,WeightPerUnit,VolumePerUnit,IsFixedWeight,Gs1Code,Status,QuantityPerPackage,StandardUnitId,PurchaseQuantityPerPackage';
    url += '&$expand=ExtraFields,ProductGroup,PartCode';
    
    console.log(`Fetching single product by PartNumber: ${partNumber}`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchSingleProductByPartNumber first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await this.login();
      const newSessionId = await this.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchSingleProductByPartNumber retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchSingleProductByPartNumber failed after re-login");
      }
    }
    
    const products = await res.json();
    if (!Array.isArray(products)) {
      throw new Error("Monitor API returned unexpected data format for fetchSingleProductByPartNumber");
    }
    
    if (products.length === 0) {
      console.log(`No product found with PartNumber: ${partNumber}`);
      return null;
    }
    
    if (products.length > 1) {
      console.warn(`Multiple products found with PartNumber: ${partNumber}, using first one`);
    }
    
    const product = products[0];
    
    // Apply same filtering as fetchProducts() - check for ARTWEBAKTIV
    if (!Array.isArray(product.ExtraFields)) {
      console.log(`Product ${partNumber} has no ExtraFields, skipping`);
      return null;
    }
    
    const active = product.ExtraFields.find(f => f.Identifier === "ARTWEBAKTIV");
    const productName = product.ExtraFields.find(f => f.Identifier === "ARTWEBNAME");
    const productVariation = product.ExtraFields.find(f => f.Identifier === "ARTWEBVAR");
    
    if (productName) {
      console.log(`Product ${product.PartNumber}: ${productName.StringValue}, Variant: ${productVariation ? productVariation.StringValue : "N/A"}`);
    }
    
    // Check if product is active (same logic as fetchProducts)
    if (!active || active.SelectedOptionId !== "1062902127922128278") {
      console.log(`Product ${partNumber} is not active (ARTWEBAKTIV != 1062902127922128278), skipping`);
      return null;
    }
    
    console.log(`Successfully fetched single product: ${product.PartNumber} (ID: ${product.Id})`);
    
    return product;
  }

  /**
   * Fetch a single part by PartNumber with planning information
   * @param {string} partNumber - The part number to fetch
   * @returns {Promise<Object|null>} The part data with planning information or null if not found
   */
  async fetchPartByPartNumber(partNumber) {
    const sessionId = await this.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts`;
    url += `?$filter=PartNumber eq '${partNumber}'`;
    url += '&$select=Id,PartNumber,Description,ExtraFields,PurchaseQuantityPerPackage,PartPlanningInformations';
    url += '&$expand=PartPlanningInformations';
    
    console.log(`Fetching part by PartNumber: ${partNumber}`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchPartByPartNumber first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await this.login();
      const newSessionId = await this.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchPartByPartNumber retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchPartByPartNumber failed after re-login");
      }
    }
    
    const parts = await res.json();
    if (!Array.isArray(parts)) {
      throw new Error("Monitor API returned unexpected data format for fetchPartByPartNumber");
    }
    
    if (parts.length === 0) {
      console.log(`No part found with PartNumber: ${partNumber}`);
      return null;
    }
    
    if (parts.length > 1) {
      console.warn(`Multiple parts found with PartNumber: ${partNumber}, using first one`);
    }
    
    const part = parts[0];
    console.log(`Successfully fetched part: ${part.PartNumber} (ID: ${part.Id})`);
    console.log(`Part: ${JSON.stringify(part)}`);
    
    return part;
  }

  /**
   * Fetch all parts for stock sync with PartLocations included
   * @param {number} [limit] - Optional limit for number of parts to fetch (for testing)
   * @returns {Promise<Array>} Array of parts with PartLocations for inventory sync
   */
  async fetchPartsForStock(limit = null, specificPartId = null) {
    const sessionId = await this.getSessionId();

    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts`;
    
    // Build filter - base filter for active parts
    let filter = `BlockedStatus Neq 2 and Status Le 6 and Status Ge 4`;
    
    // Add specific part ID filter if provided (for debugging specific parts)
    if (specificPartId) {
      filter += ` and Id Eq ${specificPartId}`;
    }
    
    url += `?$filter=${filter}`;
    url += '&$select=Id,PartNumber,Status,BlockedStatus,PartLocations';
    url += '&$expand=PartLocations';
    
    // Add limit if specified (for single test mode)
    if (limit && limit > 0) {
      url += `&$top=${limit}`;
    }
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchPartsForStock first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await this.login();
      const newSessionId = await this.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchPartsForStock retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchPartsForStock failed after re-login");
      }
    }
    
    const parts = await res.json();
    
    if (!Array.isArray(parts)) {
      console.error('❌ Monitor API returned unexpected data format:', typeof parts, parts);
      throw new Error("Monitor API returned unexpected data format for fetchPartsForStock");
    }

    console.log(`✅ Fetched ${parts.length} parts from Monitor`);
    
    return parts;
  }
}

const monitorClient = new MonitorClient();

// Export the class for use in other files
export { MonitorClient };

export async function fetchProductsFromMonitor() {
  try {
    const products = await monitorClient.fetchProducts();
    if (!Array.isArray(products)) {
      throw new Error("Monitor API returned unexpected data format");
    }
    
    // For debugging: only return products that have ARTWEBNAME set
    const filteredProducts = products.filter(product => {
      const productName = product.ExtraFields?.find(f => f.Identifier === "ARTWEBNAME");
      return productName?.StringValue && productName.StringValue.trim() !== "";
    });
    
    console.log(`Filtered to ${filteredProducts.length} products with ARTWEBNAME set (from ${products.length} total)`);
    
    // Process products with pricing logic
    const productsWithPricing = await Promise.all(filteredProducts.map(async product => {
      const productName = product.ExtraFields?.find(f => f.Identifier === "ARTWEBNAME");
      const productVariation = product.ExtraFields?.find(f => f.Identifier === "ARTWEBVAR");
      
      // Since we filtered for products with ARTWEBNAME, we know it exists
      const finalProductName = productName.StringValue;
      
      // Use ARTWEBVAR if available, otherwise use PartNumber as variation
      const finalProductVariation = (productVariation?.StringValue && productVariation.StringValue.trim() !== "")
        ? productVariation.StringValue
        : product.PartNumber;

      // Convert ExtraFields array to an object for easier access in sync job
      const extraFieldsObj = {};
      if (Array.isArray(product.ExtraFields)) {
        product.ExtraFields.forEach(field => {
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
      const isOutletProduct = product.ProductGroupId === "1229581166640460381";
      let productPrice = null;
      
      if (isOutletProduct) {
        console.log(`Fetching outlet price for product ${product.PartNumber} (ID: ${product.Id})`);
        const outletPrice = await fetchOutletPriceFromMonitor(product.Id);
        if (outletPrice) {
          console.log(`Found outlet price ${outletPrice} for product ${product.PartNumber}`);
          productPrice = outletPrice;
        }
        // If no outlet price found, productPrice remains null even for outlet products
      }
      // For non-outlet products, productPrice remains null to force dynamic pricing
      
      return {
        id: product.Id,
        name: product.PartNumber,
        sku: product.PartNumber,
        description: product.Description || "",
        // Only set price for outlet products with valid outlet price, otherwise null
        price: productPrice,
        weight: product.WeightPerUnit,
        length: product.Length,
        width: product.Width,
        height: product.Height,
        volume: product.VolumePerUnit,
        category: product.CategoryString,
        barcode: product.Gs1Code,
        status: product.Status,
        productName: finalProductName,
        productVariation: finalProductVariation,
        PurchaseQuantityPerPackage: product.QuantityPerPackage,
        StandardUnitId: product.StandardUnitId,
        // Map both ProductGroup and PartCode for Shopify collections
        productGroupId: product.ProductGroup?.Id || null,
        productGroupDescription: product.ProductGroup?.Description || null,
        partCodeId: product.PartCode?.Id || null,
        partCodeDescription: product.PartCode?.Description || null,
        // Convert ExtraFields array to object for easier access
        ExtraFields: extraFieldsObj,
        // Flag to indicate if this product has ARTFSC (for async fetching)
        hasARTFSC: extraFieldsObj.ARTFSC !== undefined,
        // Pricing metadata
        isOutletProduct: isOutletProduct,
        hasOutletPrice: productPrice !== null,
        originalStandardPrice: product.StandardPrice,
      };
    }));
    
    return productsWithPricing;
  } catch (error) {
    console.error("Error fetching products from Monitor:", error);
    throw error;
  }
}

/**
 * Fetch specific products from Monitor by their IDs with pricing logic
 * @param {Array<string>} productIds - Array of product IDs to fetch
 * @returns {Promise<Array>} Array of processed products with pricing
 */
export async function fetchProductsByIdsFromMonitor(productIds) {
  try {
    const products = await monitorClient.fetchProductsByIds(productIds);
    if (!Array.isArray(products)) {
      throw new Error("Monitor API returned unexpected data format");
    }
    
    // For debugging: only return products that have ARTWEBNAME set
    const filteredProducts = products.filter(product => {
      const productName = product.ExtraFields?.find(f => f.Identifier === "ARTWEBNAME");
      return productName?.StringValue && productName.StringValue.trim() !== "";
    });
    
    console.log(`Filtered to ${filteredProducts.length} products with ARTWEBNAME set (from ${products.length} total)`);
    
    // Process products with pricing logic (same as fetchProductsFromMonitor)
    const productsWithPricing = await Promise.all(filteredProducts.map(async product => {
      const productName = product.ExtraFields?.find(f => f.Identifier === "ARTWEBNAME");
      const productVariation = product.ExtraFields?.find(f => f.Identifier === "ARTWEBVAR");
      
      // Since we filtered for products with ARTWEBNAME, we know it exists
      const finalProductName = productName.StringValue;
      
      // Use ARTWEBVAR if available, otherwise use PartNumber as variation
      const finalProductVariation = (productVariation?.StringValue && productVariation.StringValue.trim() !== "")
        ? productVariation.StringValue
        : product.PartNumber;

      // Convert ExtraFields array to an object for easier access in sync job
      const extraFieldsObj = {};
      if (Array.isArray(product.ExtraFields)) {
        product.ExtraFields.forEach(field => {
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
      const isOutletProduct = product.ProductGroupId === "1229581166640460381";
      let productPrice = null;
      
      if (isOutletProduct) {
        console.log(`Fetching outlet price for product ${product.PartNumber} (ID: ${product.Id})`);
        const outletPrice = await fetchOutletPriceFromMonitor(product.Id);
        if (outletPrice) {
          console.log(`Found outlet price ${outletPrice} for product ${product.PartNumber}`);
          productPrice = outletPrice;
        }
        // If no outlet price found, productPrice remains null even for outlet products
      }
      // For non-outlet products, productPrice remains null to force dynamic pricing
      
      return {
        id: product.Id,
        name: product.PartNumber,
        sku: product.PartNumber,
        description: product.Description || "",
        // Only set price for outlet products with valid outlet price, otherwise null
        price: productPrice,
        weight: product.WeightPerUnit,
        length: product.Length,
        width: product.Width,
        height: product.Height,
        volume: product.VolumePerUnit,
        category: product.CategoryString,
        barcode: product.Gs1Code,
        status: product.Status,
        productName: finalProductName,
        productVariation: finalProductVariation,
        PurchaseQuantityPerPackage: product.QuantityPerPackage,
        StandardUnitId: product.StandardUnitId,
        // Map both ProductGroup and PartCode for Shopify collections
        productGroupId: product.ProductGroup?.Id || null,
        productGroupDescription: product.ProductGroup?.Description || null,
        partCodeId: product.PartCode?.Id || null,
        partCodeDescription: product.PartCode?.Description || null,
        // Convert ExtraFields array to object for easier access
        ExtraFields: extraFieldsObj,
        // Flag to indicate if this product has ARTFSC (for async fetching)
        hasARTFSC: extraFieldsObj.ARTFSC !== undefined,
        // Pricing metadata
        isOutletProduct: isOutletProduct,
        hasOutletPrice: productPrice !== null,
        originalStandardPrice: product.StandardPrice,
      };
    }));
    
    return productsWithPricing;
  } catch (error) {
    console.error("Error fetching products by IDs from Monitor:", error);
    throw error;
  }
}

export async function fetchCustomersFromMonitor() {
  try {
    const sessionId = await monitorClient.getSessionId();
    let allCustomers = [];
    let skip = 0;
    const pageSize = 100;
    let keepFetching = true;
    
    while (keepFetching) {
      let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers`;
      url += `?$top=${pageSize}`;
      url += `&$skip=${skip}`;
      url += '&$expand=ExtraFields,References,ActiveDeliveryAddress';
      
      let res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": sessionId,
        },
        agent,
      });
      
      if (res.status !== 200) {
        const errorBody = await res.text();
        console.error(`Monitor API fetchCustomers first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
        // Try to re-login and retry once
        await monitorClient.login();
        const newSessionId = await monitorClient.getSessionId();
        res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Monitor-SessionId": newSessionId,
          },
          agent,
        });
        if (res.status !== 200) {
          const retryErrorBody = await res.text();
          console.error(`Monitor API fetchCustomers retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
          throw new Error("Monitor API fetchCustomers failed after re-login");
        }
      }
      
      const customers = await res.json();
      if (!Array.isArray(customers)) {
        throw new Error("Monitor API returned unexpected data format");
      }
      
      allCustomers = allCustomers.concat(customers);
      
      if (customers.length < pageSize) {
        keepFetching = false;
      } else {
        skip += pageSize;
      }
    }
    
    // Transform Monitor customers/references into Shopify customer format
    const shopifyCustomers = [];

    for (const monitorCustomer of allCustomers) {
      if (monitorCustomer.References && Array.isArray(monitorCustomer.References)) {
        for (const reference of monitorCustomer.References) {
          // Only create Shopify customers for references with "WEB-ACCOUNT" in Category
          if (reference.Category && reference.Category.includes("WEB-ACCOUNT")) {
            // Parse the reference Name field - it might contain both first and last name
            const fullName = reference.Name || "";
            const nameParts = fullName.trim().split(" ");
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";
            
            // Extract address information from ActiveDeliveryAddress
            const deliveryAddress = monitorCustomer.ActiveDeliveryAddress;
            const address1 = deliveryAddress?.Field1 || "";
            const postalCode = deliveryAddress?.PostalCode || "";
            const city = deliveryAddress?.Locality || "";
            
            shopifyCustomers.push({
              monitorId: monitorCustomer.Id,
              email: reference.EmailAddress || "",
              firstName: firstName,
              lastName: lastName,
              phone: reference.CellPhoneNumber || reference.PhoneNumber || "",
              company: monitorCustomer.Name || "",  // Use customer Name instead of CompanyName
              discountCategory: monitorCustomer.DiscountCategoryId?.toString() || "",
              priceListId: monitorCustomer.PriceListId?.toString() || "",
              address1: address1,
              postalCode: postalCode,
              city: city,
              note: `Monitor Customer ID: ${monitorCustomer.Id}, Reference ID: ${reference.Id}`,
            });
          }
        }
      }
      // Note: Removed the fallback for customers without references since we only want WEB-ACCOUNT references
    }
    
    console.log(`Processed ${allCustomers.length} Monitor customers and found ${shopifyCustomers.length} WEB-ACCOUNT references`);
    
    return shopifyCustomers;
  } catch (error) {
    console.error("Error fetching customers from Monitor:", error);
    throw error;
  }
}

/**
 * Fetch specific customers from Monitor by their IDs
 * @param {Array<string>} customerIds - Array of customer IDs to fetch
 * @returns {Promise<Array>} Array of customers in Shopify format
 */
export async function fetchCustomersByIdsFromMonitor(customerIds) {
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return [];
  }

  try {
    const sessionId = await monitorClient.getSessionId();
    console.log(`Fetching ${customerIds.length} specific customers by ID...`);
    
    // Build filter for specific IDs - OData $filter with multiple IDs
    const idFilter = customerIds.map(id => `Id eq '${id}'`).join(' or ');
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers`;
    url += `?$filter=${idFilter}`;
    url += '&$expand=ExtraFields,References,ActiveDeliveryAddress';
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchCustomersByIds first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        throw new Error(`Monitor API fetchCustomersByIds failed after retry. Status: ${res.status}, Body: ${retryErrorBody}`);
      }
    }
    
    const customers = await res.json();
    if (!Array.isArray(customers)) {
      throw new Error("Monitor API returned unexpected data format for customers");
    }
    
    console.log(`Successfully fetched ${customers.length} customers by ID`);
    
    // Transform Monitor customers/references into Shopify customer format (same logic as fetchCustomersFromMonitor)
    const shopifyCustomers = [];
    
    for (const monitorCustomer of customers) {
      if (monitorCustomer.References && Array.isArray(monitorCustomer.References)) {
        for (const reference of monitorCustomer.References) {
          // Only create Shopify customers for references with "WEB-ACCOUNT" in Category
          if (reference.Category && reference.Category.includes("WEB-ACCOUNT")) {
            // Parse the reference Name field - it might contain both first and last name
            const fullName = reference.Name || "";
            const nameParts = fullName.trim().split(" ");
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";
            
            // Extract address information from ActiveDeliveryAddress
            const deliveryAddress = monitorCustomer.ActiveDeliveryAddress;
            const address1 = deliveryAddress?.Field1 || "";
            const postalCode = deliveryAddress?.PostalCode || "";
            const city = deliveryAddress?.Locality || "";
            
            shopifyCustomers.push({
              monitorId: monitorCustomer.Id,
              email: reference.EmailAddress || "",
              firstName: firstName,
              lastName: lastName,
              phone: reference.CellPhoneNumber || reference.PhoneNumber || "",
              company: monitorCustomer.Name || "",  // Use customer Name instead of CompanyName
              discountCategory: monitorCustomer.DiscountCategoryId?.toString() || "",
              priceListId: monitorCustomer.PriceListId?.toString() || "",
              address1: address1,
              postalCode: postalCode,
              city: city,
              note: `Monitor Customer ID: ${monitorCustomer.Id}, Reference ID: ${reference.Id}`,
            });
          }
        }
      }
      // Note: Removed the fallback for customers without references since we only want WEB-ACCOUNT references
    }
    
    console.log(`Processed ${customers.length} Monitor customers and found ${shopifyCustomers.length} WEB-ACCOUNT references`);
    
    return shopifyCustomers;
  } catch (error) {
    console.error("Error fetching customers by IDs from Monitor:", error);
    throw error;
  }
}

export async function fetchUsersFromMonitor() {
  // Wrapper for backward compatibility - now calls fetchCustomersFromMonitor
  return await fetchCustomersFromMonitor();
}

/**
 * Fetch a single product by PartNumber with same filtering as fetchProducts() from Monitor
 * @param {string} partNumber - The part number to fetch
 * @returns {Promise<Object|null>} The product data or null if not found
 */
export async function fetchSingleProductByPartNumberFromMonitor(partNumber) {
  return await monitorClient.fetchSingleProductByPartNumber(partNumber);
}

/**
 * Fetch a single part by PartNumber with planning information from Monitor
 * @param {string} partNumber - The part number to fetch
 * @returns {Promise<Object|null>} The part data with planning information or null if not found
 */
export async function fetchPartByPartNumberFromMonitor(partNumber) {
  return await monitorClient.fetchPartByPartNumber(partNumber);
}

export async function fetchStockTransactionsFromMonitor(partId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/StockTransactions`;
    url += `?$filter=PartId eq '${partId}'`;
    url += '&$orderby=LoggingTimeStamp desc';
    url += '&$top=1'; // Only get the most recent transaction to get current balance
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchStockTransactions first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchStockTransactions retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchStockTransactions failed after re-login");
      }
    }
    
    const transactions = await res.json();
    if (!Array.isArray(transactions)) {
      throw new Error("Monitor API returned unexpected data format for stock transactions");
    }
    
    return transactions;
  } catch (error) {
    console.error(`Error fetching stock transactions for part ${partId}:`, error);
    throw error;
  }
}

export async function fetchARTFSCFromMonitor(productId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Common/ExtraFields`;
    url += `?$filter=ParentId eq '${productId}' and Identifier eq 'ARTFSC'`;
    url += '&$expand=SelectedOption';
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchARTFSC first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchARTFSC retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchARTFSC failed after re-login");
      }
    }
    
    const artfscData = await res.json();
    if (!Array.isArray(artfscData)) {
      throw new Error("Monitor API returned unexpected data format for ARTFSC");
    }
    
    // Return the SelectedOption.Description if available
    if (artfscData.length > 0 && artfscData[0].SelectedOption?.Description) {
      return artfscData[0].SelectedOption.Description;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching ARTFSC for product ${productId}:`, error);
    // Add to failed fetches array for reporting at the end
    failedARTFSCFetches.push({
      productId: productId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    // Return null instead of throwing to allow sync to continue
    return null;
  }
}

/**
 * Fetch outlet price for a specific part
 * @param {string} partId - The part ID to fetch outlet price for
 * @returns {Promise<number|null>} The outlet price or null if not found
 */
export async function fetchOutletPriceFromMonitor(partId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '1289997006982727753'`;
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchOutletPrice first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchOutletPrice retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        return null; // Don't throw error, just return null for no outlet price
      }
    }
    
    const prices = await res.json();
    if (!Array.isArray(prices)) {
      throw new Error("Monitor API returned unexpected data format for outlet prices");
    }
    
    return prices.length > 0 ? prices[0].Price : null;
  } catch (error) {
    console.error(`Error fetching outlet price for part ${partId}:`, error);
    return null;
  }
}

/**
 * Fetch entity change logs from Monitor for the last 6 hours
 * @param {string} entityTypeId - The entity type ID ('322cf0ac-10de-45ee-a792-f0944329d198' for products, '6bd51ec8-abd3-4032-ac43-8ddc15ca1fbc' for customers)
 * @returns {Promise<Array>} Array of change log entries for the specified entity type
 */
export async function fetchEntityChangeLogsFromMonitor(entityTypeId = '322cf0ac-10de-45ee-a792-f0944329d198') {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    // Calculate date 6 hours ago in ISO format
    const fortyEightHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateFilter = fortyEightHoursAgo.toISOString(); // Full ISO format with time
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Common/EntityChangeLogs`;
    url += `?$filter=ModifiedTimestamp gt '${dateFilter}' and EntityTypeId eq '${entityTypeId}'`;
    // Remove $orderby since it's causing SQL errors
    
    const entityType = entityTypeId === '322cf0ac-10de-45ee-a792-f0944329d198' ? 'products' : 'customers';
    console.log(`Fetching entity change logs for ${entityType} since: ${dateFilter}`);
    console.log(`Change logs URL: ${url}`);
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchEntityChangeLogs first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchEntityChangeLogs retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API fetchEntityChangeLogs failed after re-login");
      }
    }
    
    const changeLogs = await res.json();
    if (!Array.isArray(changeLogs)) {
      throw new Error("Monitor API returned unexpected data format for entity change logs");
    }
    
    console.log(`Found ${changeLogs.length} entity changes in the last 6 hours for ${entityType}`);
    
    // Extract unique entity IDs from the change logs
    const uniqueEntityIds = [...new Set(changeLogs.map(log => log.EntityId))];
    console.log(`Unique ${entityType} with changes: ${uniqueEntityIds.length}`);
    
    return uniqueEntityIds;
  } catch (error) {
    console.error(`Error fetching entity change logs:`, error);
    throw error;
  }
}

/**
 * Fetch customer-specific price for a part
 * @param {string} customerId - The Monitor customer ID
 * @param {string} partId - The part ID
 * @returns {Promise<number|null>} The customer price or null if not found
 */
export async function fetchCustomerPriceFromMonitor(customerId, partId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerPartLinks`;
    url += `?$filter=CustomerId eq '${customerId}' and PartId eq '${partId}'`;
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchCustomerPrice first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchCustomerPrice retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        return null;
      }
    }
    
    const customerLinks = await res.json();
    if (!Array.isArray(customerLinks)) {
      throw new Error("Monitor API returned unexpected data format for customer part links");
    }
    
    return customerLinks.length > 0 ? customerLinks[0].Price : null;
  } catch (error) {
    console.error(`Error fetching customer price for customer ${customerId} and part ${partId}:`, error);
    return null;
  }
}

/**
 * Fetch price from customer's price list
 * @param {string} priceListId - The price list ID
 * @param {string} partId - The part ID
 * @returns {Promise<number|null>} The price list price or null if not found
 */
export async function fetchPriceListPriceFromMonitor(priceListId, partId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
    url += `?$filter=PartId eq '${partId}' and PriceListId eq '${priceListId}'`;
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchPriceListPrice first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchPriceListPrice retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        return null;
      }
    }
    
    const prices = await res.json();
    if (!Array.isArray(prices)) {
      throw new Error("Monitor API returned unexpected data format for price list prices");
    }
    
    return prices.length > 0 ? prices[0].Price : null;
  } catch (error) {
    console.error(`Error fetching price list price for part ${partId} and price list ${priceListId}:`, error);
    return null;
  }
}

/**
 * Fetch customer details including PriceListId
 * @param {string} customerId - The Monitor customer ID
 * @returns {Promise<Object|null>} The customer data or null if not found
 */
export async function fetchCustomerFromMonitor(customerId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/Customers/${customerId}`;
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchCustomer first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchCustomer retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        return null;
      }
    }
    
    const customer = await res.json();
    return customer;
  } catch (error) {
    console.error(`Error fetching customer ${customerId}:`, error);
    return null;
  }
}

/**
 * Fetch discount category rows for customer's discount category and part
 * @param {string} discountCategoryId - The discount category ID from customer
 * @param {string} partCodeId - The part code ID from variant metafield
 * @returns {Promise<Object|null>} The discount category row data or null if not found
 */
export async function fetchDiscountCategoryRowFromMonitor(discountCategoryId, partCodeId) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Common/DiscountCategoryRows`;
    url += `?$filter=DiscountCategoryId eq '${discountCategoryId}' and PartCodeId eq '${partCodeId}'`;
    
    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API fetchDiscountCategoryRow first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API fetchDiscountCategoryRow retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        return null;
      }
    }
    
    const discountRows = await res.json();
    if (!Array.isArray(discountRows)) {
      throw new Error("Monitor API returned unexpected data format for discount category rows");
    }
    
    return discountRows.length > 0 ? discountRows[0] : null;
  } catch (error) {
    console.error(`Error fetching discount category row for discount category ${discountCategoryId} and part code ${partCodeId}:`, error);
    return null;
  }
}

/**
 * Create a customer order in Monitor
 * @param {Object} orderData - The order data to send to Monitor
 * @returns {Promise<number|null>} The created order ID or null if failed
 */
export async function createOrderInMonitor(orderData) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerOrders/Create`;
    
    let res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      body: JSON.stringify(orderData),
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API createOrder first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        body: JSON.stringify(orderData),
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API createOrder retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API createOrder failed after re-login");
      }
    }
    
    const result = await res.json();
    
    // Monitor API returns EntityCommandResponse with RootEntityId as the created order ID
    if (result.RootEntityId) {
      // Return both the order ID and the full result for access to other properties like OrderNumber
      return {
        orderId: result.RootEntityId,
        response: result
      };
    } else {
      console.error("Monitor API createOrder returned unexpected response:", JSON.stringify(result, null, 2));
      return null;
    }
  } catch (error) {
    console.error(`Error creating order in Monitor:`, error);
    throw error;
  }
}

export async function setOrderPropertiesInMonitor(customerOrderId, properties) {
  try {
    const sessionId = await monitorClient.getSessionId();
    
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerOrders/SetProperties`;
    
    const requestData = {
      CustomerOrderId: customerOrderId,
      ...properties
    };
    
    let res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      body: JSON.stringify(requestData),
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API setOrderProperties first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        body: JSON.stringify(requestData),
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API setOrderProperties retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API setOrderProperties failed after re-login");
      }
    }
    
    const result = await res.json();
    
    // Check if the response indicates success
    if (result) {
      return true;
    } else {
      console.error("Monitor API setOrderProperties returned unexpected response:", JSON.stringify(result, null, 2));
      return false;
    }
  } catch (error) {
    console.error(`Error setting order properties in Monitor:`, error);
    throw error;
  }
}

export async function updateDeliveryAddressInMonitor(customerOrderId, addressData) {
  try {
    console.log(`Updating delivery address for Monitor order ID ${customerOrderId}`);
    const sessionId = await monitorClient.getSessionId();
    
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/CustomerOrders/UpdateDeliveryAddress`;
    
    const requestData = {
      CustomerOrderId: customerOrderId,
      ...addressData
    };
    
    let res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Monitor-SessionId": sessionId,
      },
      body: JSON.stringify(requestData),
      agent,
    });
    
    if (res.status !== 200) {
      const errorBody = await res.text();
      console.error(`Monitor API updateDeliveryAddress first attempt failed. Status: ${res.status}, Body: ${errorBody}`);
      // Try to re-login and retry once
      await monitorClient.login();
      const newSessionId = await monitorClient.getSessionId();
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Monitor-SessionId": newSessionId,
        },
        body: JSON.stringify(requestData),
        agent,
      });
      if (res.status !== 200) {
        const retryErrorBody = await res.text();
        console.error(`Monitor API updateDeliveryAddress retry failed. Status: ${res.status}, Body: ${retryErrorBody}`);
        throw new Error("Monitor API updateDeliveryAddress failed after re-login");
      }
    }
    
    const result = await res.json();
    
    // Check if the response indicates success
    if (result) {
      return true;
    } else {
      console.error("Monitor API updateDeliveryAddress returned unexpected response:", JSON.stringify(result, null, 2));
      return false;
    }
  } catch (error) {
    console.error(`Error updating delivery address in Monitor:`, error);
    throw error;
  }
}

/**
 * Fetch all parts for stock sync - wrapper function for external use
 * @param {number} [limit] - Optional limit for number of parts to fetch (for testing)
 * @returns {Promise<Array>} Array of parts with PartLocations for inventory sync
 */
export async function fetchPartsForStock(limit = null, specificPartId = null) {
  return await monitorClient.fetchPartsForStock(limit, specificPartId);
}
