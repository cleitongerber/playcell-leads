import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

export class PushSubscriptionConfigurationError extends Error {
  constructor() {
    super("A infraestrutura de notificações não está configurada.");
    this.name = "PushSubscriptionConfigurationError";
  }
}

function encryptionKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const value = environment.PUSH_SUBSCRIPTION_ENCRYPTION_KEY;
  if (!value) throw new PushSubscriptionConfigurationError();
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) throw new PushSubscriptionConfigurationError();
  return key;
}

export function hashPushSubscriptionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptPushSubscriptionValue(
  value: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(environment), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptPushSubscriptionValue(
  encrypted: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] = encrypted.split(".");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded || extra)
    throw new PushSubscriptionConfigurationError();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(environment),
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
