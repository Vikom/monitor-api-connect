import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import dotenv from "dotenv";
import https from "https";
import { pollForNewOrders } from "./orderPollJob.js";
import { syncInventory } from "./syncInventoryJob.js";
import { syncProducts } from "./syncProductsJob.js";
import { syncCustomers } from "./syncCustomersJob.js";
import fetch from "node-fetch";

dotenv.config();

// HTTPS agent for Monitor API (self-signed certificate)
const agent = new https.Agent({ rejectUnauthorized: false });

// Function to test Monitor API connectivity
async function testMonitorConnection() {
  const monitorUrl = process.env.MONITOR_URL;
  const monitorUsername = process.env.MONITOR_USER;
  const monitorPassword = process.env.MONITOR_PASS;
  const monitorCompany = process.env.MONITOR_COMPANY;

  if (!monitorUrl || !monitorUsername || !monitorPassword || !monitorCompany) {
    console.log("❌ Monitor API: Missing configuration (MONITOR_URL, MONITOR_USER, MONITOR_PASS, MONITOR_COMPANY)");
    return false;
  }

  try {
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
      console.log(`❌ Monitor API: Login failed (Status: ${res.status})`);
      return false;
    }

    const sessionId = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
    if (!sessionId) {
      console.log("❌ Monitor API: No session ID returned");
      return false;
    }

    console.log("✅ Monitor API: Connection successful");
    return true;
  } catch (error) {
    console.log(`❌ Monitor API: Connection failed - ${error.message}`);
    return false;
  }
}

// Function to test Shopify API connectivity
async function testShopifyConnection() {
  const shop = process.env.ADVANCED_STORE_DOMAIN;
  const accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    console.log("❌ Shopify API: Missing configuration (ADVANCED_STORE_DOMAIN, ADVANCED_STORE_ADMIN_TOKEN)");
    return false;
  }

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
      console.log(`❌ Shopify API: GraphQL errors - ${JSON.stringify(result.errors)}`);
      return false;
    }

    if (result.data?.shop?.name) {
      console.log(`✅ Shopify API: Connection successful (Shop: ${result.data.shop.name})`);
      return true;
    }

    console.log("❌ Shopify API: Unexpected response format");
    return false;
  } catch (error) {
    console.log(`❌ Shopify API: Connection failed - ${error.message}`);
    return false;
  }
}

// Function to run connectivity tests
async function runConnectivityTests() {
  console.log("\n🧪 Running connectivity tests...\n");
  
  const [monitorOk, shopifyOk] = await Promise.all([
    testMonitorConnection(),
    testShopifyConnection()
  ]);

  console.log("\n📊 Connectivity Test Results:");
  console.log(`   Monitor API: ${monitorOk ? '✅ OK' : '❌ FAILED'}`);
  console.log(`   Shopify API: ${shopifyOk ? '✅ OK' : '❌ FAILED'}\n`);

  return monitorOk && shopifyOk;
}

// Function to log Railway's outbound IP for Monitor API whitelisting
async function logRailwayIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    console.log(`RAILWAY OUTBOUND IP: ${data.ip}`);
    console.log('================================');
  } catch (error) {
    console.log('❌ Could not determine outbound IP:', error.message);
  }
}

// Helper function to check if advanced store is configured
function checkAdvancedStoreConfig() {
  const advancedStoreDomain = process.env.ADVANCED_STORE_DOMAIN;
  const advancedStoreToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;
  
  if (!advancedStoreDomain || !advancedStoreToken) {
    console.log("❌ Advanced store configuration missing - ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are required");
    return false;
  }
  
  return { domain: advancedStoreDomain, token: advancedStoreToken };
}

// Helper function to run sync job with error handling
async function runSyncJob(jobName, syncFunction, ...args) {
  const config = checkAdvancedStoreConfig();
  if (!config) {
    console.log(`❌ [${jobName}] Skipping sync - advanced store not configured`);
    return;
  }

  console.log(`[${jobName}] Running sync for Advanced store: ${config.domain}`);
  
  // Set global flag to use advanced store for this sync
  const originalUseAdvancedStore = global.useAdvancedStore;
  global.useAdvancedStore = true;
  
  try {
    await syncFunction(...args);
    console.log(`[${jobName}] ✅ Sync completed successfully`);
  } catch (error) {
    console.error(`[${jobName}] ❌ Sync failed:`, error);
  } finally {
    // Restore original flag
    global.useAdvancedStore = originalUseAdvancedStore;
  }
}

