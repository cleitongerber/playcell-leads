import * as webPush from "web-push";

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

/** The browser may receive only this value; it is not a secret. */
export function webPushPublicConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const config = readWebPushConfiguration(environment);
  return {
    enabled: Boolean(config.publicKey),
    publicKey: config.publicKey,
    controlledTestEnabled:
      environment.WEB_PUSH_TEST_SEND_ENABLED === "true" &&
      environment.NODE_ENV !== "production",
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
