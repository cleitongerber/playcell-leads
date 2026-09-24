import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(
  fileURLToPath(new URL("./db.ts", import.meta.url)),
  "utf8"
);
const migrationsJournal = readFileSync(
  fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url)),
  "utf8"
);
const serverSource = readFileSync(
  fileURLToPath(new URL("./_core/index.ts", import.meta.url)),
  "utf8"
);

describe("database startup safety", () => {
  it("does not execute cleanup, DDL, or operational deletes from the connection path", () => {
    expect(dbSource).not.toContain("runRequestedLeadCleanup");
    expect(dbSource).not.toContain("initialSchemaStatements");
    expect(dbSource).not.toMatch(/CREATE\s+(?:DATABASE|TABLE|INDEX)/i);
    expect(dbSource).not.toMatch(/ALTER\s+TABLE/i);
    expect(dbSource).not.toMatch(/DELETE\s+FROM/i);
  });

  it("keeps the schema definition in versioned Drizzle migrations", () => {
    expect(
      existsSync(
        fileURLToPath(
          new URL("../drizzle/0000_parched_kylun.sql", import.meta.url)
        )
      )
    ).toBe(true);
    expect(migrationsJournal).toContain('"tag": "0004_campaigns"');
    expect(migrationsJournal).toContain(
      '"tag": "0005_password_reset_requests"'
    );
    expect(migrationsJournal).toContain('"tag": "0006_campaign_freeze"');
  });

  it("does not mount or bootstrap V1 when the explicit V2 cutover flag is on", () => {
    expect(serverSource).toContain('const v2Mode = process.env.V2_ENABLE_API === "true"');
    expect(serverSource).toContain("if (v2Mode) {");
    expect(serverSource).toContain("if (!v2Mode) {");
    expect(serverSource).toContain("V2's first Super Admin is always created by its explicit CLI command");
  });
});
