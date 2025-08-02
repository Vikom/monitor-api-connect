/**
 * Test script to verify Advanced store authentication setup
 * Run with: node test-advanced-auth.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

async function testAdvancedStoreAuth() {
  const advancedDomain = process.env.ADVANCED_STORE_DOMAIN;
  const advancedToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

  console.log('🔍 Testing Advanced Store Configuration...\n');

  // Check environment variables
  if (!advancedDomain) {
    console.log('❌ ADVANCED_STORE_DOMAIN not set in .env file');
    return false;
  }

  if (!advancedToken) {
    console.log('❌ ADVANCED_STORE_ADMIN_TOKEN not set in .env file');
    return false;
  }

  console.log(`✅ Advanced store domain: ${advancedDomain}`);
  console.log(`✅ Admin token configured: ${advancedToken.substring(0, 12)}...`);

  // Test API connectivity
  console.log('\n🌐 Testing API connectivity...');
  
  try {
    const url = `https://${advancedDomain}/admin/api/2025-01/shop.json`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': advancedToken,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Successfully connected to ${data.shop.name}`);
      console.log(`   Shop ID: ${data.shop.id}`);
      console.log(`   Domain: ${data.shop.domain}`);
      console.log(`   Plan: ${data.shop.plan_name || data.shop.plan_display_name}`);
      return true;
    } else {
      console.log(`❌ API call failed: ${response.status} ${response.statusText}`);
      
      if (response.status === 401) {
        console.log('   This usually means the admin token is invalid or expired');
      } else if (response.status === 403) {
        console.log('   This usually means the admin token lacks required permissions');
      }
      
      return false;
    }
  } catch (error) {
    console.log(`❌ Network error: ${error.message}`);
    return false;
  }
}

async function testGraphQLAPI() {
  const advancedDomain = process.env.ADVANCED_STORE_DOMAIN;
  const advancedToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

  console.log('\n🔗 Testing GraphQL API...');

  try {
    const url = `https://${advancedDomain}/admin/api/2025-01/graphql.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': advancedToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query {
            shop {
              id
              name
              url
              plan {
                displayName
              }
            }
          }
        `,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.errors) {
        console.log('❌ GraphQL errors:', data.errors);
        return false;
      }
      
      console.log(`✅ GraphQL API working correctly`);
      console.log(`   Shop: ${data.data.shop.name}`);
      console.log(`   Plan: ${data.data.shop.plan.displayName}`);
      return true;
    } else {
      console.log(`❌ GraphQL API call failed: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ GraphQL error: ${error.message}`);
    return false;
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Advanced Store Authentication Test\n');
  
  const authTest = await testAdvancedStoreAuth();
  
  if (authTest) {
    await testGraphQLAPI();
  }
  
  console.log('\n' + '='.repeat(50));
  
  if (authTest) {
    console.log('🎉 All tests passed! Your Advanced store is configured correctly.');
    console.log('\n📝 Next steps:');
    console.log('   1. Update ADVANCED_STORE_DOMAIN in your .env file with the actual domain');
    console.log('   2. Update ADVANCED_STORE_ADMIN_TOKEN with the actual token');
    console.log('   3. Run your app and test with the Advanced store');
  } else {
    console.log('❌ Tests failed. Please check your configuration.');
  }
}

runTests().catch(console.error);
