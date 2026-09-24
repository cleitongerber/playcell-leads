import "dotenv/config";
import { bootstrapV2SuperAdmin } from "./bootstrap";
import { closeV2Db } from "./database";

/**
 * Explicit post-migration bootstrap command. It is deliberately not called at
 * HTTP-server startup, so deployment of V1 cannot write to a V2 database.
 */
async function main() {
  try {
    const result = await bootstrapV2SuperAdmin();
    console.log(`[V2 bootstrap] ${result.reason}`);
  } catch (error) {
    console.error("[V2 bootstrap] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeV2Db();
  }
}

void main();
