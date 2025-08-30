#!/usr/bin/env node

/**
 * Test script for Monitor pricing API functions
 * Usage: node test-pricing.js
 */

import { fetchOutletPriceFromMonitor, fetchCustomerPriceFromMonitor, fetchPriceListPriceFromMonitor, fetchCustomerFromMonitor } from './app/utils/monitor.js';
import { getDynamicPrice } from './app/utils/pricing.js';

// Test configuration - replace with real IDs from your Monitor system
const TEST_CONFIG = {
  outletPartId: 'YOUR_OUTLET_PART_ID', // A part in the outlet product group
  standardPartId: 'YOUR_STANDARD_PART_ID', // A regular part
  customerId: 'YOUR_CUSTOMER_ID', // A customer with Monitor ID
  priceListId: 'YOUR_PRICE_LIST_ID' // A price list ID
};

async function testOutletPricing() {
  console.log('\n=== Testing Outlet Pricing ===');
  
  try {
    const outletPrice = await fetchOutletPriceFromMonitor(TEST_CONFIG.outletPartId);
    
    if (outletPrice !== null) {
      console.log(`✅ Outlet price found: ${outletPrice}`);
    } else {
      console.log(`ℹ️  No outlet price found for part ${TEST_CONFIG.outletPartId}`);
    }
  } catch (error) {
    console.error(`❌ Error testing outlet pricing: ${error.message}`);
  }
}

async function testCustomerSpecificPricing() {
  console.log('\n=== Testing Customer-Specific Pricing ===');
  
  try {
    const customerPrice = await fetchCustomerPriceFromMonitor(TEST_CONFIG.customerId, TEST_CONFIG.standardPartId);
    
    if (customerPrice !== null) {
      console.log(`✅ Customer-specific price found: ${customerPrice}`);
    } else {
      console.log(`ℹ️  No customer-specific price found for customer ${TEST_CONFIG.customerId} and part ${TEST_CONFIG.standardPartId}`);
    }
  } catch (error) {
    console.error(`❌ Error testing customer-specific pricing: ${error.message}`);
  }
}

async function testPriceListPricing() {
  console.log('\n=== Testing Price List Pricing ===');
  
  try {
    const priceListPrice = await fetchPriceListPriceFromMonitor(TEST_CONFIG.priceListId, TEST_CONFIG.standardPartId);
    
    if (priceListPrice !== null) {
      console.log(`✅ Price list price found: ${priceListPrice}`);
    } else {
      console.log(`ℹ️  No price list price found for price list ${TEST_CONFIG.priceListId} and part ${TEST_CONFIG.standardPartId}`);
    }
  } catch (error) {
    console.error(`❌ Error testing price list pricing: ${error.message}`);
  }
}

async function testCustomerDetails() {
  console.log('\n=== Testing Customer Details ===');
  
  try {
    const customer = await fetchCustomerFromMonitor(TEST_CONFIG.customerId);
    
    if (customer) {
      console.log(`✅ Customer found:`, {
        id: customer.Id,
        name: customer.Name,
        priceListId: customer.PriceListId || 'No price list'
      });
    } else {
      console.log(`ℹ️  Customer ${TEST_CONFIG.customerId} not found`);
    }
  } catch (error) {
    console.error(`❌ Error testing customer details: ${error.message}`);
  }
}

async function testDynamicPricing() {
  console.log('\n=== Testing Dynamic Pricing Logic ===');
  
  try {
    const fallbackPrice = 100.00;
    const dynamicPrice = await getDynamicPrice(TEST_CONFIG.standardPartId, TEST_CONFIG.customerId, fallbackPrice);
    
    console.log(`✅ Dynamic price calculation completed: ${dynamicPrice}`);
    
    if (dynamicPrice === fallbackPrice) {
      console.log(`ℹ️  Using fallback price (no special pricing found)`);
    } else {
      console.log(`✅ Special pricing applied! Standard would be ${fallbackPrice}, dynamic is ${dynamicPrice}`);
    }
  } catch (error) {
    console.error(`❌ Error testing dynamic pricing: ${error.message}`);
  }
}

async function runAllTests() {
  console.log('🧪 Starting Monitor Pricing API Tests...');
  console.log('Note: Update TEST_CONFIG with real IDs from your Monitor system for meaningful results');
  console.log('Note: Bulk pricing will be added in the future when needed');
  
  await testOutletPricing();
  await testCustomerSpecificPricing();
  await testPriceListPricing();
  await testCustomerDetails();
  await testDynamicPricing();
  
  console.log('\n✅ All tests completed!');
  console.log('\nNext steps:');
  console.log('1. Update TEST_CONFIG with real Monitor IDs');
  console.log('2. Test the /api/pricing endpoint in your Shopify app');
  console.log('3. Integrate pricing-client.js into your Shopify theme');
  console.log('4. Ensure all customers are logged in (no anonymous pricing)');
}

// Check if we have the required environment variables
if (!process.env.MONITOR_URL || !process.env.MONITOR_USER || !process.env.MONITOR_PASS || !process.env.MONITOR_COMPANY) {
  console.error('❌ Missing required environment variables:');
  console.error('   MONITOR_URL, MONITOR_USER, MONITOR_PASS, MONITOR_COMPANY');
  console.error('   Please check your .env file');
  process.exit(1);
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});
