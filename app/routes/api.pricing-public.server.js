// Server-only helper functions for api.pricing-public route
import { fetchDiscountCategoryRowFromMonitor } from "../utils/monitor.server.js";

/**
 * Apply discount category discount to a price
 */
export async function applyDiscountCategoryDiscount(priceListPrice, customerDiscountCategory, partCodeId) {
  if (!customerDiscountCategory || !partCodeId) {
    return priceListPrice;
  }

  const discountRow = await fetchDiscountCategoryRowFromMonitor(customerDiscountCategory, partCodeId);
  
  if (discountRow && discountRow.Discount1 > 0) {
    const discountPercentage = discountRow.Discount1;
    const discountedPrice = priceListPrice * (discountPercentage / 100);
    return discountedPrice;
  }
  
  return priceListPrice;
}
