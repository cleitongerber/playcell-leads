import { describe, expect, it } from "vitest";
import { governanceChannelCodes } from "../../shared/governanceChannels";
import {
  assertAttemptGovernance,
  assertContactGovernance,
  assertSupportedGovernanceChannels,
  defaultAttemptGovernanceRule,
  defaultGovernanceRule,
} from "./governancePolicy";
import {
  demoSeedGovernanceChannels,
  readV2DemoSeedConfig,
} from "./demoSeed";

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

  it("uses only current governance channel codes in its remaining scenarios", () => {
    expect(demoSeedGovernanceChannels).toEqual(["whatsapp", "ligação"]);
    expect(demoSeedGovernanceChannels).not.toContain("telefone");
    expect(demoSeedGovernanceChannels).not.toContain("email");
    for (const channel of demoSeedGovernanceChannels) {
      expect(governanceChannelCodes).toContain(channel);
      expect(() =>
        assertSupportedGovernanceChannels({
          allowedChannels: [channel],
          evidenceRequiredChannels: null,
        })
      ).not.toThrow();
    }
  });

  it("keeps the remaining synthetic attempt and treatment valid under the current policy", () => {
    const channels = [...demoSeedGovernanceChannels];
    const attemptRule = {
      ...defaultAttemptGovernanceRule,
      allowedChannels: channels,
    };
    const treatmentRule = {
      ...defaultGovernanceRule,
      allowedChannels: channels,
      allowedOutcomes: ["interested"],
    };

    expect(() =>
      assertAttemptGovernance(attemptRule, {
        channel: "whatsapp",
        summary: "Cenário DEMO válido.",
      })
    ).not.toThrow();
    expect(() =>
      assertContactGovernance(treatmentRule, {
        channel: "ligação",
        outcome: "interested",
        summary: "Cenário DEMO válido.",
      })
    ).not.toThrow();
  });
});
