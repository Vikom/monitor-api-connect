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

  async fetchProducts() {
    const sessionId = await this.getSessionId();
    let url = `${monitorUrl}/${monitorCompany}/api/v1/Inventory/Parts`;
    url += '?$top=10'; // Just fetch 10 products
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
    return res.json();
  }
}

const monitorClient = new MonitorClient();

export async function fetchProductsFromMonitor() {
  try {
    const products = await monitorClient.fetchProducts();
    if (!Array.isArray(products)) {
      throw new Error("Monitor API returned unexpected data format");
    }
    return products.map(product => ({
      id: product.Id,
      name: product.Name || product.PartNumber || "Unnamed Product",
      sku: product.PartNumber,
      description: product.Description || product.ExtraDescription || "",
      extraDescription: product.ExtraDescription || "",
      vendor: product.Vendor || "Default Vendor",
      price: product.StandardPrice != null ? product.StandardPrice : (product.Price != null ? product.Price : 0),
      weight: product.WeightPerUnit,
      length: product.Length,
      width: product.Width,
      height: product.Height,
      category: product.CategoryString,
      stock: product.Stock != null ? product.Stock : (product.ManageStockBalance ? 1 : 0),
      countryOfOrigin: product.CountryOfOrigin || product.CountryOfOriginId,
      barcode: product.Gs1Code,
      status: product.Status,
    }));
  } catch (error) {
    console.error("Error fetching products from Monitor:", error);
    throw error;
  }
}
