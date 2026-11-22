import { describe, expect, it } from "vitest";
import {
  allowsControlledPushTest,
  allowsRemoteHmlControlledPushTest,
  controlledPushTestPayload,
  remoteHmlControlledPushTestPayload,
} from "./pushDeliveryService";
import { webPushPublicConfiguration } from "./webPushConfig";

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

const remoteHmlEnvironment = {
  WEB_PUSH_REMOTE_HML_TEST_ENABLED: "true",
  WEB_PUSH_REMOTE_HML_SERVICE_ID: "srv-dc1f8k142hec73a6tt10",
  V2_APP_DATABASE: "fluxo_webpush_homologacao",
  V2_DATABASE_URL: "mysql://synthetic:synthetic@gateway01.sa-east-1.prod.aws.tidbcloud.com:4000/fluxo_webpush_homologacao",
  V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED: "false",
  WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "false",
};

describe("remote HML controlled Web Push policy", () => {
  it("permits only the explicitly identified synthetic Render and TiDB environment", () => {
    expect(allowsRemoteHmlControlledPushTest(remoteHmlEnvironment)).toBe(true);
    expect(webPushPublicConfiguration({
      ...remoteHmlEnvironment,
      VAPID_PUBLIC_KEY: "test-public-key",
    }).controlledTestEnabled).toBe(true);
  });

  it("fails closed for production-like identity drift, flags, and another database", () => {
    expect(allowsRemoteHmlControlledPushTest({ ...remoteHmlEnvironment, WEB_PUSH_REMOTE_HML_TEST_ENABLED: "false" })).toBe(false);
    expect(allowsRemoteHmlControlledPushTest({ ...remoteHmlEnvironment, WEB_PUSH_REMOTE_HML_SERVICE_ID: "srv-other" })).toBe(false);
    expect(allowsRemoteHmlControlledPushTest({ ...remoteHmlEnvironment, V2_APP_DATABASE: "production" })).toBe(false);
    expect(allowsRemoteHmlControlledPushTest({ ...remoteHmlEnvironment, V2_DATABASE_URL: "mysql://x:y@production.example.com:3306/production" })).toBe(false);
    expect(allowsRemoteHmlControlledPushTest({ ...remoteHmlEnvironment, V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED: "true" })).toBe(false);
    expect(allowsRemoteHmlControlledPushTest({ ...remoteHmlEnvironment, WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "true" })).toBe(false);
  });

  it("uses a separate fixed payload without commercial or personal data", () => {
    expect(remoteHmlControlledPushTestPayload()).toEqual({
      title: "FLUXO — Teste Web Push",
      body: "Primeira notificação de homologação do FLUXO.",
      path: "/v2/follow-ups",
      tag: "fluxo-web-push-hml-test",
    });
  });
});
