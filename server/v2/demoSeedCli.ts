import "dotenv/config";
import { seedV2DemoData } from "./demoSeed";
import { closeV2Db } from "./database";

/**
 * Manual only: no import from startup code is allowed. This command requires
 * V2_DEMO_SEED_CONFIRM and a distinct V2_DEMO_PASSWORD before it writes.
 */
async function main() {
  try {
    const result = await seedV2DemoData();
    console.log(
      `[V2 demo seed] ${result.partnerCode} pronto (${result.createdLeads} leads novos).`
    );
  } catch (error) {
    console.error(
      "[V2 demo seed] failed",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  } finally {
    await closeV2Db();
  }
}

void main();
