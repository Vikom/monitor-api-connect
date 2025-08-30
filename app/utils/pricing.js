import { fetchCustomerPriceFromMonitor, fetchCustomerFromMonitor, fetchPriceListPriceFromMonitor } from "./monitor.js";

/**
 * Get dynamic pricing for a product variant based on customer
 * Implements the 3-tier pricing logic:
 * 1. Outlet products have fixed outlet prices (handled in sync)
 * 2. Customer-specific pricing
 * 3. Customer's price list pricing
 * 
 * @param {string} variantMonitorId - Monitor part ID from variant metafield
 * @param {string} customerMonitorId - Monitor customer ID from customer metafield
 * @param {number} fallbackPrice - Standard price to use if no special pricing found
 * @returns {Promise<number>} The final price to use
 */
export async function getDynamicPrice(variantMonitorId, customerMonitorId, fallbackPrice) {
  try {
    // Step 1: Check for customer-specific pricing
    console.log(`Checking customer-specific pricing for customer ${customerMonitorId} and part ${variantMonitorId}`);
    const customerPrice = await fetchCustomerPriceFromMonitor(customerMonitorId, variantMonitorId);
    
    if (customerPrice !== null) {
      console.log(`Found customer-specific price: ${customerPrice}`);
      return customerPrice;
    }
    
    // Step 2: Get customer's price list and check for price list pricing
    console.log(`No customer-specific price found, checking price list pricing`);
    const customer = await fetchCustomerFromMonitor(customerMonitorId);
    
    if (customer && customer.PriceListId) {
      console.log(`Customer has price list ID: ${customer.PriceListId}`);
      const priceListPrice = await fetchPriceListPriceFromMonitor(customer.PriceListId, variantMonitorId);
      
      if (priceListPrice !== null) {
        console.log(`Found price list price: ${priceListPrice}`);
        return priceListPrice;
      }
    }
    
    // Step 3: Use fallback price (standard price or outlet price from sync)
    console.log(`No special pricing found, using fallback price: ${fallbackPrice}`);
    return fallbackPrice;
    
  } catch (error) {
    console.error(`Error getting dynamic price for variant ${variantMonitorId} and customer ${customerMonitorId}:`, error);
    return fallbackPrice;
  }
}

// Note: Bulk pricing functionality will be added in the future
// when the client wants to control bulk pricing from Monitor
