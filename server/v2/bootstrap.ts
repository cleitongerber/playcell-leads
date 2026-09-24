import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { users } from "../../drizzle-v2/schema";
import { getV2Db } from "./database";
import { hashV2Password } from "./password";

/**
 * Idempotent V2 bootstrap. Passwords come only from deployment secrets and are
 * hashed before persistence; migrations never contain credentials.
 */
export async function bootstrapV2SuperAdmin() {
  const email = process.env.V2_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.V2_SUPER_ADMIN_PASSWORD;
  const name = process.env.V2_SUPER_ADMIN_NAME?.trim() || "Super Admin";
  if (!email || !password) return { created: false, reason: "secrets_not_configured" as const };
  if (password.length < 12) throw new Error("V2_SUPER_ADMIN_PASSWORD deve ter no mínimo 12 caracteres");

  const db = await getV2Db();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    await db.update(users).set({ systemRole: "super_admin", isActive: true, updatedAt: new Date() }).where(eq(users.id, existing[0].id));
    return { created: false, reason: "existing_user_promoted" as const };
  }

  await db.insert(users).values({
    // IDs externos podem chegar a 320 caracteres; a chave local permanece
    // estável e cabe no limite de 96 caracteres definido no schema.
    openId: `local:${createHash("sha256").update(email).digest("hex")}`,
    email,
    name,
    passwordHash: await hashV2Password(password),
    loginMethod: "password",
    systemRole: "super_admin",
    isActive: true,
  });
  return { created: true, reason: "created" as const };
}
