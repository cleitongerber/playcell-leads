import { describe, expect, it } from "vitest";
import { readSyntheticDispatchCliConfig } from "./followUpNotificationDispatchCliConfig";

const environment = {
  V2_ALLOW_SYNTHETIC_FOLLOW_UP_DISPATCH: "true",
  V2_SYNTHETIC_FOLLOW_UP_DISPATCH_RUN_ENABLED: "true",
  V2_SYNTHETIC_DISPATCH_DATABASE: "fluxo_dispatch_test",
  V2_DATABASE_URL: "mysql://local:password@127.0.0.1:33087",
  V2_APP_DATABASE: "fluxo_dispatch_test",
};

describe("synthetic follow-up dispatcher CLI configuration", () => {
  it("requires explicit local confirmations and bounded arguments", () => {
    expect(readSyntheticDispatchCliConfig(["--inspect", "--batch=7"], environment)).toMatchObject({ mode: "inspect", batchSize: 7, outcome: "accepted" });
    expect(readSyntheticDispatchCliConfig(["--run", "--batch=100", "--simulate=gone"], environment)).toMatchObject({ mode: "run", batchSize: 100, outcome: "gone" });
    expect(() => readSyntheticDispatchCliConfig(["--run"], { ...environment, V2_SYNTHETIC_FOLLOW_UP_DISPATCH_RUN_ENABLED: "false" })).toThrow("Confirmação");
    expect(() => readSyntheticDispatchCliConfig(["--run", "--batch=101"], environment)).toThrow("--batch");
  });

  it("rejects production, remote hosts and an unapproved database regardless of argv", () => {
    expect(() => readSyntheticDispatchCliConfig(["--inspect"], { ...environment, NODE_ENV: "production" })).toThrow("produção");
    expect(() => readSyntheticDispatchCliConfig(["--inspect"], { ...environment, V2_DATABASE_URL: "mysql://local:password@db.example.test:3306" })).toThrow("loopback");
    expect(() => readSyntheticDispatchCliConfig(["--inspect"], { ...environment, V2_SYNTHETIC_DISPATCH_DATABASE: "other_test" })).toThrow("não confere");
  });

  it("accepts a valid synthetic clock and rejects malformed input", () => {
    expect(readSyntheticDispatchCliConfig(
      ["--inspect", "--at=2026-11-23T13:00:00.000Z"],
      environment
    ).now?.toISOString()).toBe("2026-11-23T13:00:00.000Z");
    expect(() => readSyntheticDispatchCliConfig(
      ["--inspect", "--at=not-a-date"], environment
    )).toThrow("ISO-8601");
  });
});
