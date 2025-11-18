import "@shopify/shopify-api/adapters/node";
// import cron from "node-cron"; // Uncomment when enabling cron scheduling
import dotenv from "dotenv";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { fetchCustomersFromMonitor, fetchCustomersByIdsFromMonitor, fetchEntityChangeLogsFromMonitor } from "./utils/monitor.js";
dotenv.config();

// Get command line arguments to determine which store to sync to
const args = process.argv.slice(2);
const useAdvancedStore = args.includes('--advanced') || args.includes('-a') || global.useAdvancedStore;
const isManualRun = args.includes('--manual') || args.includes('-m');
const isSingleTest = args.includes('--single-test') || args.includes('-s');

// Store this globally for cron access
global.useAdvancedStore = useAdvancedStore;

console.log(`🎯 Target store: ${useAdvancedStore ? 'Advanced Store' : 'Development Store'}`);
if (isManualRun) {
  console.log(`🔧 Manual run mode: ${isManualRun ? 'Enabled' : 'Disabled'}`);
}
if (isSingleTest) {
  console.log(`🧪 Single test mode: Only processing first customer`);
}

const shopifyConfig = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES?.split(","),
  hostName: process.env.SHOPIFY_APP_URL.replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});
if (!global.Shopify) global.Shopify = {};
global.Shopify.config = shopifyConfig.config;

// Helper function to validate if a session is still valid
async function validateSession(shop, accessToken) {
  const fetch = (await import('node-fetch')).default;
  
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
      console.error("Session validation failed:", result.errors);
      return false;
    }
    
    return result.data && result.data.shop;
  } catch (error) {
    console.error("Error validating session:", error);
    return false;
  }
}

