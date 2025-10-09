import "@shopify/shopify-api/adapters/node";
import cron from "node-cron";
import dotenv from "dotenv";
import { pollForNewOrders } from "./orderPollJob.js";
import { syncInventory } from "./syncInventoryJob.js";
import { syncProducts } from "./syncProductsJob.js";
import { syncCustomers } from "./syncCustomersJob.js";
import fetch from "node-fetch";

dotenv.config();

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

  // Inventory sync every hour at 30 minutes past
  cron.schedule("30 * * * *", () => {
    console.log("[INVENTORY-SYNC] Running scheduled inventory sync...");
    runSyncJob("INVENTORY-SYNC", syncInventory);
  });

  // Product sync every hour (incremental)
  cron.schedule("0 * * * *", () => {
    console.log("[PRODUCT-SYNC] Running scheduled incremental product sync...");
    runSyncJob("PRODUCT-SYNC", syncProducts, true); // true = incremental sync
  });

  // Customer sync every hour (incremental)
  // cron.schedule("5 * * * *", () => { // 5 minutes after product sync to avoid conflicts
  //   console.log("[CUSTOMER-SYNC] Running scheduled incremental customer sync...");
  //   runSyncJob("CUSTOMER-SYNC", syncCustomers, true); // true = incremental sync
  // });
  
  console.log("📅 Worker cron jobs scheduled:");
  console.log("  - Order polling: every 5 minutes");
  console.log("  - Inventory sync: every hour (at :15)");
  console.log("  - Product sync: every hour (at :00)");
  // console.log("  - Customer sync: every hour (at :05)");
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
  - Inventory sync: every hour (at :15)
  - Product sync: every hour (at :00, incremental)
  - Customer sync: every hour (at :05, incremental)

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

// Set up cron jobs
setupCronJobs();

console.log("✅ Worker is running and scheduled jobs are active");
console.log("💡 Worker will continue running indefinitely until stopped");

// Keep the process alive
process.on('SIGTERM', () => {
  console.log('🛑 Worker received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Worker received SIGINT, shutting down gracefully...');
  process.exit(0);
});