/**
 * Setup script to configure Cart Transform API
 * Run this once to enable Cart Transform for dynamic pricing
 */

const setupCartTransform = async () => {
  console.log('Setting up Cart Transform API...');
  
  const SHOP_DOMAIN = process.env.SHOP || 'mdnjqg-qg.myshopify.com';
  const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  const APP_URL = process.env.SHOPIFY_APP_URL || 'https://monitor-api-connect-production.up.railway.app';
  
  if (!ACCESS_TOKEN) {
    console.error('SHOPIFY_ACCESS_TOKEN environment variable is required');
    process.exit(1);
  }
  
  // Cart Transform configuration
  const cartTransformQuery = `
    mutation cartTransformCreate($cartTransform: CartTransformCreateInput!) {
      cartTransformCreate(cartTransform: $cartTransform) {
        cartTransform {
          id
          functionId
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  const cartTransformInput = {
    functionId: 'cart-transform', // This should match your function ID
    blockOnFailure: false,
    metafields: [
      {
        namespace: 'cart-transform',
        key: 'enabled',
        value: 'true'
      }
    ]
  };
  
  try {
    const response = await fetch(`https://${SHOP_DOMAIN}/admin/api/2025-04/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ACCESS_TOKEN
      },
      body: JSON.stringify({
        query: cartTransformQuery,
        variables: {
          cartTransform: cartTransformInput
        }
      })
    });
    
    const result = await response.json();
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return;
    }
    
    if (result.data.cartTransformCreate.userErrors.length > 0) {
      console.error('User errors:', result.data.cartTransformCreate.userErrors);
      return;
    }
    
    console.log('Cart Transform created successfully:', result.data.cartTransformCreate.cartTransform);
    
    // Also set up the API endpoint URL
    console.log('\nNext steps:');
    console.log('1. Ensure your Cart Transform API is accessible at:');
    console.log(`   ${APP_URL}/api/cart-transform`);
    console.log('2. Test the Cart Transform by adding items to cart');
    console.log('3. Check console logs for Cart Transform operations');
    
  } catch (error) {
    console.error('Error setting up Cart Transform:', error);
  }
};

// Alternative: Manual setup instructions
const printManualSetup = () => {
  console.log('\n=== MANUAL CART TRANSFORM SETUP ===');
  console.log('1. Go to your Shopify Partner Dashboard');
  console.log('2. Navigate to your app → Extensions');
  console.log('3. Create a new Cart Transform function');
  console.log('4. Set the endpoint URL to:');
  console.log('   https://monitor-api-connect-production.up.railway.app/api/cart-transform');
  console.log('5. Enable the Cart Transform in your store');
  console.log('\nOr use the Shopify CLI:');
  console.log('shopify app generate extension --type=cart_transform');
};

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--manual')) {
  printManualSetup();
} else {
  setupCartTransform();
}

export { setupCartTransform, printManualSetup };
