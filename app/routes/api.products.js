// app/routes/api.products.js
import { json } from "@remix-run/node";
import { fetchProductsFromThirdParty } from "../utils/monitor";

export const loader = async () => {
  try {
    const products = await fetchProductsFromThirdParty();
    return json({ products });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
};
