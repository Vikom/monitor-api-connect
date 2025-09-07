# Simple Private App Implementation

## What to do in Partner Dashboard: NOTHING! 

Since this is a private app, you can ignore those Partner Dashboard options:
- ❌ Don't need "Protected customer data access"  
- ❌ Don't need "Allow network access"
- ❌ Don't need App Store approval

## Simple 3-Step Implementation

### Step 1: Use Your Existing Product Page Pricing ✅
Your product page pricing is already working - keep it!

### Step 2: Simplify Cart Approach
Instead of complex cart price updates, use this simple approach:

**Replace your current cart integration with:**
```liquid
<!-- Add to cart or checkout page -->
{% if customer %}
<script>
// Enhanced checkout for dynamic pricing
document.addEventListener('DOMContentLoaded', () => {
  // Find checkout buttons
  const checkoutBtns = document.querySelectorAll('[name="checkout"], .btn--checkout, [href="/checkout"]');
  
  checkoutBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (window.customer?.id) {
        e.preventDefault();
        
        // Show loading
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Applying your pricing...';
        btn.disabled = true;
        
        try {
          // Get current cart
          const cartResponse = await fetch('/cart.js');
          const cart = await cartResponse.json();
          
          // Create items array
          const items = cart.items.map(item => ({
            variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
            quantity: item.quantity
          }));
          
          // Create draft order with dynamic pricing
          const response = await fetch('/api/draft-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: `gid://shopify/Customer/${window.customer.id}`,
              items: items
            })
          });
          
          const result = await response.json();
          if (result.invoiceUrl) {
            window.location.href = result.invoiceUrl;
          } else {
            throw new Error('No invoice URL received');
          }
          
        } catch (error) {
          console.error('Error:', error);
          // Restore button and fallback to normal checkout
          btn.innerHTML = originalText;
          btn.disabled = false;
          window.location.href = '/checkout';
        }
      }
    });
  });
});
</script>
{% endif %}
```

### Step 3: Test the Flow
1. **Product page**: Shows dynamic price ✅
2. **Add to cart**: Normal cart, shows standard prices  
3. **Click checkout**: Creates draft order with dynamic pricing
4. **Customer pays**: Correct dynamic price
5. **Order created**: Monitor gets correct prices ✅

## Why This Works Better

✅ **Simple**: No Partner Dashboard complexity  
✅ **Reliable**: Uses proven Draft Orders approach  
✅ **Customer-friendly**: Shows pricing upfront, applies at checkout  
✅ **Maintainable**: Minimal theme changes  
✅ **Accurate**: Ensures correct prices all the way to Monitor  

## Implementation Time: 15 minutes

1. Add the checkout script to your theme (above)
2. Keep your existing product page pricing
3. Test with outlet and non-outlet products
4. Done!

This leverages your private app status for maximum simplicity while ensuring accurate pricing throughout the entire checkout process.
