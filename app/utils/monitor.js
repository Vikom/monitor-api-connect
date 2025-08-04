// app/utils/monitor.js

import prisma from "../db.server.js";
import fetch from "node-fetch";
import https from "https";

const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

// @TODO
// The SSL certificate used by the server is self-signed so it is important that you add an exception for it in your integration.

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

  /**
   * Should we first filter by ExtraFields value like this:
   * https://185.186.56.206:8001/sv/008_3.1/api/v1/Common/ExtraFields?$filter=Identifier eq 'ARTWEBAKTIV'
   */

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
      url += '&$select=Id,PartNumber,Description,ExtraDescription,ExtraFields,PartCodeId,StandardPrice,PartCodeId,ProductGroupId,Status,WeightPerUnit,VolumePerUnit,IsFixedWeight,Gs1Code,Status';
      url += '&$filter=Status eq 4';
      url += '&$expand=ExtraFields';
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
      const productName = product.ExtraFields.find(f => f.Identifier === "ARTWEBKAT");
      const productVariation = product.ExtraFields.find(f => f.Identifier === "ARTWEBVAR");
      if (productName) console.log(`Product ${product.PartNumber}: ${productName.StringValue}, Variant: ${productVariation ? productVariation.StringValue : "N/A"}`);
      return active && active.SelectedOptionId === "1062902127922128278";
    });
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
    
    // For debugging: only return products that have ARTWEBKAT set
    const filteredProducts = products.filter(product => {
      const productName = product.ExtraFields?.find(f => f.Identifier === "ARTWEBKAT");
      return productName?.StringValue && productName.StringValue.trim() !== "";
    });
    
    console.log(`Filtered to ${filteredProducts.length} products with ARTWEBKAT set (from ${products.length} total)`);
    
    return filteredProducts.map(product => {
      const productName = product.ExtraFields?.find(f => f.Identifier === "ARTWEBKAT");
      const productVariation = product.ExtraFields?.find(f => f.Identifier === "ARTWEBVAR");
      
      // Since we filtered for products with ARTWEBKAT, we know it exists
      const finalProductName = productName.StringValue;
      
      // Use ARTWEBVAR if available, otherwise use PartNumber as variation
      const finalProductVariation = (productVariation?.StringValue && productVariation.StringValue.trim() !== "")
        ? productVariation.StringValue
        : product.PartNumber;
      
      return {
        id: product.Id,
        name: product.PartNumber,
        sku: product.PartNumber,
        description: product.Description || "",
        extraDescription: product.ExtraDescription || "",
        // vendor: @TODO Needed?
        price: product.StandardPrice,
        weight: product.WeightPerUnit,
        length: product.Length,
        width: product.Width,
        height: product.Height,
        category: product.CategoryString,
        // stock: @TODO
        barcode: product.Gs1Code,
        status: product.Status,
        productName: finalProductName,
        productVariation: finalProductVariation,
      };
    });
  } catch (error) {
    console.error("Error fetching products from Monitor:", error);
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
      url += '&$expand=ExtraFields,References';
      
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
        throw new Error("Monitor API returned unexpected data format for customers");
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
      // Each Monitor customer can have multiple references (persons)
      if (Array.isArray(monitorCustomer.References)) {
        for (const reference of monitorCustomer.References) {
          // Only process references that have an email address
          if (reference.EmailAddress && reference.EmailAddress.trim() !== "") {
            // Parse the full name into first and last name
            const fullName = reference.Name || "";
            const nameParts = fullName.trim().split(/\s+/);
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";
            
            shopifyCustomers.push({
              email: reference.EmailAddress.trim(),
              firstName: firstName,
              lastName: lastName,
              phone: reference.CellPhoneNumber || reference.PhoneNumber || undefined,
              // Custom metafields for tracking
              monitorId: reference.Id, // Reference (person) ID from Monitor
              company: monitorCustomer.Name, // Company name from Monitor customer
              // Additional data for potential future use
              note: reference.Note || undefined,
              monitorCustomerId: monitorCustomer.Id, // Customer (company) ID from Monitor
              customerCode: monitorCustomer.Code,
            });
          }
        }
      }
    }
    
    console.log(`Processed ${allCustomers.length} Monitor customers with ${shopifyCustomers.length} individual references/persons`);
    
    return shopifyCustomers;
  } catch (error) {
    console.error("Error fetching customers from Monitor:", error);
    throw error;
  }
}

export async function fetchUsersFromMonitor() {
  // Wrapper for backward compatibility - now calls fetchCustomersFromMonitor
  return await fetchCustomersFromMonitor();
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
