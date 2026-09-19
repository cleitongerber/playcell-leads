import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb, getUserByOpenId, upsertUser } from "./db";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return timingSafeEqual(derived, Buffer.from(hash, "hex"));
}
export async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const openId = `local:${email}`;
  let user = await getUserByOpenId(openId);
  if (!user) {
    await upsertUser({ openId, email, name: process.env.ADMIN_NAME?.trim() || "Administrador", loginMethod: "password", role: "admin" });
    const db = await getDb();
    if (db) await db.update(users).set({ passwordHash: await hashPassword(password), isActive: true }).where(eq(users.openId, openId));
  }
}
export async function loginWithPassword(email: string, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const rows = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  const user = rows[0];
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) throw new Error("E-mail ou senha inválidos");
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return user;
}
