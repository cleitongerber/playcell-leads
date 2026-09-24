import "dotenv/config";
import { provisionV2Database } from "./provisionDatabase";

/** Explicit infrastructure step for a clean V2 database, never HTTP startup. */
provisionV2Database()
  .then(result => {
    console.log(`[V2 provision] database ready: ${result.databaseName}`);
    process.exitCode = 0;
  })
  .catch(error => {
    console.error(
      "[V2 provision] failed",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  });
