import { createOrderInMonitor } from "./app/utils/monitor.js";
import dotenv from "dotenv";

dotenv.config();

// Test data for creating an order in Monitor
const testOrderData = {
  CustomerId: 1, // Replace with a valid customer ID from Monitor
  OrderNumber: null, // Let Monitor generate the order number
  OrderTypeId: 4, // As specified in requirements
  Rows: [
    {
      PartId: 1, // Replace with a valid part ID from Monitor
      Quantity: 2,
      UnitPrice: 100.00
    }
  ],
  IsStockOrder: false
};

async function testCreateOrder() {
  try {
    console.log("Testing Monitor order creation...");
    console.log("Order data:", JSON.stringify(testOrderData, null, 2));
    
    const monitorOrderId = await createOrderInMonitor(testOrderData);
    
    if (monitorOrderId) {
      console.log(`✅ Successfully created test order in Monitor with ID: ${monitorOrderId}`);
    } else {
      console.error(`❌ Failed to create test order in Monitor`);
    }
  } catch (error) {
    console.error("Error testing order creation:", error);
  }
}

console.log(`
🧪 Monitor Order Creation Test
⚠️  Make sure to update CustomerId and PartId with valid values from your Monitor instance before running this test.
`);

// Uncomment the line below when you have valid test data
// testCreateOrder();

console.log(`
📝 To run this test:
1. Update CustomerId and PartId with valid values from Monitor
2. Uncomment the testCreateOrder() call at the bottom of this file
3. Run: node test-monitor-order.js
`);