export async function syncCustomers(isIncrementalSync = false) {
  let shop, accessToken;
  
  // Use global variable if set (from cron), otherwise use the original variable
  const currentUseAdvancedStore = global.useAdvancedStore !== undefined ? global.useAdvancedStore : useAdvancedStore;

  if (currentUseAdvancedStore) {
    // Use Advanced store configuration
    shop = process.env.ADVANCED_STORE_DOMAIN;
    accessToken = process.env.ADVANCED_STORE_ADMIN_TOKEN;

    if (!shop || !accessToken) {
      console.log("❌ Advanced store configuration missing!");
      console.log("Please ensure ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are set in your .env file");
      return;
    }

    console.log(`🔗 Using Advanced store: ${shop}`);
    
    // Validate the advanced store session
    const isValidSession = await validateSession(shop, accessToken);
    if (!isValidSession) {
      console.log("❌ Advanced store session is invalid.");
      console.log("Please check your ADVANCED_STORE_ADMIN_TOKEN in the .env file");
      return;
    }
  } else {
    // Use development store with OAuth (existing logic)
    const prisma = (await import("./db.server.js")).default;
    const session = await prisma.session.findFirst();
    if (!session) {
      console.log("No Shopify session found. Cannot sync customers.");
      return;
    }
    // Log session details for debugging
    console.log("Shopify session found:", {
      shop: session.shop,
      accessToken: session.accessToken ? "[REDACTED]" : null
    });
    if (!session.accessToken || !session.shop) {
      console.error("Shopify session is missing accessToken or shop. Cannot sync customers.");
      return;
    }

    // Validate the session by making a test API call
    const isValidSession = await validateSession(session.shop, session.accessToken);
    if (!isValidSession) {
      console.log("❌ Shopify session is invalid or expired.");
      console.log("To fix this:");
      console.log("1. Run 'npm run dev' to start the development server");
      console.log("2. Visit the app in your browser to re-authenticate");
      console.log("3. Once authenticated, you can run the sync job again");
      return;
    }
    shop = session.shop;
    accessToken = session.accessToken;
    console.log(`Using development store: ${shop}`);
  }

  console.log("✅ Store session is valid. Starting customers sync...");
  
  if (isIncrementalSync) {
    console.log("🔄 Running incremental sync (customers with changes in last 48 hours)");
  } else {
    console.log("🔄 Running full sync (all customers)");
  }

  let customers;
  try {
    if (isIncrementalSync) {
      // Get customer IDs that have changed in the last 48 hours
      // Look for both customer entity types: direct customers and references
      const customerEntityTypeId = '6bd51ec8-abd3-4032-ac43-8ddc15ca1fbc';
      const referenceEntityTypeId = '9a9b110e-d5b5-410d-afee-c397747eba77';
      
      const [changedCustomerIds, changedReferenceIds] = await Promise.all([
        fetchEntityChangeLogsFromMonitor(customerEntityTypeId),
        fetchEntityChangeLogsFromMonitor(referenceEntityTypeId)
      ]);

      // Combine and deduplicate the customer IDs
      const allChangedCustomerIds = [...new Set([...changedCustomerIds, ...changedReferenceIds])];

      if (allChangedCustomerIds.length === 0) {
        console.log("No customer changes detected in the last 48 hours.");
        return;
      }

      console.log(`Found ${allChangedCustomerIds.length} customers with changes (${changedCustomerIds.length} direct customers, ${changedReferenceIds.length} references), fetching their data...`);
      customers = await fetchCustomersByIdsFromMonitor(allChangedCustomerIds);
    } else {
      // Full sync - get all customers
      customers = await fetchCustomersFromMonitor();
    }

    console.log(`Fetched ${customers.length} customers with WEB-ACCOUNT references`);
    if (!Array.isArray(customers) || customers.length === 0) {
      console.log("No WEB-ACCOUNT customers found to sync.");
      return;
    }

    console.log("Sample customer data:", JSON.stringify(customers[0], null, 2));
  } catch (err) {
    console.error("Error fetching customers", err);
    return;
  }

  const fetch = (await import('node-fetch')).default;

  // Process only customers from references with "WEB-ACCOUNT" category
  let processedCount = 0;
  for (const customer of customers) {
    if (!customer.email || customer.email.trim() === "") {
      console.warn("Skipping customer with blank email:", customer);
      continue;
    }
    
    console.log(`Processing WEB-ACCOUNT customer: ${customer.email}`);
    
    // Check if customer exists by email
    const checkQuery = `query {
      customers(first: 1, query: "email:${customer.email}") {
        edges {
          node {
            id
            email
            firstName
            lastName
            addresses {
              id
              address1
              city
              zip
              company
            }
            metafields(first: 20, namespace: "custom") {
              edges {
                node {
                  id
                  key
                  value
                }
              }
            }
          }
        }
      }
    }`;
    
    const checkRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: checkQuery }),
    });
    
    const checkJson = await checkRes.json();
    
    if (checkJson.errors) {
      console.error("GraphQL errors checking customer:", JSON.stringify(checkJson.errors, null, 2));
      continue;
    }
    
    const existingCustomer = checkJson.data?.customers?.edges[0]?.node;
    const isUpdate = !!existingCustomer;
    
    let mutation, variables;

    if (isUpdate) {
      // Update existing customer
      console.log(`Updating existing customer: ${customer.email}`);
      console.log(`   Customer ID: ${existingCustomer.id}`);
      
      mutation = `mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            email
            firstName
            lastName
            phone
            addresses {
              address1
              address2
              city
              zip
              company
            }
            metafields(first: 15, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`;
      
      // For updates, we need to handle metafields differently - update existing ones or create new ones
      const metafields = [];
      
      // Check if each metafield already exists and update or create accordingly
      const existingMetafields = existingCustomer.metafields?.edges || [];
      
      const metafieldData = [
        { key: "monitor_id", value: customer.monitorId.toString() },
        { key: "discount_category", value: customer.discountCategory || "" },
        { key: "pricelist_id", value: customer.priceListId || "" },
        { key: "company", value: customer.company || "" }
      ];
      
      metafieldData.forEach(field => {
        const existingField = existingMetafields.find(edge => edge.node.key === field.key);
        if (existingField) {
          // Update existing metafield
          metafields.push({
            id: existingField.node.id,
            value: field.value,
            type: "single_line_text_field"
          });
        } else {
          // Create new metafield
          metafields.push({
            namespace: "custom",
            key: field.key,
            value: field.value,
            type: "single_line_text_field"
          });
        }
      });

      variables = {
        input: {
          id: existingCustomer.id,
          firstName: customer.firstName || "",
          lastName: customer.lastName || "",
          phone: customer.phone || undefined,
          note: customer.note || undefined,
          metafields: metafields
        }
      };
    } else {
      // Create new customer
      console.log(`Creating new customer: ${customer.email}`);
      
      mutation = `mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            firstName
            lastName
            phone
            addresses {
              address1
              address2
              city
              zip
              company
            }
            metafields(first: 15, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`;
      
      variables = {
        input: {
          email: customer.email,
          firstName: customer.firstName || "",
          lastName: customer.lastName || "",
          phone: customer.phone || undefined,
          note: customer.note || undefined,
          addresses: customer.address1 || customer.postalCode || customer.city ? [{
            address1: customer.address1 || "",
            zip: customer.postalCode || "",
            city: customer.city || "",
            company: customer.company || ""
          }] : undefined,
          metafields: [
            {
              namespace: "custom",
              key: "monitor_id",
              value: customer.monitorId.toString(),
              type: "single_line_text_field"
            },
            {
              namespace: "custom",
              key: "discount_category",
              value: customer.discountCategory || "",
              type: "single_line_text_field"
            },
            {
              namespace: "custom",
              key: "pricelist_id",
              value: customer.priceListId || "",
              type: "single_line_text_field"
            },
            {
              namespace: "custom",
              key: "company",
              value: customer.company || "",
              type: "single_line_text_field"
            }
          ]
        }
      };
    }
    
    const operationRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    
    if (!operationRes.ok) {
      console.error(`❌ HTTP Error ${operationRes.status}: ${operationRes.statusText}`);
      const errorText = await operationRes.text();
      console.error("Error response body:", errorText);
      continue;
    }
    
    let operationJson;
    try {
      operationJson = await operationRes.json();
    } catch (parseError) {
      console.error("❌ Failed to parse JSON response");
      const responseText = await operationRes.text();
      console.error("Raw response:", responseText);
      continue;
    }
    
    if (operationJson.errors) {
      console.error("Shopify GraphQL errors:", JSON.stringify(operationJson.errors, null, 2));
      continue;
    }
    
    // Get the customer data from either create or update response
    const customerData = isUpdate ? 
      operationJson.data?.customerUpdate?.customer : 
      operationJson.data?.customerCreate?.customer;
    
    const userErrors = isUpdate ? 
      operationJson.data?.customerUpdate?.userErrors : 
      operationJson.data?.customerCreate?.userErrors;
    
    if (customerData) {
      const action = isUpdate ? "updated" : "created";
      console.log(`✅ Successfully ${action} customer: ${customerData.email} (ID: ${customerData.id})`);
      console.log(`   Name: ${customerData.firstName} ${customerData.lastName}`);
      if (customerData.phone) {
        console.log(`   Phone: ${customerData.phone}`);
      }
      
      // For updates, check if we need to add/update address
      if (isUpdate && (customer.address1 || customer.postalCode || customer.city)) {
        const hasMatchingAddress = existingCustomer.addresses?.some(addr => 
          addr.address1 === customer.address1 && 
          addr.city === customer.city && 
          addr.zip === customer.postalCode
        );
        
        if (!hasMatchingAddress) {
          console.log(`🏠 Adding address for customer: ${customer.email}`);
          
          // Use customerUpdate to add addresses instead of customerAddressCreate
          const addressMutation = `mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer {
                id
                addresses {
                  id
                  address1
                  city
                  zip
                  company
                }
              }
              userErrors {
                field
                message
              }
            }
          }`;
          
          // Get existing addresses and add the new one
          const existingAddresses = existingCustomer.addresses || [];
          const newAddress = {
            address1: customer.address1 || "",
            zip: customer.postalCode || "",
            city: customer.city || "",
            company: customer.company || ""
          };
          
          const addressVariables = {
            input: {
              id: customerData.id,
              addresses: [...existingAddresses, newAddress]
            }
          };
          
          const addressRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ query: addressMutation, variables: addressVariables }),
          });
          
          if (!addressRes.ok) {
            console.error(`   ❌ Address HTTP Error ${addressRes.status}: ${addressRes.statusText}`);
            const errorText = await addressRes.text();
            console.error("   Address error response body:", errorText);
            continue;
          }
          
          let addressJson;
          try {
            addressJson = await addressRes.json();
          } catch (parseError) {
            console.error("   ❌ Failed to parse address JSON response");
            const responseText = await addressRes.text();
            console.error("   Raw address response:", responseText);
            continue;
          }
          
          if (addressJson.errors) {
            console.error("   ❌ Error adding address:", JSON.stringify(addressJson.errors, null, 2));
          } else if (addressJson.data?.customerUpdate?.customer?.addresses) {
            console.log("   ✅ Address added successfully");
          } else if (addressJson.data?.customerUpdate?.userErrors?.length > 0) {
            console.log(`   ❌ Address error: ${addressJson.data.customerUpdate.userErrors.map(e => e.message).join(", ")}`);
          }
        }
      }
      
      // Log addresses if they exist
      const addresses = customerData.addresses || [];
      if (addresses.length > 0) {
        console.log(`   Addresses:`);
        addresses.forEach((address, index) => {
          console.log(`     Address ${index + 1}:`);
          if (address.company) console.log(`       Company: ${address.company}`);
          if (address.address1) console.log(`       Street: ${address.address1}`);
          if (address.city) console.log(`       City: ${address.city}`);
          if (address.zip) console.log(`       Postal Code: ${address.zip}`);
        });
      }
      
      // Log metafields if they exist
      const metafields = customerData.metafields?.edges || [];
      if (metafields.length > 0) {
        console.log(`   Metafields:`);
        metafields.forEach(edge => {
          console.log(`     ${edge.node.key}: ${edge.node.value}`);
        });
      }
    } else if (userErrors && userErrors.length > 0) {
      const action = isUpdate ? "updating" : "creating";
      console.log(`❌ User error ${action} customer: ${userErrors.map(e => e.message).join(", ")}`);
    } else {
      console.log("❌ Unknown error:", JSON.stringify(operationJson, null, 2));
    }
    
    processedCount++;
    
    // In single test mode, only process the first customer
    if (isSingleTest) {
      console.log("🧪 Single test mode: Stopping after first customer");
      break;
    }
  }
}

