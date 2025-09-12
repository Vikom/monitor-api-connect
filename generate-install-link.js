// Generate installation link for production store
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { restResources } from "@shopify/shopify-api/rest/admin/2023-10";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Get shop from command line argument
const args = process.argv.slice(2);
const shopArg = args.find(arg => arg.startsWith('--shop='));
const shop = shopArg ? shopArg.split('=')[1] : 'mdnjqg-qg.myshopify.com';

console.log(`🔗 Generating installation link for: ${shop}`);

// Initialize Shopify app configuration
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: "2023-10",
  scopes: process.env.SCOPES?.split(",") || ["read_products", "write_products", "read_orders", "write_orders", "read_customers", "write_customers"],
  appUrl: process.env.SHOPIFY_APP_URL || "https://monitor-api-connect-production.up.railway.app",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: "AppDistribution.ShopifyPlus", // For private apps
  restResources,
});

// Generate OAuth URL
const appUrl = process.env.SHOPIFY_APP_URL || "https://monitor-api-connect-production.up.railway.app";
const authUrl = `https://${shop}/admin/oauth/authorize?` + 
  `client_id=${process.env.SHOPIFY_API_KEY}&` +
  `scope=${(process.env.SCOPES?.split(",") || ["read_products", "write_products", "read_orders", "write_orders", "read_customers", "write_customers"]).join(',')}&` +
  `redirect_uri=${encodeURIComponent(appUrl)}/auth/callback&` +
  `state=${Math.random().toString(36).substring(7)}`;

console.log('\n🎯 INSTALLATION STEPS:');
console.log('\n1. 📋 Copy this URL:');
console.log(`\n${authUrl}\n`);
console.log('2. 🌐 Open the URL in your browser');
console.log('3. ✅ Install the app in your Shopify admin');
console.log('4. 🔄 This will create the necessary sessions for the production store');
console.log('\n💡 After installation, the draft order endpoint will work!');
console.log(`\n🏗️  App URL: ${appUrl}`);
console.log(`🔑 API Key: ${process.env.SHOPIFY_API_KEY}`);

await prisma.$disconnect();