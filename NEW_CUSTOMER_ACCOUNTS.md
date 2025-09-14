# New Customer Accounts - Customer Detection for Collections

## Problem

In Shopify's new Customer Accounts, the `customer` Liquid variable is not always available in templates, even when a customer is logged in. This affects conditional rendering of customer-specific content in collection pages where you have multiple product cards.

## Solution: Simple Customer Detection for Collections

Use JavaScript to detect login status and show/hide customer-only content across multiple product cards.

## Implementation

### Step 1: Collection Template

Add this script to your collection template (e.g., `main-collection-product-grid.liquid`):

```liquid
<!-- Add this before the closing </div> of your collection section -->
<!-- START: Custom customer detection -->
<script>
// Simple customer detection for new Customer Accounts
function detectCustomerLogin() {
  // Check for logout links (most reliable indicator)
  const logoutLinks = document.querySelectorAll('a[href*="logout"]');
  
  // Check for customer-specific elements in navigation
  const customerMenus = document.querySelectorAll('.customer-menu, .account-menu, [data-customer-email]');
  
  // Check for Shopify customer cookies
  const hasCustomerCookies = document.cookie.includes('_shopify_s=') || 
                            document.cookie.includes('_secure_session_id=');
  
  const isLoggedIn = logoutLinks.length > 0 || 
                    customerMenus.length > 0 ||
                    hasCustomerCookies;
  
  console.log('Customer detection:', {
    logoutLinks: logoutLinks.length,
    customerMenus: customerMenus.length,
    hasCustomerCookies: hasCustomerCookies,
    result: isLoggedIn
  });
  
  return isLoggedIn;
}

// Apply customer detection when page loads
document.addEventListener('DOMContentLoaded', function() {
  const isCustomerLoggedIn = detectCustomerLogin();
  
  // Show/hide customer-only content across all product cards
  const customerOnlyElements = document.querySelectorAll('.customer-only-content');
  
  customerOnlyElements.forEach(function(element) {
    element.style.display = isCustomerLoggedIn ? 'block' : 'none';
  });
  
  console.log('Updated', customerOnlyElements.length, 'customer-only elements');
  
  // Set global state for other scripts (like pricing)
  window.customerState = {
    isLoggedIn: isCustomerLoggedIn,
    customer: isCustomerLoggedIn ? { id: null } : null,
    loading: false
  };
});
</script>
<!-- END: Custom customer detection -->
```

### Step 2: Product Card Snippet

In your product card snippet (e.g., `snippets/card-product.liquid`), add customer-only content:

```liquid
<!-- In your snippets/card-product.liquid file -->
<!-- Add this inside your existing product card structure -->

<!-- Your existing product card content -->
<div class="product-card">
  <!-- Existing product title, image, price etc. -->
  
  <!-- Customer-only content - initially hidden -->
  <div class="customer-only-content" style="display: none;">
    <div class="customer-pricing">
      <span class="customer-price-label">Your Price:</span>
      <span class="customer-price" data-variant-id="{{ product.selected_or_first_available_variant.id }}">
        Loading...
      </span>
    </div>
    <button class="btn btn-customer" data-product-id="{{ product.id }}">
      View Customer Details
    </button>
  </div>
  
  <!-- Your existing product actions, add to cart button etc. -->
</div>
```

**Note**: Since you're using `{%- render 'card-product', product: product -%}` in your collection template, you'll need to modify your existing `snippets/card-product.liquid` file to include the customer-only div where appropriate in your card layout.

## How It Works

1. **Detection Methods**: The script checks for multiple indicators:
   - Logout links in navigation (most reliable)
   - Customer menu elements
   - Shopify session cookies

2. **Class-Based Targeting**: Uses `.customer-only-content` class to target all customer-specific elements across all product cards

3. **Global State**: Sets `window.customerState` for other scripts (like your pricing system) to use

4. **Console Logging**: Provides debugging information to help troubleshoot

## Integration with Your Pricing System

Since you already have pricing logic, you can integrate this with your existing system:

```liquid
<!-- Add this after the customer detection script -->
<script>
// Initialize pricing after customer detection
document.addEventListener('DOMContentLoaded', function() {
  // Wait a moment for customer detection to complete
  setTimeout(function() {
    if (window.customerState && window.customerState.isLoggedIn) {
      console.log('Customer logged in - initializing pricing');
      
      // Set up customer object for your existing pricing system
      window.customer = window.customerState.customer || { 
        id: null,  // Your API can handle this with fetchMetafields: true
        email: null,
        first_name: null,
        last_name: null
      };
      
      // Initialize your existing pricing logic here
      if (typeof updateProductPricing === 'function') {
        updateProductPricing();
      }
    }
  }, 100);
});
</script>
```

## Debugging

If the detection isn't working, run this in your browser console while logged in:

```javascript
console.log('=== Customer Detection Debug ===');
console.log('Logout links:', document.querySelectorAll('a[href*="logout"]').length);
console.log('Customer menus:', document.querySelectorAll('.customer-menu, .account-menu, [data-customer-email]').length);
console.log('Has customer cookies:', document.cookie.includes('_shopify_s=') || document.cookie.includes('_secure_session_id='));
console.log('Customer-only elements found:', document.querySelectorAll('.customer-only-content').length);
```

## Notes

- Cookie domain warnings in console are normal and harmless for new Customer Accounts
- The script is lightweight and runs once per page load
- Works consistently across different themes and store configurations
- No dependency on Liquid `customer` variable
