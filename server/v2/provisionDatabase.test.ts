import { describe, expect, it } from "vitest";
import { readV2DatabaseProvisionConfig } from "./provisionDatabase";

describe("V2 database provision guard", () => {
  it("requires the isolated V2 connection and a safe database identifier", () => {
    expect(() => readV2DatabaseProvisionConfig({})).toThrow("V2_DATABASE_URL");
    expect(() =>
      readV2DatabaseProvisionConfig({
        V2_DATABASE_URL: "mysql://example.test/v1",
        V2_APP_DATABASE: "v2; DROP DATABASE v1",
      })
    ).toThrow("V2_APP_DATABASE");
  });

  it("rejects a non-MySQL URL before opening a connection", () => {
    expect(() =>
      readV2DatabaseProvisionConfig({
        V2_DATABASE_URL: "https://example.test/database",
        V2_APP_DATABASE: "playcell_leads_v2",
      })
    ).toThrow("protocolo mysql");
  });

  it("keeps the source connection and target database distinct", () => {
    expect(
      readV2DatabaseProvisionConfig({
        V2_DATABASE_URL: "mysql://user:password@example.test:4000/legacy",
        V2_APP_DATABASE: "playcell_leads_v2",
      })
    ).toEqual({
      sourceUrl: "mysql://user:password@example.test:4000/legacy",
      databaseName: "playcell_leads_v2",
    });
  });
});
