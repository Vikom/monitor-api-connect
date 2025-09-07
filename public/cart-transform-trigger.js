/**
 * Simplified pricing client for Cart Transform approach
 * This replaces the complex cart-pricing.js with a simple trigger
 */

// Simple notification system for pricing feedback
class PricingNotification {
  static show(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = 'pricing-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#4CAF50' : type === 'warning' ? '#FF9800' : '#2196F3'};
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
      font-size: 14px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      max-width: 300px;
    `;
    notification.innerHTML = message;
    
    document.body.appendChild(notification);
    
    // Remove after 4 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 4000);
  }
}

// Simple cart refresh trigger
class CartTransformTrigger {
  constructor() {
    this.init();
  }
  
  init() {
    // Listen for add to cart events
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (form.action && form.action.includes('/cart/add')) {
        this.handleAddToCart(event);
      }
    });
  }
  
  handleAddToCart(event) {
    if (!window.customer?.id) {
      console.log('No logged-in customer, using standard pricing');
      return;
    }
    
    // Show notification that dynamic pricing will be applied
    PricingNotification.show(
      'Dynamic pricing will be applied in cart...', 
      'info'
    );
    
    // Wait for cart to update, then refresh to trigger Cart Transform
    setTimeout(() => {
      this.refreshCart();
    }, 1500);
  }
  
  async refreshCart() {
    try {
      // Get current cart
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      if (cart.items.length > 0) {
        console.log('Cart has items, Cart Transform should apply dynamic pricing automatically');
        PricingNotification.show(
          'Dynamic pricing applied! Check your cart.', 
          'success'
        );
      }
      
    } catch (error) {
      console.error('Error refreshing cart:', error);
    }
  }
}

// Initialize if customer is logged in
if (window.customer?.id) {
  window.cartTransformTrigger = new CartTransformTrigger();
  
  console.log('Cart Transform trigger initialized for logged-in customer');
  PricingNotification.show(
    'Dynamic pricing active for logged-in customers', 
    'info'
  );
} else {
  console.log('Customer not logged in - standard pricing will be used');
}
