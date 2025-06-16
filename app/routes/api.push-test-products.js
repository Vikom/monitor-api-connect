import { json } from "@remix-run/node";
import { fetchProductsFromThirdParty } from "../utils/thirdPartyApi";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const products = await fetchProductsFromThirdParty();
  const results = [];
  for (const product of products) {
    const response = await admin.graphql(
      `#graphql
        mutation productCreate($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product { id title status }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          product: {
            title: product.name,
            status: "ACTIVE",
            variants: [
              {
                price: product.price.toString(),
                inventoryQuantity: product.stock,
              },
            ],
          },
        },
      }
    );
    const jsonRes = await response.json();
    results.push(jsonRes.data.productCreate);
  }
  return json({ results });
};
