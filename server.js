import { createRequestHandler } from "@remix-run/express";
import { broadcastDevReady } from "@remix-run/node";
import express from "express";

const PORT = process.env.PORT || 3000;
const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? null
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const app = express();
app.use(
  viteDevServer
    ? viteDevServer.middlewares
    : express.static("build/client")
);

const build = viteDevServer
  ? () =>
      viteDevServer.ssrLoadModule(
        "virtual:remix/server-build"
      )
  : await import("./build/server/index.js");

app.all("*", createRequestHandler({ build }));

app.listen(PORT, HOST, () => {
  console.log(`App listening on http://${HOST}:${PORT}`);

  if (process.env.NODE_ENV === "development") {
    broadcastDevReady(build);
  }
});
