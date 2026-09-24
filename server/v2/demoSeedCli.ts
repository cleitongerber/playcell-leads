import "dotenv/config";
import { seedV2DemoData } from "./demoSeed";

/**
 * Manual only: no import from startup code is allowed. This command requires
 * V2_DEMO_SEED_CONFIRM and a distinct V2_DEMO_PASSWORD before it writes.
 */
seedV2DemoData()
  .then(result => {
    console.log(
      `[V2 demo seed] ${result.partnerCode} pronto (${result.createdLeads} leads novos).`
    );
    process.exitCode = 0;
  })
  .catch(error => {
    console.error(
      "[V2 demo seed] failed",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  });
