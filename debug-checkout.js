// Debug script to test checkout flow
// Add this to browser console to test

// Test Cart Drawer Button
const cartDrawerBtn = document.querySelector('.drawer__footer-buttons button[name="checkout"]');
console.log('Cart drawer button found:', cartDrawerBtn);

// Test Cart Page Button  
const cartPageBtn = document.querySelector('.cart__footer--buttons button[name="checkout"]');
console.log('Cart page button found:', cartPageBtn);

// Test customer object
console.log('Customer object:', window.customer);

// Test current cart
fetch('/cart.js')
  .then(response => response.json())
  .then(cart => {
    console.log('Current cart:', cart);
    console.log('Cart items:', cart.items);
  });

// Test draft order creation manually
async function testDraftOrder() {
  if (!window.customer?.id) {
    console.error('No customer logged in');
    return;
  }
  
  try {
    const cartResponse = await fetch('/cart.js');
    const cart = await cartResponse.json();
    
    const items = cart.items.map(item => ({
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      quantity: item.quantity
    }));
    
    console.log('Items to send:', items);
    
    const response = await fetch('/api/draft-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: `gid://shopify/Customer/${window.customer.id}`,
        items: items
      })
    });
    
    const result = await response.json();
    console.log('Draft order response:', result);
    
    if (result.invoiceUrl) {
      console.log('Invoice URL:', result.invoiceUrl);
      // Uncomment to actually redirect:
      // window.location.href = result.invoiceUrl;
    }
    
  } catch (error) {
    console.error('Error testing draft order:', error);
  }
}

// Run test
console.log('=== CHECKOUT DEBUG ===');
console.log('Run testDraftOrder() to test draft order creation');
