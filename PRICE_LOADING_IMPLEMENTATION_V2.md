# Price Loading State Implementation V2

## Summary
We've implemented a comprehensive pricing system that handles loading states, zero/null prices, and integrates with add-to-cart functionality.

## Changes Made

### 1. Modified `price.liquid`
- Updated CSS to hide/show entire price sections (`.f-price__regular`, `.f-price__sale`) instead of individual items
- Added `f-price--loading` class by default to all price containers
- Added "Contact for Price" section with mailto link
- Added styles for loading states and disabled buttons
- Added support for non-logged-in customers with `f-price--no-custom-pricing` class

### 2. Updated `pricing-client.js`
- Enhanced `updatePriceDisplay()` to handle zero/null prices
- Added logic to show "Fråga oss om pris" when price is 0 or null
- Added `enableAddToCartButton()` and `disableAddToCartButton()` functions
- Added comprehensive error handling that shows contact message
- Added debugging for better troubleshooting
- Made all functions available globally

### 3. Enhanced `main-product.liquid`
- Added multiple event listeners for variant changes (variant:change, change, click)
- Added MutationObserver and polling fallback for maximum compatibility
- Added comprehensive debugging
- Integrated with new pricing logic

## Behavior

### For Logged-in Customers with Valid Pricing:
1. **Loading**: Price section is hidden (empty space)
2. **Valid price**: Price is shown with formatted currency
3. **Add to cart**: Button is enabled with "Lägg till i varukorgen"

### For Logged-in Customers with Zero/Null Pricing:
1. **Loading**: Price section is hidden
2. **No price**: Shows "Fråga oss om pris" with mailto link
3. **Add to cart**: Button is disabled with "Kontakta oss för pris"

### For Non-logged-in Customers:
1. **Immediate display**: Regular Shopify prices shown without delay
2. **Add to cart**: Normal functionality

### On API Errors:
1. **Fallback**: Shows "Fråga oss om pris" message
2. **Add to cart**: Button is disabled

## CSS Classes

- `.f-price--loading`: Hides price sections during loading
- `.f-price--loaded`: Shows price sections when loaded
- `.f-price--no-custom-pricing`: Shows prices immediately (non-logged-in)
- `.btn--disabled`: Styles disabled add-to-cart buttons

## Contact for Price Features

- **Email**: test@sonsab.se
- **Message**: "Fråga oss om pris"
- **Trigger**: When API returns price ≤ 0 or null
- **Button state**: Disabled with "Kontakta oss för pris"

## Functions Available Globally

- `window.getCustomerPrice(variantId, customerId)`: Get price from API
- `window.updatePriceDisplay(variantId, priceSelector, customerId)`: Update price and manage states
- `window.setPriceLoading()`: Set loading state
- `window.enableAddToCartButton()`: Enable add to cart functionality
- `window.disableAddToCartButton()`: Disable add to cart functionality
- `window.formatPrice(price)`: Format price according to locale

## Implementation Notes

- Price sections (including units) are hidden/shown as complete blocks
- Multiple event listeners ensure variant changes are caught across different themes
- Comprehensive error handling with graceful degradation
- Add-to-cart button state is synchronized with price availability
- Debugging enabled for troubleshooting