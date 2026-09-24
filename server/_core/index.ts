import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { serveStatic, setupVite } from "./vite";
import { v2FoundationRouter } from "../v2/router";
import { createV2Context } from "../v2/context";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const v2Mode = process.env.V2_ENABLE_API === "true";

  if (
    v2Mode &&
    (!process.env.V2_DATABASE_URL ||
      !process.env.V2_APP_DATABASE ||
      !process.env.V2_SESSION_SECRET)
  ) {
    throw new Error(
      "V2_ENABLE_API requer V2_DATABASE_URL, V2_APP_DATABASE e V2_SESSION_SECRET configurados"
    );
  }

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  if (v2Mode) {
    // Cutover mode intentionally mounts only the V2 API. This prevents legacy
    // bootstrap, OAuth, storage proxy, and V1 database routes from operating
    // after the published service is switched to V2.
    app.use(
      "/api/v2/trpc",
      createExpressMiddleware({
        router: v2FoundationRouter,
        createContext: createV2Context,
      })
    );
  } else {
    const [
      { registerOAuthRoutes },
      { registerStorageProxy },
      { appRouter },
      { createContext },
      { bootstrapAdmin },
    ] = await Promise.all([
      import("./oauth"),
      import("./storageProxy"),
      import("../routers"),
      import("./context"),
      import("../localAuth"),
    ]);
    registerStorageProxy(app);
    registerOAuthRoutes(app);
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: appRouter,
        createContext,
      })
    );
    // V1 only: V2's Super Admin remains an explicit CLI/bootstrap step.
    server.once("listening", () => {
      bootstrapAdmin().catch(error =>
        console.error("[Auth] Initial admin bootstrap failed", error)
      );
    });
  }
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
