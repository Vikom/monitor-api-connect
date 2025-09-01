// Quick test script to verify the EntityChangeLogs function
import { fetchEntityChangeLogsFromMonitor } from "./app/utils/monitor.js";
import dotenv from "dotenv";

dotenv.config();

async function testChangeLogs() {
  try {
    console.log("🧪 Testing EntityChangeLogs function...");
    const changedProductIds = await fetchEntityChangeLogsFromMonitor();
    console.log(`✅ Successfully fetched ${changedProductIds.length} changed product IDs`);
    if (changedProductIds.length > 0) {
      console.log("Sample IDs:", changedProductIds.slice(0, 5));
    }
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testChangeLogs();
