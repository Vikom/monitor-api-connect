/**
 * Client-side helper for real-time stock updates from Monitor API
 * Calls the Railway app to fetch fresh stock data each time a variant is viewed.
 * The request is non-blocking - the page renders immediately.
 */

const WAREHOUSE_DISPLAY_NAMES = {
  goteborg: 'Göteborg',
  lund: 'Lund',
  ronas: 'Rönås',
  stockholm: 'Stockholm',
  sundsvall: 'Sundsvall',
  vittsjo: 'Vittsjö'
};

/**
 * Fetch updated stock for a variant from the Railway app
 * @param {string} monitorId - Monitor Part ID
 * @param {string} variantId - Shopify variant GID (e.g. gid://shopify/ProductVariant/123)
 * @returns {Promise<{stock: object, shopifyUpdated: boolean}|null>}
 */
async function fetchUpdatedStock(monitorId, variantId) {
  if (!monitorId) return null;

  try {
    const apiUrl = window.pricingApiUrl
      ? `https://${window.pricingApiUrl}/api/stock-update`
      : '/api/stock-update';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monitorId,
        variantId,
        shop: window.Shopify?.shop || window.location.hostname
      })
    });

    if (!response.ok) {
      console.error('[Stock] Error response:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[Stock] Error fetching updated stock:', error);
    return null;
  }
}

/**
 * Update the stock display on the product page with fresh data
 * @param {object} stockByName - e.g. { goteborg: 5, lund: 0, vittsjo: 12, ... }
 */
function updateStockDisplay(stockByName) {
  const stockContainer = document.querySelector('.stock-container');
  if (!stockContainer) return;

  // Build new stock HTML
  let stockHtml = '';
  let totalStock = 0;
  const orderedWarehouses = ['goteborg', 'lund', 'ronas', 'stockholm', 'sundsvall', 'vittsjo'];

  orderedWarehouses.forEach(name => {
    const balance = stockByName[name] || 0;
    totalStock += balance;

    if (balance > 0) {
      const displayName = WAREHOUSE_DISPLAY_NAMES[name];
      const formattedBalance = balance.toLocaleString('sv-SE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).replace('.', ',');
      stockHtml += `
        <p class="product__inventory product__inventory--in-stock font-body-bolder">
          <span class="product__inventory-icon"></span>
          <span class="product__inventory-text">${displayName} (${formattedBalance})</span>
        </p>`;
    }
  });

  // Add divider
  stockHtml += `
    <div class="product__block--divider-stock">
      <div class="product__divider no-empty"></div>
    </div>`;

  // If no stock, show order/out-of-stock status
  if (totalStock === 0) {
    // Check stock_control from the variant metafield on the page
    const stockControlEl = document.querySelector('[data-stock-control]');
    const stockControlStr = stockControlEl ? stockControlEl.dataset.stockControl : '';
    const hasOrderLocation = stockControlStr.includes('"order"');

    if (hasOrderLocation) {
      stockHtml += `
        <p class="product__inventory product__inventory--in-stock font-body-bolder">
          <span class="product__inventory-icon"></span>
          <span class="product__inventory-text">Beställningsvara</span>
        </p>`;
    } else {
      stockHtml += `
        <p class="product__inventory product__inventory--out-of-stock font-body-bolder">
          <span class="product__inventory-icon"></span>
          <span class="product__inventory-text">Slut i lager</span>
        </p>`;
    }
  }

  stockContainer.innerHTML = stockHtml;
}

// Track current stock request to handle variant changes
let currentStockRequest = null;

/**
 * Trigger a non-blocking stock update for a variant
 * @param {string} variantId - Shopify variant GID
 */
function triggerStockUpdate(variantId) {
  // Cancel any previous request tracking
  if (currentStockRequest) {
    currentStockRequest.cancelled = true;
  }

  const monitorId = window.getVariantMonitorId
    ? window.getVariantMonitorId(variantId)
    : (window.variantMonitorIds && window.variantMonitorIds[variantId.replace('gid://shopify/ProductVariant/', '')]);

  if (!monitorId) {
    console.log('[Stock] No monitor ID for variant', variantId);
    return;
  }

  const tracker = { cancelled: false };
  currentStockRequest = tracker;

  // Fire and forget - don't await
  fetchUpdatedStock(monitorId, variantId).then(data => {
    if (tracker.cancelled || !data || !data.stock) return;
    console.log('[Stock] Updated stock data:', data.stock);
    updateStockDisplay(data.stock);
  });
}

// Make functions available globally
window.fetchUpdatedStock = fetchUpdatedStock;
window.updateStockDisplay = updateStockDisplay;
window.triggerStockUpdate = triggerStockUpdate;
