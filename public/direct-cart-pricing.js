/**
 * Simplified approach: Use cart update webhooks + API calls
 * This approach works without complex Cart Transform setup
 */

// Option 1: Cart Update Webhook (Simpler)
// When cart is updated, call our pricing API and update cart

// Option 2: Direct Cart API Integration
// Use JavaScript to call our API and update cart via Cart API

class DirectCartPricing {
  constructor() {
    this.init();
  }
  
  async init() {
    // Wait for customer and cart to be available
    if (window.customer?.id) {
      await this.updateCartWithDynamicPricing();
    }
  }
  
  async updateCartWithDynamicPricing() {
    try {
      console.log('=== DIRECT CART PRICING UPDATE ===');
      
      // Get current cart
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      if (cart.items.length === 0) {
        console.log('Cart is empty');
        return;
      }
      
      // Get dynamic pricing for each item
      const updates = {};
      let hasUpdates = false;
      
      for (const item of cart.items) {
        const variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
        const customerId = `gid://shopify/Customer/${window.customer.id}`;
        
        try {
          // Get dynamic price from our API
          const priceResponse = await fetch('/api/pricing-public', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              variantId,
              customerId,
              shop: window.location.hostname
            })
          });
          
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            const dynamicPriceCents = Math.round(priceData.price * 100);
            const currentPriceCents = item.price;
            
            // Only update if price is different
            if (dynamicPriceCents !== currentPriceCents && priceData.price !== 299.99) {
              console.log(`Item ${item.variant_id}: ${currentPriceCents/100} → ${priceData.price}`);
              
              // Store for cart update
              updates[item.variant_id] = {
                id: item.variant_id,
                quantity: item.quantity,
                price: dynamicPriceCents
              };
              hasUpdates = true;
            }
          }
          
        } catch (error) {
          console.error(`Error getting price for variant ${item.variant_id}:`, error);
        }
      }
      
      if (hasUpdates) {
        console.log('Updating cart with dynamic pricing:', updates);
        // Note: Direct price updates aren't possible via Cart API
        // This would require line item properties or draft orders
        await this.createDraftOrderWithDynamicPricing(cart.items, updates);
      }
      
    } catch (error) {
      console.error('Error updating cart with dynamic pricing:', error);
    }
  }
  
  async createDraftOrderWithDynamicPricing(cartItems, priceUpdates) {
    // Create draft order with correct pricing
    // This is a more reliable approach than trying to update cart prices
    
    const items = cartItems.map(item => ({
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      quantity: item.quantity,
      dynamicPrice: priceUpdates[item.variant_id]?.price / 100
    }));
    
    try {
      const response = await fetch('/api/draft-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: `gid://shopify/Customer/${window.customer.id}`,
          items
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Draft order created with dynamic pricing:', result);
        
        // Optionally redirect to draft order for checkout
        if (result.invoiceUrl) {
          // Store the draft order URL for checkout button
          window.dynamicPricingDraftOrderUrl = result.invoiceUrl;
        }
      }
      
    } catch (error) {
      console.error('Error creating draft order:', error);
    }
  }
}

// Initialize direct cart pricing
if (window.customer?.id) {
  window.directCartPricing = new DirectCartPricing();
}
