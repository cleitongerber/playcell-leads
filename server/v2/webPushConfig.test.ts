import { describe, expect, it } from "vitest";
import { remoteHmlAutomaticPushTransportEnabled } from "./webPushConfig";

const hml = {
  WEB_PUSH_REMOTE_HML_TRANSPORT_ENABLED: "true",
  WEB_PUSH_REMOTE_HML_SERVICE_ID: "srv-dc1f8k142hec73a6tt10",
  V2_APP_DATABASE: "fluxo_webpush_homologacao",
  V2_DATABASE_URL: "mysql://test@gateway01.sa-east-1.prod.aws.tidbcloud.com:4000/fluxo_webpush_homologacao",
  V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED: "true",
  WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "true",
} as const;

describe("remote HML automatic Web Push transport gate", () => {
  it("requires every independent HML identity and automation gate", () => {
    expect(remoteHmlAutomaticPushTransportEnabled(hml)).toBe(true);
    for (const [key, value] of Object.entries({
      WEB_PUSH_REMOTE_HML_TRANSPORT_ENABLED: "false",
      WEB_PUSH_REMOTE_HML_SERVICE_ID: "srv-other",
      V2_APP_DATABASE: "production",
      V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED: "false",
      WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "false",
    })) {
      expect(remoteHmlAutomaticPushTransportEnabled({ ...hml, [key]: value })).toBe(false);
    }
  });

  it("rejects non-TiDB and production-shaped connection URLs", () => {
    expect(remoteHmlAutomaticPushTransportEnabled({ ...hml, V2_DATABASE_URL: "mysql://test@localhost:3306/fluxo_webpush_homologacao" })).toBe(false);
    expect(remoteHmlAutomaticPushTransportEnabled({ ...hml, V2_DATABASE_URL: "https://fluxo-webpush-homologacao.onrender.com" })).toBe(false);
  });
});