// Set up all cron jobs for worker mode
function setupCronJobs() {
  // Order polling every 5 minutes
  cron.schedule("*/5 * * * *", () => {
    console.log("[ORDER-POLL] Checking for new orders...");
    pollForNewOrders().catch((error) => {
      console.error("[ORDER-POLL] ❌ Order polling failed:", error);
    });
  });

  // Inventory sync daily at 23:00 Swedish time (22:00 UTC)
  cron.schedule("0 22 * * *", () => {
    console.log("[INVENTORY-SYNC] Running scheduled inventory sync...");
    runSyncJob("INVENTORY-SYNC", syncInventory);
  });

  // Product sync every 15 minutes (at minutes 0, 15, 30, 45)
  cron.schedule("0,15,30,45 * * * *", () => {
    console.log("[PRODUCT-SYNC] Running scheduled incremental product sync...");
    runSyncJob("PRODUCT-SYNC", syncProducts, true); // true = incremental sync
  });

  // Customer sync every 10 minutes (at minutes 2, 12, 22, 32, 42, 52) - offset to avoid conflicts
  cron.schedule("2,12,22,32,42,52 * * * *", () => {
    console.log("[CUSTOMER-SYNC] Running scheduled incremental customer sync...");
    runSyncJob("CUSTOMER-SYNC", syncCustomers, true); // true = incremental sync
  });
  
  console.log("📅 Worker cron jobs scheduled:");
  console.log("  - Order polling: every 5 minutes");
  console.log("  - Inventory sync: daily at 23:00 Swedish time (22:00 UTC)");
  console.log("  - Product sync: every 15 minutes (at :00, :15, :30, :45)");
  console.log("  - Customer sync: every 10 minutes (at :02, :12, :22, :32, :42, :52)");
}

// Display usage instructions
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Sync Worker Usage:

Production (Railway):
  node app/worker.js                              # Starts all scheduled sync jobs

Local Development:
  node app/worker.js --force                      # Force start locally (use with caution)

Individual manual syncs:
  npm run manual-sync-products                    # Manual product sync
  npm run manual-sync-customers                   # Manual customer sync  
  npm run manual-sync-inventory                   # Manual inventory sync

🕐 Worker Schedule (Production only):
  - Order polling: every 5 minutes
  - Inventory sync: daily at 23:00 Swedish time (22:00 UTC)
  - Product sync: every 15 minutes (at :00, :15, :30, :45, incremental)
  - Customer sync: every 10 minutes (at :02, :12, :22, :32, :42, :52, incremental)

🚨 Safety: Worker only runs in production environment automatically
   Set NODE_ENV=production or run on Railway to enable

Configuration:
  All worker sync jobs use Advanced store credentials:
  - ADVANCED_STORE_DOMAIN
  - ADVANCED_STORE_ADMIN_TOKEN

Make sure your .env file is configured properly before running.
  `);
  process.exit(0);
}

// Safety check - only allow worker to run in production environment
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
const forceStart = args.includes('--force');

if (!isProduction && !forceStart) {
  console.log(`
⚠️  Worker is designed to run only in production (Railway)
🏠 Current environment: ${process.env.NODE_ENV || 'development'}
🚫 Worker will not start in local/development environment

To force start locally for testing: node app/worker.js --force
💡 For local development, use individual sync commands:
   - npm run manual-sync-products
   - npm run manual-sync-customers
   - npm run manual-sync-inventory
  `);
  process.exit(0);
}

if (forceStart) {
  console.log("⚠️  FORCED START: Worker starting in non-production environment");
}

// Main worker startup
console.log(`
🚀 Starting Sync Worker
📝 Use --help for usage instructions
⏰ All sync jobs scheduled for Advanced store
🏗️  Environment: ${isProduction ? 'Production (Railway)' : 'Local (Forced)'}
`);

// Log IP at startup
logRailwayIP();

// Check configuration at startup
const config = checkAdvancedStoreConfig();
if (!config) {
  console.error("❌ Cannot start worker - Advanced store configuration missing");
  console.log("Please ensure ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are set in your environment variables");
  process.exit(1);
}

console.log(`🏭 Worker starting for Advanced store: ${config.domain}`);
console.log("🔄 Setting up cron schedules...");

// Set global flag for all sync operations in this worker
global.useAdvancedStore = true;

// Set up cron jobs (skip in testing environment)
const isTesting = process.env.NODE_ENV === 'testing';
if (isTesting) {
  console.log("🧪 Testing environment detected - cron jobs disabled");
  console.log("🔗 Running connectivity tests instead...");
  
  // Run connectivity tests and exit
  runConnectivityTests().then((allOk) => {
    if (allOk) {
      console.log("✅ All connectivity tests passed!");
      process.exit(0);
    } else {
      console.log("❌ Some connectivity tests failed!");
      process.exit(1);
    }
  }).catch((error) => {
    console.error("❌ Connectivity test error:", error);
    process.exit(1);
  });

  setupCronJobs();
  
  console.log("✅ Worker is running and scheduled jobs are active");
  console.log("💡 Worker will continue running indefinitely until stopped");
} else {
  setupCronJobs();
  
  console.log("✅ Worker is running and scheduled jobs are active");
  console.log("💡 Worker will continue running indefinitely until stopped");
}

// Keep the process alive
process.on('SIGTERM', () => {
  console.log('🛑 Worker received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Worker received SIGINT, shutting down gracefully...');
  process.exit(0);
});