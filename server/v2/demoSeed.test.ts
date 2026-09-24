import { describe, expect, it } from "vitest";
import { readV2DemoSeedConfig } from "./demoSeed";

const validEnvironment = {
  V2_DEMO_SEED_CONFIRM: "PLAYCELL_V2_DEMO",
  V2_SUPER_ADMIN_EMAIL: "admin@example.test",
  V2_DEMO_PASSWORD: "demo-password-123",
} as NodeJS.ProcessEnv;

describe("V2 demo seed guard", () => {
  it("requires an explicit confirmation marker before any database access", () => {
    expect(() =>
      readV2DemoSeedConfig({ ...validEnvironment, V2_DEMO_SEED_CONFIRM: "" })
    ).toThrow("Seed de homologação bloqueado");
  });

  it("requires an existing Super Admin identity and a non-trivial demo password", () => {
    expect(() =>
      readV2DemoSeedConfig({ ...validEnvironment, V2_SUPER_ADMIN_EMAIL: "" })
    ).toThrow("V2_SUPER_ADMIN_EMAIL");
    expect(() =>
      readV2DemoSeedConfig({ ...validEnvironment, V2_DEMO_PASSWORD: "short" })
    ).toThrow("V2_DEMO_PASSWORD");
  });

  it("reads a valid explicit configuration", () => {
    expect(readV2DemoSeedConfig(validEnvironment)).toEqual({
      superAdminEmail: "admin@example.test",
      demoPassword: "demo-password-123",
    });
  });
});
