# Simple Private App Implementation

## Simple 3-Step Implementation

### Step 1: Use Your Existing Product Page Pricing ✅
Your product page pricing is already working - keep it!

### Step 2: Simplify Cart Approach
Instead of complex cart price updates, use this simple approach:

**Replace your current cart integration with:**

**For Cart Drawer (add to your cart drawer template):**
```liquid
{% if customer %}
<script>
// Enhanced checkout for dynamic pricing - Cart Drawer
document.addEventListener('DOMContentLoaded', () => {
  // Target the specific checkout button in cart drawer
  const checkoutBtn = document.querySelector('.drawer__footer-buttons button[name="checkout"]');
  
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async (e) => {
      if (window.customer?.id) {
        e.preventDefault();
        
        // Show loading
        const btnText = checkoutBtn.querySelector('.btn__text');
        const originalText = btnText.innerHTML;
        btnText.innerHTML = 'Tillämpar dina priser...';
        checkoutBtn.disabled = true;
        
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
          btnText.innerHTML = originalText;
          checkoutBtn.disabled = false;
          window.location.href = '/checkout';
        }
      }
    });
  }
});
</script>
{% endif %}
```

**For Cart Page (add to your cart page template):**
```liquid
{% if customer %}
<script>
// Enhanced checkout for dynamic pricing - Cart Page
document.addEventListener('DOMContentLoaded', () => {
  // Target the specific checkout button in cart page footer
  const checkoutBtn = document.querySelector('.cart__footer--buttons button[name="checkout"]');
  
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async (e) => {
      if (window.customer?.id) {
        e.preventDefault();
        
        // Show loading
        const btnText = checkoutBtn.querySelector('.btn__text');
        const originalText = btnText.innerHTML;
        btnText.innerHTML = 'Tillämpar dina priser...';
        checkoutBtn.disabled = true;
        
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
          btnText.innerHTML = originalText;
          checkoutBtn.disabled = false;
          window.location.href = '/checkout';
        }
      }
    });
  }
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
