/**
 * Client-side helper for calling the pricing API
 * This can be used in your Shopify theme
 * Note: All customers must be logged in - no anonymous pricing supported
 */

/**
 * Get dynamic price for a single variant for a logged-in customer
 * @param {string} variantId - Shopify variant ID (gid://shopify/ProductVariant/...)
 * @param {string} customerId - Shopify customer ID (required)
 * @returns {Promise<{price: number, metadata?: object}>}
 */
async function getCustomerPrice(variantId, customerId) {
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
      monitorId: window.currentVariantMonitorId || null,
      isOutletProduct: window.isOutletProduct || false,
      customerMonitorId: window.customerMonitorId || null
    };

    // console.log('=== API REQUEST DEBUG ===');
    // console.log('API URL:', apiUrl);
    // console.log('Request body:', requestBody);
    // console.log('=== END API REQUEST DEBUG ===');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    // console.log('=== API RESPONSE DEBUG ===');
    // console.log('Response status:', response.status);
    // console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response text:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const data = await response.json();
    // console.log('Response data:', data);
    // console.log('=== END API RESPONSE DEBUG ===');
    
    return data;
  } catch (error) {
    console.error('Error fetching customer price:', error);
    throw error;
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

  try {
    // console.log('=== PRICE DISPLAY UPDATE DEBUG ===');
    // console.log('Variant ID:', variantId);
    // console.log('Price selector:', priceSelector);
    // console.log('Customer ID:', customerId);
    
    const priceData = await getCustomerPrice(variantId, customerId);
    // console.log('Received price data:', priceData);
    
    const priceElement = document.querySelector(priceSelector);
    // console.log('Found price element:', priceElement);
    
    if (priceElement && priceData.price) {
      // Format price according to shop's currency settings
      const formattedPrice = formatPrice(priceData.price);
      // console.log('Formatted price:', formattedPrice);
      // console.log('Old price text:', priceElement.textContent);
      
      priceElement.textContent = formattedPrice;
      // console.log('New price text:', priceElement.textContent);
      
      // Add a data attribute to indicate dynamic pricing
      if (priceData.metadata?.priceSource === 'dynamic') {
        priceElement.setAttribute('data-dynamic-price', 'true');
        priceElement.setAttribute('title', 'Special customer pricing applied');
      }
      
      // console.log('Price update completed successfully');
    } else {
      console.log('Price element not found or no price data:', { 
        priceElement: !!priceElement, 
        priceData: priceData,
        priceValue: priceData?.price 
      });
    }
    // console.log('=== END PRICE DISPLAY DEBUG ===');
  } catch (error) {
    console.error('Error updating price display:', error);
  }
}

/**
 * Simple price formatter (you may want to use your shop's actual formatter)
 * @param {number} price - Price in shop's base currency
 * @returns {string} Formatted price string
 */
function formatPrice(price) {
  // This is a simple formatter - replace with your shop's actual price formatting logic
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: 2
  }).format(price);
}

/**
 * Example usage in a Shopify theme:
 * 
 * // On product page - customer must be logged in
 * window.addEventListener('DOMContentLoaded', async () => {
 *   if (!window.customer?.id) {
 *     console.log('Customer not logged in - no pricing available');
 *     return;
 *   }
 *   
 *   const variantId = 'gid://shopify/ProductVariant/123456789';
 *   const customerId = `gid://shopify/Customer/${window.customer.id}`;
 *   
 *   await updatePriceDisplay(variantId, '.price', customerId);
 * });
 * 
 * // On variant change
 * document.addEventListener('variant:change', async (event) => {
 *   if (!window.customer?.id) return;
 *   
 *   const variantId = event.detail.variantId;
 *   const customerId = `gid://shopify/Customer/${window.customer.id}`;
 *   
 *   await updatePriceDisplay(variantId, '.price', customerId);
 * });
 */

// Make functions available globally for Shopify themes
window.getCustomerPrice = getCustomerPrice;
window.updatePriceDisplay = updatePriceDisplay;
window.formatPrice = formatPrice;
