/**
 * Client-side helper for calling the pricing API
 */

/**
 * Get dynamic price for a single variant for a logged-in customer
 * @param {string} variantId - Shopify variant ID (gid://shopify/ProductVariant/...)
 * @param {string} customerId - Shopify customer ID (required)
 * @param {string} monitorId - Monitor ID for the specific variant (optional)
 * @returns {Promise<{price: number, metadata?: object}>}
 */
async function getCustomerPrice(variantId, customerId, monitorId = null) {
  if (!customerId) {
    throw new Error('Customer ID is required - no anonymous pricing allowed');
  }

  try {
    // Use the public pricing endpoint to avoid authentication issues
    const apiUrl = window.pricingApiUrl ? 
      `https://${window.pricingApiUrl}/api/pricing-public` : 
      '/api/pricing-public';
    
    const requestBody = {
      variantId,
      customerId,
      shop: window.Shopify?.shop || window.pricingApiUrl?.replace('.myshopify.com', ''),
      monitorId: monitorId || window.currentVariantMonitorId || null,
      isOutletProduct: window.isOutletProduct || false,
      customerMonitorId: window.customerMonitorId || null
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response text:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const data = await response.json();
    
    return data;
  } catch (error) {
    console.error('Error fetching customer price:', error);
    throw error;
  }
}

// Track active price requests to prevent race conditions
let activePriceRequests = new Map();

/**
 * Get the monitor ID for a specific variant from the pre-built variant map
 * @param {string} variantId - Shopify variant ID (gid://shopify/ProductVariant/123456)
 * @returns {string|null} The monitor ID for the variant, or null if not found
 */
function getVariantMonitorId(variantId) {
  try {
    // Extract numeric variant ID from the gid format
    const numericVariantId = variantId.replace('gid://shopify/ProductVariant/', '');
    
    // Get the monitor ID from the pre-built map
    if (window.variantMonitorIds && window.variantMonitorIds[numericVariantId]) {
      const monitorId = window.variantMonitorIds[numericVariantId];
      return monitorId;
    }
    return null;
  } catch (error) {
    console.error('Error getting variant monitor ID:', error);
    return null;
  }
}

/**
 * Update price display on a product page for a logged-in customer
 * @param {string} variantId - Shopify variant ID
 * @param {string} priceSelector - CSS selector for price element
 * @param {string} customerId - Shopify customer ID (required)
 */
async function updatePriceDisplay(variantId, priceSelector, customerId) {
  if (!customerId) {
    console.error('Customer ID is required for price display');
    return;
  }

  // Create a unique key for this request
  const requestKey = `${variantId}-${customerId}`;
  
  // If there's already a request for this variant/customer combo, cancel it
  if (activePriceRequests.has(requestKey)) {
    activePriceRequests.get(requestKey).cancelled = true;
  }
  
  // Create a new request tracker
  const requestTracker = { cancelled: false };
  activePriceRequests.set(requestKey, requestTracker);

  // Find all price containers to manage loading states
  const priceContainers = document.querySelectorAll('.f-price');
  
  // Set loading state - hide prices while fetching
  priceContainers.forEach(container => {
    container.classList.add('f-price--loading');
    container.classList.remove('f-price--loaded', 'f-price--no-custom-pricing');
  });

  try {
    // Get the specific monitor ID for this variant
    const variantMonitorId = getVariantMonitorId(variantId);
    
    const priceData = await getCustomerPrice(variantId, customerId, variantMonitorId);
    
    // Check if this request was cancelled while we were fetching
    if (requestTracker.cancelled) {
      return;
    }
    
    const priceElement = document.querySelector(priceSelector);
    
    // Check if we have valid price data
    const hasValidPrice = priceData && priceData.price && priceData.price > 0;
    
    if (priceElement && hasValidPrice) {
      // Check again if request was cancelled before updating UI
      if (requestTracker.cancelled) {
        return;
      }
      
      // Format price according to shop's currency settings
      const formattedPrice = formatPrice(priceData.price);
      priceElement.textContent = formattedPrice;
      
      // Add a data attribute to indicate dynamic pricing
      if (priceData.metadata?.priceSource === 'dynamic') {
        priceElement.setAttribute('data-dynamic-price', 'true');
        priceElement.setAttribute('title', 'Special customer pricing applied');
      }
      
      // Show normal price display
      priceContainers.forEach(container => {
        container.classList.remove('f-price--loading');
        container.classList.add('f-price--loaded');
        
        // Show regular price sections and hide contact for price message
        const priceRegular = container.querySelector('.f-price__regular');
        const priceSale = container.querySelector('.f-price__sale');
        const contactForPrice = container.querySelector('.f-price__contact-for-price');
        
        if (priceRegular) priceRegular.style.display = '';
        if (priceSale) priceSale.style.display = '';
        if (contactForPrice) contactForPrice.classList.add('hidden');
      });
      
      // Enable add to cart button
      enableAddToCartButton();
    } else {
      // Check again if request was cancelled before updating UI
      if (requestTracker.cancelled) {
        return;
      }
      
      // Show "contact for price" message instead of price
      priceContainers.forEach(container => {
        container.classList.remove('f-price--loading');
        container.classList.add('f-price--loaded');
        
        // Hide regular price and show contact for price message
        const priceRegular = container.querySelector('.f-price__regular');
        const priceSale = container.querySelector('.f-price__sale');
        const contactForPrice = container.querySelector('.f-price__contact-for-price');
        
        if (priceRegular) priceRegular.style.display = 'none';
        if (priceSale) priceSale.style.display = 'none';
        if (contactForPrice) contactForPrice.classList.remove('hidden');
      });
      
      // Disable add to cart button
      disableAddToCartButton();
    }
  } catch (error) {
    console.error('Error updating price display:', error);
    
    // Check if this request was cancelled while we were processing
    if (requestTracker.cancelled) {
      return;
    }
    
    // Remove loading state on error and show contact for price
    priceContainers.forEach(container => {
      container.classList.remove('f-price--loading');
      container.classList.add('f-price--loaded');
      
      // Hide regular price and show contact for price message on error
      const priceRegular = container.querySelector('.f-price__regular');
      const priceSale = container.querySelector('.f-price__sale');
      const contactForPrice = container.querySelector('.f-price__contact-for-price');
      
      if (priceRegular) priceRegular.style.display = 'none';
      if (priceSale) priceSale.style.display = 'none';
      if (contactForPrice) contactForPrice.classList.remove('hidden');
    });
    
    // Disable add to cart button on error
    disableAddToCartButton();
  } finally {
    // Clean up the request tracker
    activePriceRequests.delete(requestKey);
  }
}

/**
 * Set price loading state - useful for variant changes
 */
function setPriceLoading() {
  const priceContainers = document.querySelectorAll('.f-price');
  priceContainers.forEach(container => {
    container.classList.add('f-price--loading');
    container.classList.remove('f-price--loaded', 'f-price--no-custom-pricing');
  });
}

/**
 * Enable the add to cart button
 */
function enableAddToCartButton() {
  const addToCartButtons = document.querySelectorAll('button[name="add"], .product-form__submit');
  
  addToCartButtons.forEach(button => {
    button.disabled = false;
    button.classList.remove('btn--disabled');
    
    const btnText = button.querySelector('.btn__text');
    if (btnText) {
      btnText.textContent = 'Lägg till i varukorgen';
    }
  });
}

/**
 * Disable the add to cart button when price is not available
 */
function disableAddToCartButton() {
  const addToCartButtons = document.querySelectorAll('button[name="add"], .product-form__submit');
  
  addToCartButtons.forEach(button => {
    button.disabled = true;
    button.classList.add('btn--disabled');
  });
}

/**
 * Simple price formatter
 * @param {number} price - Price in shop's base currency
 * @returns {string} Formatted price string
 */
function formatPrice(price) {
  // This is a simple formatter - replace with your shop's actual price formatting logic
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
}

// Make functions available globally for Shopify themes
window.getCustomerPrice = getCustomerPrice;
window.getVariantMonitorId = getVariantMonitorId;
window.updatePriceDisplay = updatePriceDisplay;
window.setPriceLoading = setPriceLoading;
window.enableAddToCartButton = enableAddToCartButton;
window.disableAddToCartButton = disableAddToCartButton;
window.formatPrice = formatPrice;
