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
    // Find cart item elements and update displayed price
    const cartItems = document.querySelectorAll(`[data-variant-id="${variantId}"], .cart-item`);
    
    cartItems.forEach(item => {
      // Look for price elements within this cart item
      const priceElements = item.querySelectorAll('.money, [class*="price"], .cart-item__price');
      
      priceElements.forEach(priceElement => {
        if (priceElement.textContent.includes('kr') || priceElement.textContent.includes('SEK')) {
          const formattedPrice = window.formatPrice(dynamicPrice);
          const originalPrice = priceElement.textContent;
          
          // Update the price display
          priceElement.innerHTML = `
            <span class="dynamic-price" style="color: #4CAF50; font-weight: bold;">
              ${formattedPrice}
            </span>
            <span class="original-price" style="text-decoration: line-through; opacity: 0.6; margin-left: 8px; font-size: 0.9em;">
              ${originalPrice}
            </span>
          `;
          
          // Add tooltip
          priceElement.title = `${priceSource === 'customer-specific' ? 'Customer-specific pricing' : 
                                 priceSource?.includes('outlet') ? 'Outlet pricing' : 'Special pricing'} applied`;
        }
      });
    });
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
}

// Initialize dynamic pricing cart if customer is logged in
if (window.customer?.id && typeof window.getCustomerPrice === 'function') {
  window.dynamicPricingCart = new DynamicPricingCart();
  
  // Add method to window for theme integration
  window.createDraftOrderWithDynamicPricing = (cartItems) => {
    return window.dynamicPricingCart.createDraftOrderWithDynamicPricing(cartItems);
  };
}
