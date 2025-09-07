# Private App Dynamic Pricing Strategy

## Recommended Approach for Private Apps

Since this is a private app, you have much simpler options without App Store approval requirements.

## Strategy: Draft Orders + Visual Pricing

### Phase 1: Product Page Pricing (Working ✅)
- Show dynamic pricing on product pages
- Use existing `pricing-client.js`
- Customer sees correct price before adding to cart

### Phase 2: Cart + Checkout (Recommended)
- Let customers add items at standard prices
- Show notification about dynamic pricing
- At checkout, create Draft Order with correct dynamic pricing
- Redirect to Draft Order for payment

### Phase 3: Order Processing (Working ✅) 
- Order webhook ensures Monitor gets correct prices
- Customer pays correct dynamic price

## Implementation

### 1. Simplified Theme Integration
```liquid
<!-- Add to your theme -->
{% if customer %}
<script>
  window.customer = {{ customer | json }};
  window.customerMonitorId = "{{ customer.metafields.custom.monitor_id }}";
</script>

<!-- Load scripts -->
<script src="{{ 'pricing-client.js' | asset_url }}" defer></script>

<!-- Product page pricing -->
<script>
window.addEventListener('DOMContentLoaded', async () => {
  if (window.customer?.id) {
    const variantId = 'gid://shopify/ProductVariant/{{ product.selected_or_first_available_variant.id }}';
    const customerId = `gid://shopify/Customer/${window.customer.id}`;
    await updatePriceDisplay(variantId, '.f-price-item--regular', customerId);
  }
});
</script>
{% endif %}
```

### 2. Enhanced Checkout Button
```liquid
<!-- Replace standard checkout with dynamic pricing checkout -->
<script>
document.addEventListener('DOMContentLoaded', () => {
  const checkoutBtns = document.querySelectorAll('button[name="checkout"], .btn--checkout');
  
  checkoutBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (window.customer?.id) {
        e.preventDefault();
        
        // Show loading
        btn.innerHTML = 'Applying dynamic pricing...';
        btn.disabled = true;
        
        try {
          // Create draft order with dynamic pricing
          const response = await fetch('/api/draft-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: `gid://shopify/Customer/${window.customer.id}`,
              useCartItems: true
            })
          });
          
          const result = await response.json();
          if (result.invoiceUrl) {
            window.location.href = result.invoiceUrl;
          } else {
            // Fallback to normal checkout
            window.location.href = '/checkout';
          }
          
        } catch (error) {
          console.error('Error creating dynamic pricing checkout:', error);
          // Fallback to normal checkout
          window.location.href = '/checkout';
        }
      }
    });
  });
});
</script>
```

## Benefits of This Approach

✅ **No Partner Dashboard complexity** - Private app simplicity  
✅ **Works with any theme** - Minimal theme changes needed  
✅ **Reliable pricing** - Draft Orders ensure correct prices  
✅ **Easy to maintain** - Uses your existing API endpoints  
✅ **Customer-friendly** - Shows pricing upfront, applies at checkout  

## Next Steps

1. **Update your Draft Order API** to accept `useCartItems: true`
2. **Add simple theme integration** (above code)
3. **Test the flow**: Product → Cart → Dynamic Checkout → Order
4. **Remove complex cart-pricing.js** once this works

This approach leverages your private app status for maximum simplicity while ensuring pricing accuracy throughout the checkout process.
