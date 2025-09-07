/**
 * Dynamic pricing cart handler
 * This script handles dynamic pricing in the Shopify cart
 */

class DynamicPricingCart {
  constructor() {
    this.init();
  }
  
  async init() {
    // Wait for the page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.bindEvents());
    } else {
      this.bindEvents();
    }
  }
  
  bindEvents() {
    // Listen for add to cart events
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (form.action && form.action.includes('/cart/add')) {
        this.handleAddToCart(event);
      }
    });
    
    // Listen for cart updates
    document.addEventListener('change', (event) => {
      if (event.target.name && event.target.name.includes('updates[')) {
        this.handleCartUpdate();
      }
    });
    
    // Initialize cart pricing on page load if we're on cart page
    if (window.location.pathname.includes('/cart')) {
      this.updateCartPricing();
    }
    
    // Listen for cart drawer/modal opening (common in themes)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // Check if cart elements were added
          const addedNodes = Array.from(mutation.addedNodes);
          addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this looks like a cart element
              if (node.matches && (
                node.matches('.cart-drawer') || 
                node.matches('.mini-cart') || 
                node.matches('[data-cart]') ||
                node.matches('.f-cart') ||
                node.classList.contains('cart')
              )) {
                console.log('Cart element detected, updating pricing');
                setTimeout(() => this.updateCartPricing(), 500);
              }
              
              // Also check child elements
              const cartElements = node.querySelectorAll && node.querySelectorAll('.cart-drawer, .mini-cart, [data-cart], .f-cart, .cart');
              if (cartElements && cartElements.length > 0) {
                console.log('Cart child elements detected, updating pricing');
                setTimeout(() => this.updateCartPricing(), 500);
              }
            }
          });
        }
        
        // Check if cart content changed
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target;
          if (target.classList.contains('cart-open') || 
              target.classList.contains('cart-visible') ||
              target.classList.contains('cart-drawer-open')) {
            console.log('Cart opened via class change, updating pricing');
            setTimeout(() => this.updateCartPricing(), 500);
          }
        }
      });
    });
    
    // Observe document for cart changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }
  
  async handleAddToCart(event) {
    // Don't prevent default, let Shopify handle the add to cart
    // But store pricing info for later use
    
    if (!window.customer?.id) {
      console.log('No logged-in customer, using standard pricing');
      return;
    }
    
    const form = event.target;
    const formData = new FormData(form);
    const variantId = formData.get('id');
    
    if (variantId) {
      // Store dynamic pricing information
      const customerId = `gid://shopify/Customer/${window.customer.id}`;
      const shopifyVariantId = `gid://shopify/ProductVariant/${variantId}`;
      
      try {
        const priceData = await window.getCustomerPrice(shopifyVariantId, customerId);
        
        // Store the dynamic price in session storage for later use
        const cartPricing = JSON.parse(sessionStorage.getItem('dynamicCartPricing') || '{}');
        cartPricing[variantId] = {
          price: priceData.price,
          priceSource: priceData.metadata?.priceSource,
          timestamp: Date.now()
        };
        sessionStorage.setItem('dynamicCartPricing', JSON.stringify(cartPricing));
        
        console.log(`Stored dynamic price ${priceData.price} for variant ${variantId}`);
        
        // Show dynamic pricing notification
        this.showPricingNotification(priceData);
        
        // Wait a bit for cart to update, then update pricing display
        setTimeout(() => {
          console.log('Triggering cart pricing update after add to cart');
          this.updateCartItemDisplay(variantId, priceData.price, priceData.metadata?.priceSource);
        }, 1000);
        
        // Also listen for cart drawer/modal opening
        setTimeout(() => {
          this.updateCartPricing();
        }, 1500);
        
      } catch (error) {
        console.error('Error getting dynamic price for cart:', error);
      }
    }
  }
  
  showPricingNotification(priceData) {
    if (priceData.metadata?.priceSource === 'customer-specific') {
      // Show notification that customer-specific pricing is applied
      const notification = document.createElement('div');
      notification.className = 'dynamic-pricing-notification';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      `;
      notification.innerHTML = `
        <strong>Customer pricing applied!</strong><br>
        Your special price: ${window.formatPrice(priceData.price)}
      `;
      
      document.body.appendChild(notification);
      
      // Remove after 5 seconds
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 5000);
    } else if (priceData.metadata?.priceSource?.includes('outlet')) {
      const notification = document.createElement('div');
      notification.className = 'dynamic-pricing-notification';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #FF9800;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      `;
      notification.innerHTML = `
        <strong>Outlet pricing applied!</strong><br>
        Outlet price: ${window.formatPrice(priceData.price)}
      `;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 5000);
    }
  }
  
  async updateCartPricing() {
    if (!window.customer?.id) {
      return;
    }
    
    // Get cart data
    try {
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      let hasUpdates = false;
      const updates = {};
      
      for (const item of cart.items) {
        const variantId = item.variant_id;
        const customerId = `gid://shopify/Customer/${window.customer.id}`;
        const shopifyVariantId = `gid://shopify/ProductVariant/${variantId}`;
        
        try {
          const priceData = await window.getCustomerPrice(shopifyVariantId, customerId);
          
          // Convert price to cents for Shopify
          const dynamicPriceCents = Math.round(priceData.price * 100);
          const currentPriceCents = item.price;
          
          // Only update if price is different and not the test price
          if (dynamicPriceCents !== currentPriceCents && priceData.price !== 299.99) {
            console.log(`Updating cart item ${variantId}: ${currentPriceCents/100} → ${priceData.price}`);
            
            // Note: Shopify doesn't allow direct price updates in cart
            // This would require a different approach like line item properties
            // or custom cart implementation
            
            // For now, we'll show the corrected pricing in the UI
            this.updateCartItemDisplay(variantId, priceData.price, priceData.metadata?.priceSource);
          }
          
        } catch (error) {
          console.error(`Error getting dynamic price for cart item ${variantId}:`, error);
        }
      }
      
    } catch (error) {
      console.error('Error updating cart pricing:', error);
    }
  }
  
  updateCartItemDisplay(variantId, dynamicPrice, priceSource) {
    console.log(`=== CART ITEM DISPLAY UPDATE ===`);
    console.log('Variant ID:', variantId);
    console.log('Dynamic Price:', dynamicPrice);
    console.log('Price Source:', priceSource);
    
    // Find the specific cart item by variant ID
    const specificCartItem = document.querySelector(`[data-variant-id="${variantId}"]`);
    
    if (specificCartItem) {
      console.log(`Found specific cart item for variant ${variantId}:`, specificCartItem);
      
      // Look for price elements within this specific cart item only
      const priceElements = specificCartItem.querySelectorAll('.money, [class*="price"], .cart-item__price, .f-price, [data-price]');
      console.log(`Found ${priceElements.length} price elements in specific cart item`);
      
      priceElements.forEach((priceElement, priceIndex) => {
        console.log(`Price element ${priceIndex} in specific item:`, priceElement.textContent.trim(), priceElement);
        
        // Skip if already processed for this specific variant and price
        const updateKey = `${variantId}-${dynamicPrice}`;
        if (priceElement.getAttribute('data-dynamic-price-updated') === updateKey) {
          console.log(`Price element ${priceIndex} already updated for this variant/price, skipping`);
          return;
        }
        
        if (priceElement.textContent.includes('kr') || priceElement.textContent.includes('SEK') || priceElement.textContent.includes('0')) {
          const formattedPrice = window.formatPrice(dynamicPrice);
          const originalPrice = priceElement.textContent;
          
          console.log(`Updating price element from "${originalPrice}" to "${formattedPrice}"`);
          
          // Simply update the text content without adding styling
          priceElement.textContent = formattedPrice;
          
          // Mark as updated with variant-specific key to prevent duplicate processing
          priceElement.setAttribute('data-dynamic-price-updated', updateKey);
          
          // Add subtle tooltip only
          priceElement.title = `${priceSource === 'customer-specific' ? 'Customer-specific pricing' : 
                                 priceSource?.includes('outlet') ? 'Outlet pricing' : 'Special pricing'} applied`;
        }
      });
      
      // Store the dynamic price in the cart item data attribute for reference
      specificCartItem.setAttribute('data-dynamic-price', dynamicPrice);
      specificCartItem.setAttribute('data-price-source', priceSource || 'dynamic');
      
    } else {
      console.log(`No specific cart item found for variant ${variantId}, trying fallback approach`);
      
      // Fallback: Find cart item elements and update displayed price
      // Try multiple selectors for different themes
      const possibleSelectors = [
        `.cart-item`,
        `[data-id="${variantId}"]`,
        `.line-item`,
        `.cart__item`,
        `.f-cart-item`,
        `.cartitem`
      ];
      
      let cartItems = [];
      for (const selector of possibleSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          cartItems = [...cartItems, ...elements];
        }
      }
      
      console.log(`Total cart items found: ${cartItems.length}`);
      
      if (cartItems.length === 0) {
        console.log('No cart items found, trying to find any price elements in cart');
        // If no specific cart items found, try to find price elements in cart area
        const cartSelectors = ['.cart', '.cart-drawer', '.mini-cart', '.f-cart', '#cart', '[data-cart]'];
        for (const cartSelector of cartSelectors) {
          const cartArea = document.querySelector(cartSelector);
          if (cartArea) {
            console.log(`Found cart area with selector: ${cartSelector}`);
            const priceElements = cartArea.querySelectorAll('.money, [class*="price"], .f-price, [data-price]');
            console.log(`Found ${priceElements.length} price elements in cart area`);
            
            priceElements.forEach((priceElement, index) => {
              console.log(`Price element ${index}:`, priceElement.textContent.trim(), priceElement);
              
              // Skip if already processed (check for dynamic pricing marker)
              const updateKey = `${variantId}-${dynamicPrice}`;
              if (priceElement.getAttribute('data-dynamic-price-updated') === updateKey) {
                console.log(`Price element ${index} already updated for this variant/price, skipping`);
                return;
              }
              
              // Check if this price element contains the original price or 0
              const priceText = priceElement.textContent.trim();
              if (priceText.includes('0') || priceText.includes('kr')) {
                const formattedPrice = window.formatPrice(dynamicPrice);
                const originalPrice = priceElement.textContent;
                
                console.log(`Updating price element ${index} from "${originalPrice}" to "${formattedPrice}"`);
                
                // Simply update the text content without adding styling
                priceElement.textContent = formattedPrice;
                
                // Mark as updated to prevent duplicate processing
                priceElement.setAttribute('data-dynamic-price-updated', updateKey);
                
                // Add subtle tooltip only
                priceElement.title = `${priceSource === 'customer-specific' ? 'Customer-specific pricing' : 
                                       priceSource?.includes('outlet') ? 'Outlet pricing' : 'Special pricing'} applied`;
              }
            });
            break;
          }
        }
      } else {
        cartItems.forEach((item, itemIndex) => {
          console.log(`Processing cart item ${itemIndex}:`, item);
          
          // Look for price elements within this cart item
          const priceElements = item.querySelectorAll('.money, [class*="price"], .cart-item__price, .f-price, [data-price]');
          console.log(`Found ${priceElements.length} price elements in cart item ${itemIndex}`);
          
          priceElements.forEach((priceElement, priceIndex) => {
            console.log(`Price element ${priceIndex} in item ${itemIndex}:`, priceElement.textContent.trim(), priceElement);
            
            // Skip if already processed (check for dynamic pricing marker)
            const updateKey = `${variantId}-${dynamicPrice}`;
            if (priceElement.getAttribute('data-dynamic-price-updated') === updateKey) {
              console.log(`Price element ${priceIndex} already updated for this variant/price, skipping`);
              return;
            }
            
            if (priceElement.textContent.includes('kr') || priceElement.textContent.includes('SEK') || priceElement.textContent.includes('0')) {
              const formattedPrice = window.formatPrice(dynamicPrice);
              const originalPrice = priceElement.textContent;
              
              console.log(`Updating price element from "${originalPrice}" to "${formattedPrice}"`);
              
              // Simply update the text content without adding styling
              priceElement.textContent = formattedPrice;
              
              // Mark as updated to prevent duplicate processing
              priceElement.setAttribute('data-dynamic-price-updated', updateKey);
              
              // Add subtle tooltip only
              priceElement.title = `${priceSource === 'customer-specific' ? 'Customer-specific pricing' : 
                                     priceSource?.includes('outlet') ? 'Outlet pricing' : 'Special pricing'} applied`;
            }
          });
        });
      }
    }
    
    // Update cart totals after individual item updates
    this.updateCartTotals();
    
    console.log(`=== END CART ITEM DISPLAY UPDATE ===`);
  }
  
  // Method to create a draft order with correct pricing
  async createDraftOrderWithDynamicPricing(cartItems) {
    if (!window.customer?.id) {
      throw new Error('Customer must be logged in');
    }
    
    const customerId = `gid://shopify/Customer/${window.customer.id}`;
    const items = cartItems.map(item => ({
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      quantity: item.quantity
    }));
    
    try {
      const response = await fetch('/api/draft-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId,
          items
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      return result;
      
    } catch (error) {
      console.error('Error creating draft order:', error);
      throw error;
    }
  }

  // Method to update cart totals display
  updateCartTotals() {
    console.log('=== UPDATING CART TOTALS ===');
    
    try {
      // Find all cart items with dynamic pricing
      const cartItems = document.querySelectorAll('[data-dynamic-price]');
      let totalPrice = 0;
      
      cartItems.forEach(item => {
        const dynamicPrice = parseFloat(item.getAttribute('data-dynamic-price')) || 0;
        const quantityInput = item.querySelector('input[data-quantity-variant-id]');
        const quantity = quantityInput ? parseInt(quantityInput.value) || 1 : 1;
        
        console.log(`Item with dynamic price: ${dynamicPrice}, quantity: ${quantity}`);
        totalPrice += dynamicPrice * quantity;
      });
      
      // If no dynamic pricing items found, get from standard cart items
      if (totalPrice === 0) {
        const standardCartItems = document.querySelectorAll('.cart-item[data-variant-id]');
        standardCartItems.forEach(item => {
          const priceElement = item.querySelector('[class*="price"]');
          if (priceElement) {
            const priceText = priceElement.textContent.replace(/[^\d,]/g, '').replace(',', '.');
            const price = parseFloat(priceText) || 0;
            const quantityInput = item.querySelector('input[data-quantity-variant-id]');
            const quantity = quantityInput ? parseInt(quantityInput.value) || 1 : 1;
            
            console.log(`Standard item price: ${price}, quantity: ${quantity}`);
            totalPrice += price * quantity;
          }
        });
      }
      
      console.log(`Calculated total price: ${totalPrice}`);
      
      // Update total display
      const totalElements = document.querySelectorAll('.totals__subtotal-value, .cart-total, [class*="total"]');
      totalElements.forEach(element => {
        if (element.textContent.includes('SEK') || element.textContent.includes('kr') || element.textContent.includes('0')) {
          const formattedTotal = window.formatPrice ? window.formatPrice(totalPrice) : `${totalPrice.toFixed(2)} kr`;
          console.log(`Updating total element from "${element.textContent}" to "${formattedTotal}"`);
          element.textContent = formattedTotal;
        }
      });
      
    } catch (error) {
      console.error('Error updating cart totals:', error);
    }
    
    console.log('=== END CART TOTALS UPDATE ===');
  }
}

