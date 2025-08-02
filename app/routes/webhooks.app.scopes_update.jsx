import { authenticateWebhook } from "../utils/auth.server.js";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticateWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  return new Response();
};
