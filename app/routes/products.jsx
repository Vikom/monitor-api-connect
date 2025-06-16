// app/routes/products.jsx
import { useLoaderData } from "@remix-run/react";

export const loader = async () => {
  // Fetch from the internal API route
  const res = await fetch("/api/products");
  const { products } = await res.json();
  return { products };
};

export default function Products() {
  const { products } = useLoaderData();
  return (
    <div>
      <h1>Products from Third Party</h1>
      <ul>
        {products?.map((product) => (
          <li key={product.id}>
            {product.name} - Stock: {product.stock} - Price: ${product.price}
          </li>
        ))}
      </ul>
    </div>
  );
}
