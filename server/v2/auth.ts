import { eq } from "drizzle-orm";
import { users } from "../../drizzle-v2/schema";
import { getV2Db } from "./database";
import { verifyV2Password } from "./password";

export async function loginV2WithPassword(email: string, password: string) {
  const db = await getV2Db();
  const user = (
    await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1)
  )[0];
  if (!user || !user.isActive || !(await verifyV2Password(password, user.passwordHash))) {
    throw new Error("E-mail ou senha inválidos");
  }
  await db.update(users).set({ lastSignedInAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  return user;
}
