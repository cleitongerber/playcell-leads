import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashV2Password(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, keyLength)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyV2Password(password: string, stored: string | null) {
  if (!stored) return false;
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const derived = (await scrypt(password, salt, keyLength)) as Buffer;
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
