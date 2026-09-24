import "dotenv/config";
import { bootstrapV2SuperAdmin } from "./bootstrap";

/**
 * Explicit post-migration bootstrap command. It is deliberately not called at
 * HTTP-server startup, so deployment of V1 cannot write to a V2 database.
 */
bootstrapV2SuperAdmin()
  .then(result => {
    console.log(`[V2 bootstrap] ${result.reason}`);
    process.exitCode = 0;
  })
  .catch(error => {
    console.error("[V2 bootstrap] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