// Only run when executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  // Display usage instructions
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Customers Sync Job Usage:

To sync to development store (OAuth):
  node app/syncCustomersJob.js                    # Full sync (WEB-ACCOUNT customers only)
  node app/syncCustomersJob.js --manual           # Full sync (manual mode)
  node app/syncCustomersJob.js --single-test      # Test with first customer only

To sync to Advanced store:
  node app/syncCustomersJob.js --advanced --manual # Full sync to advanced store
  node app/syncCustomersJob.js --advanced --manual --single-test # Test with first customer

For scheduled syncs, use the worker:
  node app/worker.js

Configuration:
  Development store: Uses Prisma session from OAuth flow
  Advanced store: Uses ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN from .env

Sync types:
  Incremental: Only syncs customers that have changed in the last 48 hours
  Full (manual): Syncs all customers regardless of changes

Flags:
  --single-test (-s): Only process the first customer found (useful for testing)
  --manual (-m): Force full sync mode
  --advanced (-a): Use advanced store configuration

Filtering:
  Only customer references with Category="WEB-ACCOUNT" will be synced to Shopify.
  Regular customer references without this category are ignored.

Data synced:
  - Customer name (from reference Name field)
  - Email address
  - Phone number
  - Company name
  - Address (street, postal code, city from ActiveDeliveryAddress)
  - Monitor ID, discount category, and price list ID as metafields

Behavior:
  - Creates new customers if they don't exist
  - Updates existing customers with latest data from Monitor
  - Adds missing addresses to existing customers

Make sure your .env file is configured properly before running.
  `);
  process.exit(0);
}

console.log(`
🚀 Starting Customers Sync Job
📝 Use --help for usage instructions
💡 For scheduled syncs, use: node app/worker.js
`);

// Only allow manual execution when run directly
if (!isManualRun && useAdvancedStore) {
  console.log("⚠️  For automated scheduling, please use: node app/worker.js");
  console.log("⚠️  Direct execution without --manual flag is not recommended for advanced store");
  console.log("🚀 Running incremental sync anyway...");
}

// Determine sync type based on flags
const isFullSync = isManualRun || !useAdvancedStore; // Manual mode or dev store = full sync
const syncType = isFullSync ? "full sync" : "incremental sync";
const testMode = isSingleTest ? " (single test mode)" : "";
console.log(`🚀 Running ${syncType}${testMode}...`);

// Run the sync
syncCustomers(!isFullSync); // !isFullSync = incremental sync for advanced store without manual flag
}
