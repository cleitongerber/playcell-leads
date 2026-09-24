import { defineConfig } from "drizzle-kit";

// V2 migrations intentionally require their own connection variable. They
// cannot accidentally run against the deployed V1 DATABASE_URL.
const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) {
  throw new Error("V2_DATABASE_URL is required to run V2 drizzle commands");
}
const databaseName = process.env.V2_APP_DATABASE?.trim();
if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error("V2_APP_DATABASE is required to run V2 drizzle commands");
}
const targetUrl = new URL(connectionString);
targetUrl.pathname = `/${databaseName}`;

export default defineConfig({
  schema: "./drizzle-v2/schema.ts",
  out: "./drizzle-v2",
  dialect: "mysql",
  dbCredentials: {
    url: targetUrl.toString(),
  },
});
