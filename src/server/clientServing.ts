import path from "node:path";
import express, { type Express } from "express";

export async function configureClientServing(app: Express, serverDir: string, isProduction: boolean): Promise<void> {
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    return;
  }

  const clientDist = path.resolve(serverDir, "../../client");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}
