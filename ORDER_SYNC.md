# Order Sync to Monitor

This document describes the webhook system that automatically sends Shopify orders to Monitor when they are created.

## Files Created/Modified

1. **`app/routes/webhooks.orders.create.jsx`** - Webhook handler for order creation
2. **`app/utils/monitor.js`** - Added `createOrderInMonitor()` function
3. **`shopify.app.toml`** - Added webhook subscription for `orders/create`
4. **`test-monitor-order.js`** - Test script for Monitor order creation

## How It Works

1. When an order is created in Shopify, the webhook is triggered
2. The webhook handler extracts customer and line item information
3. It fetches the customer's `custom.monitor_id` metafield to get the Monitor customer ID
4. It fetches each variant's `custom.monitor_id` metafield to get the Monitor part IDs
5. It creates an order in Monitor with:
   - `OrderTypeId`: 4 (as specified)
   - `CustomerId`: From customer's metafield
   - `Rows`: Array of line items with Monitor part IDs

## Required Metafields

For the order sync to work, you need these metafields:

### Customer Metafields
- `custom.monitor_id` - The customer's ID in Monitor

### Product Variant Metafields  
- `custom.monitor_id` - The product's part ID in Monitor

## Configuration

The webhook is configured in `shopify.app.toml`:

```toml
[[webhooks.subscriptions]]
topics = [ "orders/create" ]
uri = "/webhooks/orders/create"
```

## Testing

1. Test the Monitor API function:
   ```bash
   # Update CustomerId and PartId in test-monitor-order.js with valid values
   node test-monitor-order.js
   ```

2. Test the full webhook:
   - Create a customer with a `custom.monitor_id` metafield
   - Create products with variants that have `custom.monitor_id` metafields
   - Place an order with those products
   - Check the webhook logs and Monitor for the created order

## Error Handling

The webhook handles these scenarios gracefully:

- **No customer**: Skips sync and returns 200
- **Customer has no monitor_id**: Skips sync and returns 200  
- **Variant has no monitor_id**: Skips that line item
- **No valid line items**: Skips sync and returns 200
- **Monitor API errors**: Logs error and returns 500

## Monitor API Response

The Monitor API returns an `EntityCommandResponse` with:
- `RootEntityId`: The ID of the created order
- `EntityId`: Same as RootEntityId

## Deployment

After making these changes:

1. Deploy the app to update webhook subscriptions:
   ```bash
   npm run deploy
   ```

2. Or for development:
   ```bash
   npm run dev
   ```

The webhook will automatically be registered with Shopify when the app starts.
