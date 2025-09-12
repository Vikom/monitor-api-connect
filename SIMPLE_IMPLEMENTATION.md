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

// Pre-populate cart item metafields using Liquid (same approach as product page!)
window.cartItemsMetafields = {
  {% for item in cart.items %}
    "{{ item.variant_id }}": {
      monitorId: "{{ item.variant.metafields.custom.monitor_id }}",
      customerMonitorId: "{{ customer.metafields.custom.monitor_id }}",
      {% assign is_outlet = false %}
      {% for collection in item.product.collections %}
        {% if collection.handle == 'outlet' %}
          {% assign is_outlet = true %}
          {% break %}
        {% endif %}
      {% endfor %}
      isOutletProduct: {{ is_outlet }}
    }{% unless forloop.last %},{% endunless %}
  {% endfor %}
};

// Enhanced checkout for dynamic pricing - Cart Drawer
document.addEventListener('DOMContentLoaded', () => {
  // Cache to prevent multiple API calls for the same variant
  const priceCache = new Map();
  
  // Function to update cart prices
  async function updateCartPrices() {
    if (!window.customer?.id) return;
    
    console.log('Updating cart drawer prices...');
    console.log('Cart metafields data:', window.cartItemsMetafields);
    
    try {
      // Get cart items
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      let cartTotal = 0;
      
      // Update each cart item price
      for (const item of cart.items) {
        const variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
        const customerId = `gid://shopify/Customer/${window.customer.id}`;
        const cacheKey = `${item.variant_id}-${window.customer.id}`;
        
        console.log(`Getting price for variant ${item.variant_id}`);
        
        // Check cache first
        let priceData = priceCache.get(cacheKey);
        
        if (!priceData) {
          // Get metafields from pre-populated data (same as product page approach!)
          const itemMetafields = window.cartItemsMetafields[item.variant_id] || {};
          
          console.log(`Using pre-populated metafields for ${item.variant_id}:`, itemMetafields);
          
          // Get dynamic price using Liquid template data (no API metafield fetching needed!)
          const apiUrl = 'https://monitor-api-connect-production.up.railway.app/api/pricing-public';
          const priceResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              variantId: variantId,
              customerId: customerId,
              shop: window.Shopify?.shop?.domain || window.location.hostname,
              // Use pre-populated metafields from Liquid templates!
              monitorId: itemMetafields.monitorId || null,
              isOutletProduct: itemMetafields.isOutletProduct || false,
              customerMonitorId: itemMetafields.customerMonitorId || null
              // No fetchMetafields needed - we have the data already!
            })
          });
          
          console.log(`Price response status: ${priceResponse.status}`);
          
          if (!priceResponse.ok) {
            console.error(`Price API error: ${priceResponse.status} ${priceResponse.statusText}`);
            continue; // Skip this item
          }
          
          const responseText = await priceResponse.text();
          console.log(`Price response text: ${responseText}`);
          
          try {
            priceData = JSON.parse(responseText);
            // Cache the result
            priceCache.set(cacheKey, priceData);
          } catch (parseError) {
            console.error(`JSON parse error for variant ${item.variant_id}:`, parseError);
            console.error(`Response text was: ${responseText}`);
            continue; // Skip this item
          }
        } else {
          console.log(`Using cached price for variant ${item.variant_id}:`, priceData.price);
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
          const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/draft-order-public', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: `gid://shopify/Customer/${window.customer.id}`,
              items: items,
              shop: window.Shopify?.shop?.domain || window.location.hostname
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

// Pre-populate cart item metafields using Liquid (same approach as product page!)
window.cartItemsMetafields = {
  {% for item in cart.items %}
    "{{ item.variant_id }}": {
      monitorId: "{{ item.variant.metafields.custom.monitor_id }}",
      customerMonitorId: "{{ customer.metafields.custom.monitor_id }}",
      {% assign is_outlet = false %}
      {% for collection in item.product.collections %}
        {% if collection.handle == 'outlet' %}
          {% assign is_outlet = true %}
          {% break %}
        {% endif %}
      {% endfor %}
      isOutletProduct: {{ is_outlet }}
    }{% unless forloop.last %},{% endunless %}
  {% endfor %}
};

// Enhanced checkout for dynamic pricing - Cart Page
document.addEventListener('DOMContentLoaded', () => {
  // Cache to prevent multiple API calls for the same variant
  const priceCache = new Map();
  
  // Function to update cart prices
  async function updateCartPrices() {
    if (!window.customer?.id) return;
    
    console.log('Updating cart page prices...');
    console.log('Cart metafields data:', window.cartItemsMetafields);
    
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
        const cacheKey = `${item.variant_id}-${window.customer.id}`;
        
        console.log(`Getting price for variant ${item.variant_id} (index ${index})`);
        
        // Check cache first
        let priceData = priceCache.get(cacheKey);
        
        if (!priceData) {
          // Get metafields from pre-populated data (same as product page approach!)
          const itemMetafields = window.cartItemsMetafields[item.variant_id] || {};
          
          console.log(`Using pre-populated metafields for ${item.variant_id}:`, itemMetafields);
          
          // Get dynamic price using Liquid template data (no API metafield fetching needed!)
          const apiUrl = 'https://monitor-api-connect-production.up.railway.app/api/pricing-public';
          const priceResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              variantId: variantId,
              customerId: customerId,
              shop: window.Shopify?.shop?.domain || window.location.hostname,
              // Use pre-populated metafields from Liquid templates!
              monitorId: itemMetafields.monitorId || null,
              isOutletProduct: itemMetafields.isOutletProduct || false,
              customerMonitorId: itemMetafields.customerMonitorId || null
              // No fetchMetafields needed - we have the data already!
            })
          });
          
          console.log(`Price response status: ${priceResponse.status}`);
          
          if (!priceResponse.ok) {
            console.error(`Price API error: ${priceResponse.status} ${priceResponse.statusText}`);
            continue;
          }
          
          const responseText = await priceResponse.text();
          console.log(`Price response text: ${responseText}`);
          
          try {
            priceData = JSON.parse(responseText);
            // Cache the result
            priceCache.set(cacheKey, priceData);
          } catch (parseError) {
            console.error(`JSON parse error for variant ${item.variant_id}:`, parseError);
            continue;
          }
        } else {
          console.log(`Using cached price for variant ${item.variant_id}:`, priceData.price);
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
  const checkoutBtn = document.querySelector('button[name="checkout"][form="cart"]');
  
  if (checkoutBtn) {
    console.log('Found checkout button:', checkoutBtn);
    
    // Use both click and form submit event handlers for maximum compatibility
    checkoutBtn.addEventListener('click', async (e) => {
      console.log('Checkout button click event fired');
      await handleCheckoutInterception(e);
    });
    
    // Also intercept form submission
    const cartForm = document.getElementById('cart');
    if (cartForm) {
      cartForm.addEventListener('submit', async (e) => {
        console.log('Cart form submit event fired');
        await handleCheckoutInterception(e);
      });
    }
    
    async function handleCheckoutInterception(e) {
      if (window.customer?.id) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        console.log('Checkout intercepted! Creating draft order...');
        
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
          const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/draft-order-public', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: `gid://shopify/Customer/${window.customer.id}`,
              items: items,
              shop: window.Shopify?.shop?.domain || window.location.hostname
            })
          });
          
          const result = await response.json();
          console.log('Draft order API response:', result);
          
          if (result.invoiceUrl) {
            console.log('Success! Redirecting to invoice:', result.invoiceUrl);
            window.location.href = result.invoiceUrl;
          } else {
            console.error('No invoice URL in response:', result);
            throw new Error('No invoice URL received: ' + JSON.stringify(result));
          }
          
        } catch (error) {
          console.error('Draft order creation failed:', error);
          // Restore button and fallback to normal checkout
          btnText.innerHTML = originalText;
          checkoutBtn.disabled = false;
          alert('Kunde inte tillämpa dina priser. Försöker med vanlig checkout...');
          window.location.href = '/checkout';
        }
      } else {
        console.log('No customer logged in, allowing normal checkout');
        // Let normal checkout proceed for guests
      }
    }
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
