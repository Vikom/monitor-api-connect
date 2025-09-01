#!/usr/bin/env node

// Manual sync script - runs once and exits
// This is separate from the worker process that handles cron scheduling

import "@shopify/shopify-api/adapters/node";
import { fetchProductsFromMonitor, fetchARTFSCFromMonitor } from "./utils/monitor.js";
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";

dotenv.config();

// Import the syncProducts function from the main file
// We'll need to extract it to a shared module, but for now let's keep it simple

console.log("🚀 Manual Product Sync");
console.log("This script runs once and exits - use for manual synchronization");

// Get command line arguments
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Manual Product Sync Usage:

To sync ALL products to development store (OAuth):
  node app/manualSync.js

To sync ALL products to Advanced store:
  node app/manualSync.js --advanced
  node app/manualSync.js -a

This script runs once and exits. For scheduled sync, use the main app.
  `);
  process.exit(0);
}

console.log(`🎯 Target store: ${useAdvancedStore ? 'Advanced Store' : 'Development Store'}`);
console.log("🔄 Running full sync (all products)...");

// For now, direct users to use the main sync file
console.log("⚠️  Please use: node app/syncProductsJob.js for manual sync");
console.log("The main sync job will be refactored to support both modes.");
