import express, { type Express, type Response } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

/**
 * A missing worker script must never be answered with the SPA document. Browsers
 * reject that response because its MIME type is text/html, which makes PWA
 * diagnostics misleading and prevents safe future Push registration.
 */
function isJavaScriptAssetRequest(originalUrl: string): boolean {
  const pathname = new URL(originalUrl, "http://localhost").pathname;
  return /\.(?:[cm]?js)$/i.test(pathname);
}

function rejectMissingJavaScriptAsset(
  originalUrl: string,
  res: Response
): boolean {
  if (!isJavaScriptAssetRequest(originalUrl)) return false;
  res.status(404).type("text/plain").send("Not found");
  return true;
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    if (rejectMissingJavaScriptAsset(url, res)) return;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (req, res) => {
    if (rejectMissingJavaScriptAsset(req.originalUrl, res)) return;
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
