# Inventory Sync Job

This application includes an automated inventory synchronization job that keeps Shopify product inventory levels in sync with Monitor API stock data.

## How it works

The `syncInventoryJob.js` file performs the following operations:

1. **Validates Shopify Session**: Ensures the Shopify session is valid and not expired
2. **Fetches Shopify Locations**: Gets all Shopify locations that have a `custom.monitor_id` metafield
3. **Fetches Products with Monitor IDs**: Gets all Shopify product variants that have a `custom.monitor_id` metafield
4. **Fetches Stock Data**: For each product variant, queries the Monitor API `/api/v1/Inventory/StockTransactions` endpoint to get current stock levels
5. **Updates Shopify Inventory**: Updates the inventory levels in Shopify for the appropriate location

## Prerequisites

Before running the inventory sync job:

1. **Required Shopify Scopes**: Ensure your app has the `read_locations` and `write_inventory` scopes configured in `shopify.app.toml`
2. **Products must be synced first**: Run the product sync job to ensure products exist in Shopify with proper `custom.monitor_id` metafields
3. **Locations must be mapped**: Set up Shopify locations with `custom.monitor_id` metafields that correspond to Monitor warehouse IDs
4. **Valid Shopify session**: The app must be authenticated with Shopify

## Running the job

### Manual execution
```bash
node app/syncInventoryJob.js
```

### Automated execution (cron)
To enable automatic execution every 15 minutes, uncomment the cron schedule lines in `syncInventoryJob.js`:

```javascript
// Uncomment these lines:
import cron from "node-cron";

// And this block:
cron.schedule("*/15 * * * *", () => {
  console.log("[CRON] Syncing inventory from Monitor to Shopify...");
  syncInventory();
});
```

## Configuration

The job uses the same environment variables as the main application:
- `MONITOR_URL`
- `MONITOR_COMPANY`
- `MONITOR_USER`
- `MONITOR_PASS`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`

## Location Mapping

For the inventory sync to work, you need to set up location mapping between Monitor warehouses and Shopify locations:

1. In Shopify Admin, go to Settings > Locations
2. For each location, add a metafield:
   - Namespace: `custom`
   - Key: `monitor_id`
   - Value: The corresponding Monitor warehouse ID

## Logging

The job provides detailed console logging showing:
- Session validation status
- Number of locations and products found
- Individual product processing results
- Success/error counts
- Current stock levels and updates

## Error Handling

The job includes robust error handling:
- Session validation and re-authentication
- Individual product error isolation (one failure doesn't stop the entire sync)
- Detailed error logging for troubleshooting
- Graceful handling of missing mappings or data

## Monitor API Integration

The job queries the Monitor API endpoint:
```
GET /api/v1/Inventory/StockTransactions?$filter=PartId eq '{partId}'&$orderby=LoggingTimeStamp desc&$top=1
```

This gets the most recent stock transaction to determine the current balance (`BalanceOnPartAfterChange`) for each product.
