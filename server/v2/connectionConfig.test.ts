import { describe, expect, it } from "vitest";
import { getV2DrizzleCredentials, readV2ConnectionConfig } from "./connectionConfig";

const environment = {
  V2_DATABASE_URL:
    "mysql://v2%40user:password%40value@gateway.example.test:4000/legacy?ssl=true",
  V2_APP_DATABASE: "playcell_leads_v2",
};

describe("V2 TiDB connection configuration", () => {
  it("selects the V2 logical database while preserving a separate source URL", () => {
    expect(readV2ConnectionConfig(environment)).toMatchObject({
      sourceUrl: environment.V2_DATABASE_URL,
      databaseName: "playcell_leads_v2",
      targetUrl:
        "mysql://v2%40user:password%40value@gateway.example.test:4000/playcell_leads_v2?ssl=true",
      host: "gateway.example.test",
      port: 4000,
      user: "v2@user",
      password: "password@value",
    });
  });

  it("gives Drizzle structured credentials with mandatory certificate validation", () => {
    expect(getV2DrizzleCredentials(environment)).toEqual({
      host: "gateway.example.test",
      port: 4000,
      user: "v2@user",
      password: "password@value",
      database: "playcell_leads_v2",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("rejects a non-MySQL URL and unsafe logical database names", () => {
    expect(() =>
      readV2ConnectionConfig({
        ...environment,
        V2_DATABASE_URL: "https://gateway.example.test/database",
      })
    ).toThrow("protocolo mysql");
    expect(() =>
      readV2ConnectionConfig({
        ...environment,
        V2_APP_DATABASE: "v2; DROP DATABASE legacy",
      })
    ).toThrow("V2_APP_DATABASE");
  });
});