// Initialize dynamic pricing cart if customer is logged in
if (window.customer?.id && typeof window.getCustomerPrice === 'function') {
  window.dynamicPricingCart = new DynamicPricingCart();
  
  // Add method to window for theme integration
  window.createDraftOrderWithDynamicPricing = (cartItems) => {
    return window.dynamicPricingCart.createDraftOrderWithDynamicPricing(cartItems);
  };
  
  // Add method to manually trigger cart pricing update
  window.updateCartPricing = () => {
    console.log('Manual cart pricing update triggered');
    return window.dynamicPricingCart.updateCartPricing();
  };
  
  // Add method to manually update specific cart item
  window.updateCartItemPricing = (variantId, dynamicPrice, priceSource) => {
    console.log('Manual cart item pricing update triggered', { variantId, dynamicPrice, priceSource });
    return window.dynamicPricingCart.updateCartItemDisplay(variantId, dynamicPrice, priceSource);
  };
  
  // Add method to update cart totals
  window.updateCartTotals = () => {
    console.log('Manual cart totals update triggered');
    return window.dynamicPricingCart.updateCartTotals();
  };
  
  // Add test function for debugging
  window.dpCart = {
    testCartUpdate: () => {
      console.log('=== TESTING CART UPDATE ===');
      const cartItems = document.querySelectorAll('[data-variant-id]');
      console.log(`Found ${cartItems.length} cart items with variant IDs`);
      
      cartItems.forEach((item, index) => {
        const variantId = item.getAttribute('data-variant-id');
        console.log(`Cart item ${index}: variant ${variantId}`, item);
        
        // Test updating with a test price
        if (variantId) {
          window.dynamicPricingCart.updateCartItemDisplay(variantId, 100, 'test');
        }
      });
      
      // Test total update
      window.dynamicPricingCart.updateCartTotals();
      console.log('=== END CART TEST ===');
    },
    
    resetPricing: () => {
      console.log('=== RESETTING CART PRICING ===');
      // Remove all dynamic pricing markers
      const updatedElements = document.querySelectorAll('[data-dynamic-price-updated]');
      updatedElements.forEach(element => {
        element.removeAttribute('data-dynamic-price-updated');
      });
      
      const dynamicPriceItems = document.querySelectorAll('[data-dynamic-price]');
      dynamicPriceItems.forEach(item => {
        item.removeAttribute('data-dynamic-price');
        item.removeAttribute('data-price-source');
      });
      
      console.log('Pricing reset complete');
    }
  };
}
