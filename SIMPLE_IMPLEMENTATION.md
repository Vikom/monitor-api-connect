# Simple Private App Implementation

## Simple 3-Step Implementation

### Step 1: Use Your Existing Product Page Pricing ✅
Your product page pricing is already working - keep it!

### Step 2: Cart Integration with Dynamic Pricing
Show dynamic prices everywhere and use draft orders for checkout accuracy:

**For Cart Drawer (add to your cart drawer template):**
```liquid
{% if customer %}
<script>
// Set up customer object first
window.customer = {
  id: {{ customer.id | json }},
  email: {{ customer.email | json }},
  first_name: {{ customer.first_name | json }},
  last_name: {{ customer.last_name | json }}
};

// Enhanced checkout for dynamic pricing - Cart Drawer
document.addEventListener('DOMContentLoaded', () => {
  // Function to update cart prices
  async function updateCartPrices() {
    if (!window.customer?.id) return;
    
    console.log('Updating cart drawer prices...');
    
    try {
      // Get cart items
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      let cartTotal = 0;
      
      // Update each cart item price
      for (const item of cart.items) {
        const variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
        const customerId = `gid://shopify/Customer/${window.customer.id}`;
        
        console.log(`Getting price for variant ${item.variant_id}`);
        
        // Get dynamic price - let the API fetch metafields server-side
        const apiUrl = 'https://monitor-api-connect-production.up.railway.app/api/pricing-public';
        const priceResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId: variantId,
            customerId: customerId,
            shop: window.Shopify?.shop?.domain || window.location.hostname,
            // Let the API fetch these from Shopify Admin API
            monitorId: null,
            isOutletProduct: null,
            customerMonitorId: null,
            // Add a flag to tell API to fetch metafields
            fetchMetafields: true
          })
        });
        
        console.log(`Price response status: ${priceResponse.status}`);
        
        if (!priceResponse.ok) {
          console.error(`Price API error: ${priceResponse.status} ${priceResponse.statusText}`);
          continue; // Skip this item
        }
        
        const responseText = await priceResponse.text();
        console.log(`Price response text: ${responseText}`);
        
        let priceData;
        try {
          priceData = JSON.parse(responseText);
        } catch (parseError) {
          console.error(`JSON parse error for variant ${item.variant_id}:`, parseError);
          console.error(`Response text was: ${responseText}`);
          continue; // Skip this item
        }
        
        if (priceData.price !== null && priceData.price !== undefined) {
          cartTotal += priceData.price * item.quantity;
          
          console.log(`Updated price for ${item.variant_id}: ${priceData.price} kr`);
          
          // Find the specific cart item by data-variant-id
          const cartItem = document.querySelector(`li[data-variant-id="${item.variant_id}"]`);
          if (cartItem) {
            // Update the main price display - target the .price element specifically
            const priceElement = cartItem.querySelector('.cart-item__prices .price');
            if (priceElement) {
              // Keep the existing structure but update the price value
              const hasDiscount = priceElement.classList.contains('price--on-sale');
              if (hasDiscount) {
                // Update the sale price span
                const salePriceSpan = priceElement.querySelector('.price__regular');
                if (salePriceSpan) {
                  salePriceSpan.textContent = `${priceData.price} kr`;
                }
              } else {
                // Update the regular price
                priceElement.innerHTML = `${priceData.price} kr`;
              }
            }
          }
        }
      }
      
      // Update cart total display
      const totalElement = document.querySelector('.totals__subtotal-value');
      if (totalElement && cartTotal > 0) {
        totalElement.textContent = `${cartTotal} kr`;
        console.log(`Updated cart total: ${cartTotal} kr`);
      }
      
    } catch (error) {
      console.error('Error updating cart prices:', error);
    }
  }
  
  // Update prices when cart drawer opens
  const cartDrawer = document.querySelector('#CartDrawer');
  if (cartDrawer) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
          if (!cartDrawer.hasAttribute('hidden')) {
            console.log('Cart drawer opened, updating prices...');
            setTimeout(updateCartPrices, 200); // Small delay to ensure cart is loaded
          }
        }
      });
    });
    observer.observe(cartDrawer, { attributes: true });
  }
  
  // Also update when cart items change
  document.addEventListener('cart:updated', () => {
    console.log('Cart updated event, refreshing prices...');
    setTimeout(updateCartPrices, 100);
  });
  
  // Initial update if drawer is already open
  if (cartDrawer && !cartDrawer.hasAttribute('hidden')) {
    setTimeout(updateCartPrices, 500);
  }
  
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
          
          console.log('Creating draft order with items:', items);
          
          // Create draft order with dynamic pricing
          const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/draft-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: `gid://shopify/Customer/${window.customer.id}`,
              items: items
            })
          });
          
          const result = await response.json();
          if (result.invoiceUrl) {
            console.log('Redirecting to invoice:', result.invoiceUrl);
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
// Set up customer object first
window.customer = {
  id: {{ customer.id | json }},
  email: {{ customer.email | json }},
  first_name: {{ customer.first_name | json }},
  last_name: {{ customer.last_name | json }}
};

// Enhanced checkout for dynamic pricing - Cart Page
document.addEventListener('DOMContentLoaded', () => {
  // Function to update cart prices
  async function updateCartPrices() {
    if (!window.customer?.id) return;
    
    console.log('Updating cart page prices...');
    
    try {
      // Get cart items
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      let cartTotal = 0;
      
      // Update each cart item price
      for (let index = 0; index < cart.items.length; index++) {
        const item = cart.items[index];
        const variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
        const customerId = `gid://shopify/Customer/${window.customer.id}`;
        
        console.log(`Getting price for variant ${item.variant_id} (index ${index})`);
        
        // Get dynamic price - let the API fetch metafields server-side
        const apiUrl = 'https://monitor-api-connect-production.up.railway.app/api/pricing-public';
        const priceResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId: variantId,
            customerId: customerId,
            shop: window.Shopify?.shop?.domain || window.location.hostname,
            // Let the API fetch these from Shopify Admin API
            monitorId: null,
            isOutletProduct: null,
            customerMonitorId: null,
            // Add a flag to tell API to fetch metafields
            fetchMetafields: true
          })
        });
        
        console.log(`Price response status: ${priceResponse.status}`);
        
        if (!priceResponse.ok) {
          console.error(`Price API error: ${priceResponse.status} ${priceResponse.statusText}`);
          continue;
        }
        
        const responseText = await priceResponse.text();
        console.log(`Price response text: ${responseText}`);
        
        let priceData;
        try {
          priceData = JSON.parse(responseText);
        } catch (parseError) {
          console.error(`JSON parse error for variant ${item.variant_id}:`, parseError);
          continue;
        }
        
        if (priceData.price !== null && priceData.price !== undefined) {
          cartTotal += priceData.price * item.quantity;
          
          console.log(`Updated price for ${item.variant_id}: ${priceData.price} kr`);
          
          // Find the cart row by its actual position (1-based indexing for HTML IDs)
          const itemNumber = index + 1;
          const cartRow = document.querySelector(`tr#CartItem-${itemNumber}`);
          
          console.log(`Looking for cart row: #CartItem-${itemNumber}, found:`, !!cartRow);
          
          if (cartRow) {
            // Update individual item price displays
            const priceElements = cartRow.querySelectorAll('.cart-item__prices .price');
            console.log(`Found ${priceElements.length} price elements for item ${itemNumber}`);
            
            priceElements.forEach((priceElement, priceIndex) => {
              console.log(`Updating price element ${priceIndex} for item ${itemNumber}`);
              // Handle both regular and sale price structures
              const hasDiscount = priceElement.classList.contains('price--on-sale');
              if (hasDiscount) {
                // Update the sale price span
                const salePriceSpan = priceElement.querySelector('.price__regular');
                if (salePriceSpan) {
                  salePriceSpan.textContent = `${priceData.price} kr`;
                }
              } else {
                // Update the regular price - replace entire content
                priceElement.innerHTML = `${priceData.price} kr`;
              }
            });
            
            // Update line total (price × quantity) in the last column
            const lineTotalCell = cartRow.querySelector('.cart-item__total .font-body-bolder');
            if (lineTotalCell) {
              const lineTotal = priceData.price * item.quantity;
              lineTotalCell.textContent = `${lineTotal} kr`;
              console.log(`Updated line total for item ${itemNumber}: ${lineTotal} kr`);
            }
          } else {
            console.warn(`Could not find cart row for item ${itemNumber}`);
          }
        }
      }
      
      // Update cart total display
      const totalElement = document.querySelector('.totals__subtotal-value');
      if (totalElement && cartTotal > 0) {
        totalElement.textContent = `${cartTotal} kr`;
        console.log(`Updated cart total: ${cartTotal} kr`);
      }
      
    } catch (error) {
      console.error('Error updating cart prices:', error);
    }
  }
  
  // Initial update
  setTimeout(updateCartPrices, 500);
  
  // Update when cart items change
  document.addEventListener('cart:updated', () => {
    console.log('Cart updated event, refreshing prices...');
    setTimeout(updateCartPrices, 100);
  });
  
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
          
          console.log('Creating draft order with items:', items);
          
          // Create draft order with dynamic pricing
          const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/draft-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: `gid://shopify/Customer/${window.customer.id}`,
              items: items
            })
          });
          
          const result = await response.json();
          if (result.invoiceUrl) {
            console.log('Redirecting to invoice:', result.invoiceUrl);
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
2. **Add to cart**: Cart shows dynamic prices ✅  
3. **Cart drawer/page**: Shows dynamic prices ✅
4. **Click checkout**: Creates draft order with dynamic pricing
5. **Customer pays**: Correct dynamic price
6. **Order created**: Monitor gets correct prices ✅

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
