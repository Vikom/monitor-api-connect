# Monitor API Pricing Integration

This document explains how the hierarchical pricing system works with your Shopify store and Monitor API integration.

## Overview

The pricing system implements a 3-tier hierarchy for **logged-in customers only**:

1. **Outlet Products**: Products in the outlet product group (ID: `1229581166640460381`) get special outlet prices from price list `1289997006982727753`
2. **Customer-Specific Pricing**: Individual customer prices for specific products
3. **Price List Pricing**: Customer's assigned price list pricing
4. **Standard Pricing**: Fallback to product's standard price

**Important**: All customers must be logged in. No anonymous/guest pricing is supported.

## How It Works

### 1. Product Sync (Outlet Pricing)

During the product sync job (`fetchProductsFromMonitor`), products in the outlet group automatically get their outlet prices fetched and set as the product price in Shopify. This reduces API calls during customer browsing.

### 2. Dynamic Pricing (Customer-Specific & Price List)

For logged-in customers, the system checks for:

- Customer-specific prices via `CustomerPartLinks` endpoint
- Customer's price list prices via `SalesPrices` endpoint with the customer's `PriceListId`

## Implementation Files

### Core Files

- **`app/utils/monitor.js`**: Contains all Monitor API functions including pricing functions
- **`app/utils/pricing.js`**: High-level pricing logic for logged-in customers
- **`app/routes/api.pricing.js`**: Shopify API route for getting dynamic prices (requires customer ID)
- **`public/pricing-client.js`**: Client-side helper functions for themes (customer required)

### Test Files

- **`test-pricing.js`**: Test script for verifying pricing functions

## API Functions

### Monitor API Functions

```javascript
// Get outlet price for a product
const outletPrice = await fetchOutletPriceFromMonitor(partId);

// Get customer-specific price
const customerPrice = await fetchCustomerPriceFromMonitor(customerId, partId);

// Get price from customer's price list
const priceListPrice = await fetchPriceListPriceFromMonitor(priceListId, partId);

// Get customer details (including PriceListId)
const customer = await fetchCustomerFromMonitor(customerId);
```

### Pricing Logic Functions

```javascript
// Get dynamic price with full hierarchy logic (customer required)
const price = await getDynamicPrice(variantMonitorId, customerMonitorId, fallbackPrice);
```

## Shopify Integration

### API Endpoint

**POST** `/api/pricing`

#### Price Request (Customer Required)

```javascript
{
  "variantId": "gid://shopify/ProductVariant/123456789",
  "customerId": "gid://shopify/Customer/987654321" // required
}
```

### Theme Integration

Include the pricing client in your theme:

```html
<script src="/pricing-client.js"></script>
<script>
// Update product page price - customer must be logged in
window.addEventListener('DOMContentLoaded', async () => {
  if (!window.customer?.id) {
    console.log('Customer not logged in - no pricing available');
    return;
  }
  
  const variantId = 'gid://shopify/ProductVariant/123456789';
  const customerId = `gid://shopify/Customer/${window.customer.id}`;
  
  await updatePriceDisplay(variantId, '.price', customerId);
});

// On variant change
document.addEventListener('variant:change', async (event) => {
  if (!window.customer?.id) return;
  
  const variantId = event.detail.variantId;
  const customerId = `gid://shopify/Customer/${window.customer.id}`;
  
  await updatePriceDisplay(variantId, '.price', customerId);
});
</script>
```

## Required Metafields

### Product Variants

- **Namespace**: `custom`
- **Key**: `monitor_id`
- **Value**: Monitor Part ID

### Customers

- **Namespace**: `custom`
- **Key**: `monitor_id`
- **Value**: Monitor Customer ID

## Testing

1. Update `test-pricing.js` with real Monitor IDs
2. Run: `node test-pricing.js`

## Configuration

### Environment Variables

```env
MONITOR_URL=https://your-monitor-instance
MONITOR_USER=your-username
MONITOR_PASS=your-password
MONITOR_COMPANY=your-company-code
```

### Hard-coded Constants

- **Outlet Product Group ID**: `1229581166640460381`
- **Outlet Price List ID**: `1289997006982727753`

## Pricing Flow Diagram

```text
Customer views product
         ↓
Is customer logged in?
    ↓               ↓
   No              Yes
    ↓               ↓
No pricing         Get customer's
available          Monitor ID
                    ↓
               Check customer-specific
               price (CustomerPartLinks)
                    ↓
               Found? → Return customer price
                    ↓ No
               Get customer's PriceListId
                    ↓
               Check price list price
               (SalesPrices)
                    ↓
               Found? → Return price list price
                    ↓ No
               Return outlet/standard price
```

## Performance Considerations

1. **Outlet prices** are fetched during sync, not on every request
2. **Customer-specific pricing** requires 1-2 API calls per product
3. **All customers must be logged in** - no anonymous browsing with prices
4. Consider caching customer prices for short periods

## Future Features

### Bulk Pricing

Bulk pricing functionality will be added in the future when the client wants to control bulk pricing from Monitor. The infrastructure is ready for this enhancement.

## Error Handling

All pricing functions gracefully fallback to standard prices if:

- Monitor API is unavailable
- Customer/product not found
- Network errors occur

## Next Steps

1. **Metafields are already set up** ✅
2. **Test the pricing functions** with real Monitor data
3. **Integrate pricing-client.js** into your Shopify theme
4. **Ensure customer login flow** works properly
5. **Monitor API usage** and optimize as needed
6. **Consider bulk pricing** implementation when ready
