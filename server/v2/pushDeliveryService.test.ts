import { describe, expect, it } from "vitest";
import { allowsControlledPushTest, controlledPushTestPayload } from "./pushDeliveryService";

const localEnvironment = {
  WEB_PUSH_TEST_SEND_ENABLED: "true",
  V2_ALLOW_LOCAL_HTTP_SESSION: "true",
  NODE_ENV: "development",
  V2_DATABASE_URL: "mysql://test:test@localhost:33087/fluxo_push_test",
};

describe("controlled Web Push test policy", () => {
  it("permits only the explicit local test configuration", () => {
    expect(allowsControlledPushTest(localEnvironment)).toBe(true);
  });

  it("blocks production, missing flags and remote databases independently", () => {
    expect(allowsControlledPushTest({ ...localEnvironment, NODE_ENV: "production" })).toBe(false);
    expect(allowsControlledPushTest({ ...localEnvironment, WEB_PUSH_TEST_SEND_ENABLED: "false" })).toBe(false);
    expect(allowsControlledPushTest({ ...localEnvironment, V2_DATABASE_URL: "mysql://test:test@db.example.com/fluxo" })).toBe(false);
  });

  it("uses an immutable payload without commercial or personal data", () => {
    expect(controlledPushTestPayload()).toEqual({
      title: "FLUXO",
      body: "Teste de avisos ativado com sucesso.",
      path: "/v2/follow-ups",
      tag: "fluxo-web-push-test",
    });
  });
});
