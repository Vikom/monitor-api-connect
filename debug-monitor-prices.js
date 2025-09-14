// Debug script to check Monitor API price lists and parts
import fetch from "node-fetch";
import https from "https";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const monitorUrl = process.env.MONITOR_URL;
const monitorUsername = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASS;
const monitorCompany = process.env.MONITOR_COMPANY;

console.log('Environment check:');
console.log('- MONITOR_URL:', monitorUrl ? '✅' : '❌');
console.log('- MONITOR_USER:', monitorUsername ? '✅' : '❌');
console.log('- MONITOR_PASS:', monitorPassword ? '✅' : '❌');
console.log('- MONITOR_COMPANY:', monitorCompany ? '✅' : '❌');

const agent = new https.Agent({ rejectUnauthorized: false });
let sessionId = null;

async function login() {
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
      throw new Error(`Login failed: ${res.status}`);
    }

    const sessionIdFromHeader = res.headers.get("x-monitor-sessionid") || res.headers.get("X-Monitor-SessionId");
    const data = await res.json();
    sessionId = sessionIdFromHeader || data.SessionId;
    
    console.log(`✅ Login successful, SessionId: ${sessionId.substring(0, 8)}...`);
    return sessionId;
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    throw error;
  }
}

// Check what price lists exist
async function checkPriceLists() {
  try {
    await login();
    
    const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/PriceLists`;
    console.log('\n🔍 Fetching all price lists...');
    
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Monitor-SessionId": sessionId,
      },
      agent,
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch price lists: ${res.status} ${res.statusText}`);
    }

    const priceLists = await res.json();
    console.log(`\n📋 Found ${priceLists.length} price lists:`);
    
    priceLists.forEach((list, index) => {
      console.log(`${index + 1}. ID: ${list.Id} | Name: ${list.Name} | Description: ${list.Description || 'No description'}`);
    });
    
    return priceLists;
  } catch (error) {
    console.error('❌ Error fetching price lists:', error.message);
  }
}

// Check if our part exists in any price lists
async function checkPartInAllPriceLists(partId) {
  try {
    const priceLists = await checkPriceLists();
    
    console.log(`\n🔍 Checking if part ${partId} exists in any price lists...`);
    
    for (const priceList of priceLists) {
      console.log(`\n📊 Checking price list: ${priceList.Name} (ID: ${priceList.Id})`);
      
      const url = `${monitorUrl}/${monitorCompany}/api/v1/Sales/SalesPrices`;
      const filter = `?$filter=PartId eq '${partId}' and PriceListId eq '${priceList.Id}'`;
      
      const res = await fetch(url + filter, {
        headers: {
          Accept: "application/json",
          "X-Monitor-SessionId": sessionId,
        },
        agent,
      });

      if (res.ok) {
        const prices = await res.json();
        if (prices.length > 0) {
          console.log(`✅ Found ${prices.length} price(s) in ${priceList.Name}:`);
          prices.forEach(price => {
            console.log(`   - Price: ${price.Price}, Currency: ${price.CurrencyCode}, Valid from: ${price.ValidFrom}`);
          });
        } else {
          console.log(`❌ No prices found in ${priceList.Name}`);
        }
      } else {
        console.log(`❌ Error checking ${priceList.Name}: ${res.status}`);
      }
    }
  } catch (error) {
    console.error('❌ Error checking part in price lists:', error.message);
  }
}

// Main execution
async function main() {
  const partId = "1058501022675359080"; // The part ID we're testing
  console.log(`🚀 Debug Monitor API - Checking part ${partId}`);
  
  await checkPartInAllPriceLists(partId);
}

main().catch(console.error);
