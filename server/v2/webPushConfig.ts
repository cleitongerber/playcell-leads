import * as webPush from "web-push";

const REMOTE_HML_SERVICE_ID = "srv-dc1f8k142hec73a6tt10";
const REMOTE_HML_DATABASE = "fluxo_webpush_homologacao";
const REMOTE_HML_DATABASE_HOST = "gateway01.sa-east-1.prod.aws.tidbcloud.com";

export type WebPushConfiguration = {
  publicKey: string | null;
  privateKey: string | null;
  subject: string | null;
};

export function readWebPushConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): WebPushConfiguration {
  return {
    publicKey: environment.VAPID_PUBLIC_KEY?.trim() || null,
    privateKey: environment.VAPID_PRIVATE_KEY?.trim() || null,
    subject: environment.VAPID_SUBJECT?.trim() || null,
  };
}

/**
 * Deliberately narrow gate for the one approved remote, synthetic HML test.
 * This remains false in production and for any environment identity drift.
 */
export function remoteHmlControlledPushTestEnabled(
  environment: NodeJS.ProcessEnv = process.env
) {
  if (environment.WEB_PUSH_REMOTE_HML_TEST_ENABLED !== "true") return false;
  if (environment.WEB_PUSH_REMOTE_HML_SERVICE_ID !== REMOTE_HML_SERVICE_ID) return false;
  if (environment.V2_APP_DATABASE !== REMOTE_HML_DATABASE) return false;
  if (environment.V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED === "true") return false;
  if (environment.WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED === "true") return false;
  try {
    const url = new URL(environment.V2_DATABASE_URL ?? "");
    return url.protocol === "mysql:" && url.hostname === REMOTE_HML_DATABASE_HOST;
  } catch {
    return false;
  }
}

/**
 * Separate, fail-closed gate for the future automatic dispatcher in the one
 * synthetic HML service. This intentionally does not reuse the manual-test
 * flag: enabling a manual test must never make automation possible.
 */
export function remoteHmlAutomaticPushTransportEnabled(
  environment: NodeJS.ProcessEnv = process.env
) {
  if (environment.WEB_PUSH_REMOTE_HML_TRANSPORT_ENABLED !== "true") return false;
  if (environment.WEB_PUSH_REMOTE_HML_SERVICE_ID !== REMOTE_HML_SERVICE_ID) return false;
  if (environment.V2_APP_DATABASE !== REMOTE_HML_DATABASE) return false;
  if (environment.V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED !== "true") return false;
  if (environment.WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED !== "true") return false;
  try {
    const url = new URL(environment.V2_DATABASE_URL ?? "");
    return url.protocol === "mysql:" && url.hostname === REMOTE_HML_DATABASE_HOST;
  } catch {
    return false;
  }
}

/** The browser may receive only this value; it is not a secret. */
export function webPushPublicConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const config = readWebPushConfiguration(environment);
  return {
    enabled: Boolean(config.publicKey),
    publicKey: config.publicKey,
    controlledTestEnabled:
      (environment.WEB_PUSH_TEST_SEND_ENABLED === "true" &&
        environment.NODE_ENV !== "production") ||
      remoteHmlControlledPushTestEnabled(environment),
  };
}

/** Reserved for the delivery stage. It is intentionally never invoked on registration. */
export function configureWebPushDelivery(environment: NodeJS.ProcessEnv = process.env) {
  const config = readWebPushConfiguration(environment);
  if (!config.publicKey || !config.privateKey || !config.subject)
    throw new Error("As chaves VAPID não estão configuradas.");
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}
