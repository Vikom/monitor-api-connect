// Test sessions for debugging
import { sessionStorage } from "./app/shopify.server.js";

async function checkSessions() {
  try {
    console.log('🔍 Checking all sessions...');
    
    // Check sessions for the exact shop
    const sessions1 = await sessionStorage.findSessionsByShop('mdnjqg-qg.myshopify.com');
    console.log('Sessions for mdnjqg-qg.myshopify.com:', sessions1.length);
    
    // Check if there might be sessions under a different format
    const sessions2 = await sessionStorage.findSessionsByShop('mdnjqg-qg');
    console.log('Sessions for mdnjqg-qg:', sessions2.length);
    
    // Get all sessions to see what's available
    // Note: This might not exist in the API, but worth checking
    console.log('Checking session storage methods...');
    console.log('Available methods:', Object.getOwnPropertyNames(sessionStorage));
    
  } catch (error) {
    console.error('Error checking sessions:', error);
  }
}

checkSessions();
