// Simple script to check Railway's outbound IP address
import fetch from 'node-fetch';

console.log('🔍 Checking Railway outbound IP address...');

async function checkIP() {
  try {
    // Use a service that returns our public IP
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    
    console.log(`📍 Railway outbound IP: ${data.ip}`);
    
    // Also try another service for verification
    const response2 = await fetch('https://httpbin.org/ip');
    const data2 = await response2.json();
    
    console.log(`Verification IP: ${data2.origin}`);
    
  } catch (error) {
    console.error('❌ Error checking IP:', error.message);
  }
}

checkIP();
