# Pricelist API Documentation

## Endpoint: POST /api/pricelist

This endpoint generates customer-specific price lists in PDF or CSV format.

### Authentication
- No authentication required for the endpoint itself
- Customer ID and email must be provided in the request
- The endpoint uses the shop's existing Shopify session for product data access

### Request Format

```javascript
POST /api/pricelist
Content-Type: application/json

{
  "customer_id": "gid://shopify/Customer/123456789",  // Required
  "customer_email": "customer@example.com",           // Required
  "format": "pdf",                                    // Required: "pdf" or "csv"
  "selection_method": "collections",                  // Required: "collections", "products", or "all"
  "collections": ["123456", "789012"],               // Required if selection_method is "collections"
  "products": ["123456", "789012"],                  // Required if selection_method is "products"
  "shop": "mystore.myshopify.com"                    // Optional: shop domain
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
- Tillgänglighet (Availability)
- Lagersaldo (Inventory Quantity)
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

### Complete Template Integration

```liquid
<script>
// Form submission
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const formData = new FormData(form);
  const selectionMethod = formData.get('selectionMethod');
  const format = formData.get('format');
  
  let payload = {
    customer_id: "gid://shopify/Customer/{{ customer.id }}",
    customer_email: "{{ customer.email }}",
    format: format,
    selection_method: selectionMethod
  };

  // Add selection data based on method
  if (selectionMethod === 'collections') {
    payload.collections = Array.from(formData.getAll('collections[]'));
  } else if (selectionMethod === 'products') {
    payload.products = Array.from(selectedProducts).map(p => p.id);
  }

  // Show loading state
  form.style.display = 'none';
  loadingState.style.display = 'block';

  try {
    const response = await fetch('https://monitor-api-connect-production.up.railway.app/api/pricelist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `price-list-${new Date().getTime()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate price list');
    }
  } catch (error) {
    console.error('Error:', error);
    alert(`Error generating price list: ${error.message}`);
  } finally {
    // Hide loading state
    form.style.display = 'block';
    loadingState.style.display = 'none';
  }
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