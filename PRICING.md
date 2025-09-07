# Monitor API Pricing Integration

This document explains how the hierarchical pricing system works with your Shopify store and Monitor API integration.

## Overview

The pricing system implements a 3-tier hierarchy for **logged-in customers only**:

1. **Outlet Products**: Products in the outlet product group (ID: `1229581166640460381`) get special outlet prices from price list `1289997006982727753`
2. **Customer-Specific Pricing**: Individual customer prices for specific products
3. **Price List Pricing**: Customer's assigned price list pricing

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

**POST** `/api/pricing-public` (for theme integration)

#### Price Request (Customer Required)

```javascript
{
  "variantId": "gid://shopify/ProductVariant/123456789",
  "customerId": "gid://shopify/Customer/987654321", // required
  "shop": "your-shop-name" // required for CORS requests
}
```

**POST** `/api/pricing` (for internal app use)

#### Price Request (Customer Required)

```javascript
{
  "variantId": "gid://shopify/ProductVariant/123456789",
  "customerId": "gid://shopify/Customer/987654321" // required
}
```

### Theme Integration

Include the pricing client in your theme:

```liquid
{% if customer %}
<script>
  window.customer = {
    id: {{ customer.id | json }},
    email: {{ customer.email | json }},
    first_name: {{ customer.first_name | json }},
    last_name: {{ customer.last_name | json }}
  };
  // Set your app URL for pricing API calls
  window.pricingApiUrl = "monitor-api-connect-production.up.railway.app";
  
  // Set product information for pricing
  window.currentVariantMonitorId = "{{ product.selected_or_first_available_variant.metafields.custom.monitor_id }}";
  window.isOutletProduct = {% if collections['outlet'] contains product %}true{% else %}false{% endif %};
  
  // Debug outlet detection
  console.log('=== OUTLET DETECTION DEBUG ===');
  console.log('Product title:', "{{ product.title }}");
  console.log('Product in outlet collection:', window.isOutletProduct);
  console.log('Current variant Monitor ID:', window.currentVariantMonitorId);
  console.log('Collections containing this product:', [
    {% for collection in product.collections %}
      "{{ collection.handle }}"{% unless forloop.last %},{% endunless %}
    {% endfor %}
  ]);
  console.log('=== END OUTLET DEBUG ===');
</script>
{% endif %}

<!-- Pricing Integration - Non-blocking script loading -->
<script src="{{ 'pricing-client.js' | asset_url }}" defer></script>
<script>
// Debug customer login status
console.log('Customer object:', window.customer);
console.log('Customer ID:', window.customer?.id);

// Debug outlet product detection
console.log('=== PRICING DEBUG INFO ===');
console.log('Current variant Monitor ID:', window.currentVariantMonitorId);
console.log('Is outlet product:', window.isOutletProduct);
console.log('API URL:', window.pricingApiUrl);
console.log('=== END PRICING DEBUG ===');

// Update product page price - customer must be logged in
window.addEventListener('DOMContentLoaded', async () => {
  // Wait for pricing-client.js to load
  while (typeof updatePriceDisplay === 'undefined') {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  if (!window.customer?.id) {
    console.log('Customer not logged in - no pricing available');
    console.log('Available customer data:', window.customer);
    return;
  }
  
  const variantId = 'gid://shopify/ProductVariant/{{ product.selected_or_first_available_variant.id }}';
  const customerId = `gid://shopify/Customer/${window.customer.id}`;
  
  console.log('Attempting to update price for:', { variantId, customerId });
  await updatePriceDisplay(variantId, '.f-price-item--regular', customerId);
});

// On variant change
document.addEventListener('variant:change', async (event) => {
  if (!window.customer?.id) return;
  
  const variantId = event.detail.variantId;
  const customerId = `gid://shopify/Customer/${window.customer.id}`;
  
  console.log('Variant changed:', { variantId, customerId });
  await updatePriceDisplay(variantId, '.f-price-item--regular', customerId);
});

// Alternative event listener for themes that don't use 'variant:change'
document.addEventListener('change', async (event) => {
  if (event.target.name === 'id' && window.customer?.id) {
    const variantId = `gid://shopify/ProductVariant/${event.target.value}`;
    const customerId = `gid://shopify/Customer/${window.customer.id}`;
    
    console.log('Variant selector changed:', { variantId, customerId });
    await updatePriceDisplay(variantId, '.f-price-item--regular', customerId);
  }
});
</script>
```

## Required Metafields

### Product Variants

- **Namespace**: `custom`
- **Key**: `monitor_id`

## Troubleshooting

### "Customer not logged in" message

1. **Customer object undefined**: If `window.customer` shows as `undefined`, your theme doesn't automatically load the customer object. This is common with many themes including Hyper.

2. **Solution - Add customer object to theme**: Add this to your theme's layout file (`theme.liquid`) in the `<head>` section:

```liquid
{% if customer %}
<script>
  window.customer = {
    id: {{ customer.id | json }},
    email: {{ customer.email | json }},
    first_name: {{ customer.first_name | json }},
    last_name: {{ customer.last_name | json }}
  };
</script>
{% endif %}
```

3. **Alternative solution for product pages**: If you only need it on product pages, add to your `main-product.liquid`:

```liquid
{% if customer %}
<script>
  window.customer = {
    id: {{ customer.id | json }},
    email: {{ customer.email | json }},
    first_name: {{ customer.first_name | json }},
    last_name: {{ customer.last_name | json }}
  };
</script>
{% endif %}
<!-- Then your pricing script... -->
<script src="{{ 'pricing-client.js' | asset_url }}" defer></script>
<script>
// Rest of your pricing code...
</script>
```

4. **Verify login status**: Ensure you're testing while logged into a customer account, not just the admin/staff account.

### Price shows as "0" 

1. **Check price selector**: The default `.f-price-item--regular` selector should work with Hyper theme. Alternative selectors to try:
   - `.f-price-item--sale` (for sale prices)
   - `.f-price-item` (general price items)
   - `[data-unit-price]` (for unit prices)

2. **Debug price element**: Add this to see what elements are found:
```javascript
const priceElements = document.querySelectorAll('[class*="price"], [data-price], .money');
console.log('Found price elements:', priceElements);
```

3. **Check Monitor ID metafield**: Ensure your product variants have the `custom.monitor_id` metafield set.

4. **Test API directly**: Test the pricing endpoint manually:
```bash
curl -X POST https://your-app-url/api/pricing \
  -H "Content-Type: application/json" \
  -d '{"variantId":"gid://shopify/ProductVariant/123","customerId":"gid://shopify/Customer/456"}'
```

### Common Theme Adjustments

#### For Hyper theme (your theme):
```liquid
await updatePriceDisplay(variantId, '.f-price-item--regular', customerId);
```

#### For Dawn theme:
```liquid
await updatePriceDisplay(variantId, '.price__current', customerId);
```

#### For Debut theme:
```liquid  
await updatePriceDisplay(variantId, '.product-single__price', customerId);
```

#### For custom themes:
Inspect your theme's price element and adjust the selector accordingly.
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
