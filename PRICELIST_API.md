# Pricelist API Documentation

## Endpoint: POST /api/pricelist

This endpoint generates customer-specific price lists in PDF or CSV format.

### Authentication
- **Public Endpoint**: Can be called from Shopify theme/storefront without authentication
- **Private App Credentials**: Uses `SHOPIFY_ACCESS_TOKEN` or `ADVANCED_STORE_ADMIN_TOKEN` environment variables
- **Shop Domain Required**: Must include shop domain in request payload for API access
- **Customer ID**: Customer ID and email must be provided in the request

### Request Format

```javascript
POST /api/pricelist
Content-Type: application/json

{
  "customer_id": 123456789,                               // Required: Shopify customer ID (numeric)
  "customer_email": "customer@example.com",               // Required
  "customer_company": "Customer Company Name",            // Optional: Customer company name
  "monitor_id": "CUSTOMER_MONITOR_ID",                    // Required: Customer's Monitor system ID (cannot be empty)
  "format": "pdf",                                        // Required: "pdf" or "csv"
  "selection_method": "collections",                      // Required: "collections", "products", or "all"
  "collections": [                                        // Required if selection_method is "collections"
    {"id": "123456", "monitor_id": "COLLECTION_MONITOR_ID"},
    {"id": "789012", "monitor_id": "COLLECTION_MONITOR_ID_2"}
  ],
  "products": [                                           // Required if selection_method is "products"
    {"id": "123456", "monitor_id": "PRODUCT_MONITOR_ID"},
    {"id": "789012", "monitor_id": "PRODUCT_MONITOR_ID_2"}
  ],
  "shop": "mystore.myshopify.com"                        // Required: actual Shopify shop domain
}
```

### Selection Methods

1. **collections**: Generate price list for specific collections
   - Include `collections` array with collection IDs
   
2. **products**: Generate price list for specific products
   - Include `products` array with product IDs
   
3. **all**: Generate price list for all products
   - No additional parameters needed

### Response Formats

#### PDF Format
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="price-list-{timestamp}.pdf"`
- Returns binary PDF data

#### CSV Format
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="price-list-{timestamp}.csv"`
- Returns CSV data with semicolon (;) delimiter

### CSV Columns
- Produkt (Product Title)
- Variant (Variant Title)
- Artikelnummer (SKU)
- Ursprungspris (Original Price)
- Kundpris (Customer Price)
- Formaterat pris (Formatted Price)
- Pristyp (Price Type)
- Monitor ID

### Price Types
- **Outlet**: Outlet pricing from Monitor system
- **Kundspecifik**: Customer-specific pricing
- **Ingen prissättning**: No pricing available
- **Fel**: Error occurred during price lookup

### Template Code Fix

In your Shopify template, ensure the fetch URL includes the `https://` protocol:

```javascript
// INCORRECT (from original template):
const response = await fetch('monitor-api-connect-production.up.railway.app/api/pricelist', {

// CORRECT:
const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/pricelist', {
```

### CORS Handling

The endpoint properly handles CORS preflight requests (OPTIONS) and includes appropriate headers for cross-origin requests. The API includes both a `loader` function (for GET/OPTIONS requests) and an `action` function (for POST requests) to comply with Remix routing requirements.

### Enhanced Logging

The endpoint includes comprehensive logging to help with debugging:

- **Request logging**: Full payload dump and parsed field values
- **Product processing**: Number of products found and processed
- **Pricing logic**: Detailed logs for each variant pricing lookup
- **Monitor API calls**: Logs for outlet pricing and customer-specific pricing calls
- **Customer Monitor ID**: Logs showing which customer Monitor ID is being used

All logs are prefixed with descriptive markers for easy identification in Railway logs.

### Complete Template Integration

