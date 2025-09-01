# Product Sync Job Enhancement - Summary

## Changes Made

### 1. New Functions in monitor.js

#### fetchEntityChangeLogsFromMonitor()
- Fetches entity change logs from Monitor's `Common/EntityChangeLogs` endpoint
- Filters for product changes (`EntityTypeId eq '322cf0ac-10de-45ee-a792-f0944329d198'`) in the last 48 hours
- Returns an array of unique product IDs that have changed
- Uses proper ISO timestamp format for filtering

#### fetchProductsByIdsFromMonitor(productIds)
- Fetches specific products by their IDs from Monitor
- Uses OData filter with multiple IDs: `Id eq 'id1' or Id eq 'id2' or ...`
- Applies the same filtering and processing logic as the full product sync
- Returns processed products with pricing logic applied

#### MonitorClient.fetchProductsByIds(productIds)
- Internal method to fetch products by specific IDs
- Similar to `fetchProducts()` but with ID-based filtering
- Includes all the same field selections and expansions

### 2. Enhanced syncProductsJob.js

#### Incremental Sync Support
- Added `isIncrementalSync` parameter to `syncProducts()` function
- When true, fetches only changed products using `fetchEntityChangeLogsFromMonitor()`
- When false, runs full sync as before (existing behavior)

#### Cron Scheduling
- Uncommented and enhanced the cron schedule to run every hour (`"0 * * * *"`)
- **Only runs for Advanced Store** (checks for ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN)
- **Only runs incremental sync** (changed products in last 48 hours)
- Includes proper error handling and logging for cron runs

#### Global Variable Management
- Added `global.useAdvancedStore` to allow cron job to access store configuration
- Temporary override during cron runs to ensure Advanced Store is used
- Proper restoration of original flags after cron completion

### 3. Enhanced Help Documentation
- Updated help message to clearly indicate full sync vs. scheduled incremental sync
- Added information about automatic hourly scheduling for Advanced Store
- Clarified that manual runs sync ALL products, while cron runs sync only changes

## Usage

### Manual Full Sync (All Products)
```bash
# Development Store (OAuth)
node app/syncProductsJob.js

# Advanced Store
node app/syncProductsJob.js --advanced
```

### Automatic Scheduled Sync (Changes Only)
- Runs every hour automatically
- Only for Advanced Store (requires ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN in .env)
- Only syncs products that have changed in the last 48 hours
- No manual intervention required

## Configuration Requirements

### For Development Store
- Prisma session from OAuth flow
- Standard Shopify app authentication

### For Advanced Store  
- `ADVANCED_STORE_DOMAIN` in .env
- `ADVANCED_STORE_ADMIN_TOKEN` in .env

### For Monitor API
- `MONITOR_URL`, `MONITOR_USER`, `MONITOR_PASS`, `MONITOR_COMPANY` in .env
- Access to `Common/EntityChangeLogs` endpoint

## Benefits

1. **Efficiency**: Scheduled sync only processes changed products instead of all products
2. **Automation**: No manual intervention needed for keeping products up to date
3. **Flexibility**: Manual runs still sync all products when needed
4. **Store-Specific**: Cron only runs for Advanced Store to avoid conflicts
5. **Error Handling**: Proper logging and error recovery for scheduled runs

## Technical Notes

- EntityTypeId `322cf0ac-10de-45ee-a792-f0944329d198` represents product entities in Monitor
- 48-hour lookback ensures no changes are missed even if a scheduled run fails
- Removed `$orderby` clause from API calls to avoid SQL Server limitations
- Uses ISO timestamp format for proper date filtering in Monitor API
