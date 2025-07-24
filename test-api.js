import prisma from "./app/db.server.js";

async function testShopifyAPI() {
  try {
    const session = await prisma.session.findFirst();
    if (!session) {
      console.log("No session found");
      return;
    }

    console.log(`Testing API with shop: ${session.shop}`);
    console.log(`Access token length: ${session.accessToken.length}`);
    
    // Test with a simple GraphQL query
    const fetch = (await import('node-fetch')).default;
    
    const testQuery = `query {
      shop {
        name
        id
      }
    }`;

    const response = await fetch(`https://${session.shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({ query: testQuery }),
    });

    const result = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
    } else if (result.data) {
      console.log('✅ API call successful!');
    }
    
  } catch (error) {
    console.error('Error testing API:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testShopifyAPI();