```liquid
<script>
document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('priceListForm');
  const selectionMethods = document.querySelectorAll('input[name="selectionMethod"]');
  const collectionsSection = document.getElementById('collectionsSelection');
  const productsSection = document.getElementById('productsSelection');
  const productSearch = document.getElementById('productSearch');
  const searchResults = document.getElementById('productSearchResults');
  const selectedProductsList = document.getElementById('selectedProductsList');
  const loadingState = document.getElementById('loadingState');
  const downloadBtn = document.getElementById('downloadBtn');
  
  // Use array instead of Set for better compatibility
  let selectedProducts = [];
  let searchTimeout;

  // Handle selection method changes
  selectionMethods.forEach(method => {
    method.addEventListener('change', function() {
      const value = this.value;
      collectionsSection.style.display = value === 'collections' ? 'block' : 'none';
      productsSection.style.display = value === 'products' ? 'block' : 'none';
    });
  });

  // Product search functionality
  if (productSearch) {
    productSearch.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      const query = this.value.trim();
      
      if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
      }

      searchTimeout = setTimeout(() => {
        searchProducts(query);
      }, 300);
    });
  }

  // Note: For Monitor IDs to work with product search, you'll need to:
  // 1. Create a custom product search endpoint that includes variant metafields
  // 2. Or use a different approach like pre-loading product data in the template
  
  async function searchProducts(query) {
    try {
      const response = await fetch(`/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`);
      const data = await response.json();
      
      displaySearchResults(data.resources.results.products || []);
    } catch (error) {
      console.error('Search error:', error);
    }
  }

  function displaySearchResults(products) {
    searchResults.innerHTML = products.map(product => `
      <div class="product-item" data-product-id="${product.id}" data-product-title="${product.title}">
        <span>${product.title}</span>
        <button type="button" onclick="addProduct(${product.id}, '${product.title.replace(/'/g, "\\'")}', '')">Lägg till</button>
      </div>
    `).join('');
  }

  window.addProduct = function(id, title, monitorId = '') {
    // Check if product is already selected
    const existingProduct = selectedProducts.find(p => p.id === id);
    if (!existingProduct) {
      selectedProducts.push({
        id: id, 
        title: title,
        monitor_id: monitorId // Will be empty for search results, backend will fetch
      });
      updateSelectedProductsDisplay();
      console.log('Added product:', id, title, 'Monitor ID:', monitorId);
    }
  };

  window.removeProduct = function(id) {
    selectedProducts = selectedProducts.filter(product => product.id !== id);
    updateSelectedProductsDisplay();
    console.log('Removed product:', id);
  };

  function updateSelectedProductsDisplay() {
    selectedProductsList.innerHTML = selectedProducts.map(product => `
      <span class="selected-product">
        ${product.title}
        <span class="remove-product" onclick="removeProduct(${product.id})">×</span>
      </span>
    `).join('');
    console.log('Selected products:', selectedProducts);
  }

  // Form submission
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    console.log('Form submitted');
    
    const formData = new FormData(form);
    const selectionMethod = formData.get('selectionMethod');
    const format = formData.get('format');
    
    console.log('Selection method:', selectionMethod);
    console.log('Format:', format);
    
    let payload = {
      customer_id: {{ customer.id }},
      customer_email: "{{ customer.email }}",
      customer_company: "{{ customer.metafields.custom.company | default: '' }}",
      monitor_id: "{{ customer.metafields.custom.monitor_id | default: '' }}",
      format: format,
      selection_method: selectionMethod,
      shop: "{{ shop.domain }}"  // Add shop domain to payload
    };

    // Add selection data based on method
    if (selectionMethod === 'collections') {
      // Send simple array of collection IDs for compatibility
      const selectedCollectionIds = Array.from(formData.getAll('collections[]'));
      payload.collections = selectedCollectionIds;
      console.log('Selected collections:', payload.collections);
    } else if (selectionMethod === 'products') {
      // Send simple array of product IDs for compatibility
      payload.products = selectedProducts.map(p => p.id);
      console.log('Selected products:', payload.products);
    }

    console.log('Final payload:', payload);

    // Show loading state
    form.style.display = 'none';
    loadingState.style.display = 'block';

    try {
      console.log('Making request to API...');
      const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/pricelist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        console.log('Response successful, downloading file...');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `price-list-${new Date().getTime()}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        console.log('File download triggered');
      } else {
        console.error('API request failed with status:', response.status);
        let errorMessage = 'Failed to generate price list';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          console.error('Error data:', errorData);
        } catch (parseError) {
          console.error('Could not parse error response:', parseError);
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Request error:', error);
      alert(`Error generating price list: ${error.message}`);
    } finally {
      // Hide loading state
      form.style.display = 'block';
      loadingState.style.display = 'none';
    }
  });
});
</script>
```

### Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success with file download
- `400`: Bad request (missing required fields, invalid format, etc.)
- `500`: Internal server error

Error responses include JSON with `error` and optional `details` fields:

```json
{
  "error": "Customer ID is required",
  "details": "Additional error information"
}
```

### Dependencies

The endpoint requires this npm package:
- `pdfkit`: For PDF generation

Install with:

```bash
npm install pdfkit
```

CSV generation is handled natively without external dependencies.

### Notes

1. The endpoint fetches products using Shopify's GraphQL API
2. Pricing is retrieved from the Monitor system using existing pricing logic
3. PDF generation includes proper Swedish formatting and pagination
4. CSV uses semicolon delimiter for Excel compatibility
5. All prices are formatted in Swedish Krona (SEK)
6. The endpoint supports CORS for cross-origin requests