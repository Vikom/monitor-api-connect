import { useFetcher } from "@remix-run/react";
import { Page, Card, Button, BlockStack, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { fetchProductsFromThirdParty } from "../utils/monitor";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const products = await fetchProductsFromThirdParty();
  const results = [];
  for (const product of products) {
    // Create product in Shopify using GraphQL Admin API
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
    const json = await response.json();
    results.push(json.data.productCreate);
  }
  return { results };
};

export default function PublishProducts() {
  const fetcher = useFetcher();
  const isLoading = fetcher.state === "submitting";
  const results = fetcher.data?.results;

  return (
    <Page>
      <TitleBar title="Publish Test Products" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Publish all test products to your Shopify store
            </Text>
            <fetcher.Form method="post">
              <Button submit primary loading={isLoading}>
                Publish Test Products
              </Button>
            </fetcher.Form>
            {results && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Results:</Text>
                <ul>
                  {results.map((result, idx) => (
                    <li key={idx}>
                      {result.product ? (
                        <span>
                          ✅ {result.product.title} published
                        </span>
                      ) : (
                        <span>
                          ❌ Error: {result.userErrors.map(e => e.message).join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
