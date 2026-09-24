import "dotenv/config";
import { closeV2Db } from "./database";
import { recoverV2SuperAdmin } from "./adminRecovery";

/**
 * Explicit, one-time credential repair command. The confirmation marker and
 * new password must be supplied as deployment secrets; neither is printed.
 */
async function main() {
  try {
    await recoverV2SuperAdmin();
    console.log("[V2 admin recovery] completed");
  } catch (error) {
    console.error(
      "[V2 admin recovery] failed",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  } finally {
    await closeV2Db();
  }
}

void main();
