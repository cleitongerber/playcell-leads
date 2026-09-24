import { defineConfig } from "drizzle-kit";
import { getV2DrizzleCredentials } from "./server/v2/connectionConfig";

// V2 migrations intentionally require their own connection variable. They
// cannot accidentally run against the deployed V1 DATABASE_URL.

export default defineConfig({
  schema: "./drizzle-v2/schema.ts",
  out: "./drizzle-v2",
  dialect: "mysql",
  dbCredentials: {
    ...getV2DrizzleCredentials(),
  },
});
