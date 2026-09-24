import { describe, expect, it } from "vitest";
import {
  readV2AdminRecoveryConfig,
  V2_ADMIN_RECOVERY_CONFIRMATION,
} from "./adminRecovery";

const validEnvironment = {
  V2_ADMIN_RECOVERY_CONFIRM: V2_ADMIN_RECOVERY_CONFIRMATION,
  V2_ADMIN_RECOVERY_EMAIL: "Admin@Example.Test ",
  V2_ADMIN_RECOVERY_PASSWORD: "senha-de-recuperacao-segura",
} as NodeJS.ProcessEnv;

describe("V2 Super Admin recovery guard", () => {
  it("requires an explicit confirmation marker before any database access", () => {
    expect(() =>
      readV2AdminRecoveryConfig({ ...validEnvironment, V2_ADMIN_RECOVERY_CONFIRM: "" })
    ).toThrow("Recuperação do Super Admin bloqueada");
  });

  it("requires a valid target email and a strong replacement password", () => {
    expect(() =>
      readV2AdminRecoveryConfig({ ...validEnvironment, V2_ADMIN_RECOVERY_EMAIL: "invalid" })
    ).toThrow("V2_ADMIN_RECOVERY_EMAIL");
    expect(() =>
      readV2AdminRecoveryConfig({ ...validEnvironment, V2_ADMIN_RECOVERY_PASSWORD: "short" })
    ).toThrow("V2_ADMIN_RECOVERY_PASSWORD");
  });

  it("normalizes only the email and does not expose the password", () => {
    expect(readV2AdminRecoveryConfig(validEnvironment)).toEqual({
      email: "admin@example.test",
      password: "senha-de-recuperacao-segura",
    });
  });
});
