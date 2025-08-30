import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getDynamicPrice } from "../utils/pricing.js";

export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);
    const body = await request.json();
    const { variantId, customerId } = body;

    // All users must be logged in - customerId is required
    if (!customerId) {
      return json({ error: "Customer ID is required - no anonymous pricing allowed" }, { status: 400 });
    }

    if (!variantId) {
      return json({ error: "Variant ID is required" }, { status: 400 });
    }

    // Get variant details including metafields and price
    const variantResponse = await admin.graphql(`
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          id
          price
          metafields(first: 10) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    `, {
      variables: { id: variantId }
    });

    const variantData = await variantResponse.json();
    const variant = variantData.data?.productVariant;

    if (!variant) {
      return json({ error: "Variant not found" }, { status: 404 });
    }

    // Find Monitor ID metafield
    const monitorIdMetafield = variant.metafields.edges.find(
      edge => edge.node.namespace === "custom" && edge.node.key === "monitor_id"
    );

    if (!monitorIdMetafield) {
      // No Monitor ID, return standard price (outlet pricing already handled in sync)
      return json({ price: parseFloat(variant.price) });
    }

    const variantMonitorId = monitorIdMetafield.node.value;
    const standardPrice = parseFloat(variant.price);

    // Get customer's Monitor ID
    const customerResponse = await admin.graphql(`
      query getCustomer($id: ID!) {
        customer(id: $id) {
          id
          metafields(first: 10) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    `, {
      variables: { id: customerId }
    });

    const customerData = await customerResponse.json();
    const customer = customerData.data?.customer;

    if (!customer) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    // Find customer's Monitor ID metafield
    const customerMonitorIdMetafield = customer.metafields.edges.find(
      edge => edge.node.namespace === "custom" && edge.node.key === "monitor_id"
    );

    if (!customerMonitorIdMetafield) {
      // Customer has no Monitor ID, return standard price
      return json({ 
        price: standardPrice,
        message: "Customer has no Monitor ID - using standard price"
      });
    }

    const customerMonitorId = customerMonitorIdMetafield.node.value;

    // Get dynamic price using the 3-tier hierarchy
    const dynamicPrice = await getDynamicPrice(variantMonitorId, customerMonitorId, standardPrice);
    
    return json({ 
      price: dynamicPrice,
      metadata: {
        variantMonitorId,
        customerMonitorId,
        standardPrice,
        priceSource: dynamicPrice === standardPrice ? "standard" : "dynamic"
      }
    });

  } catch (error) {
    console.error("Pricing API error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
