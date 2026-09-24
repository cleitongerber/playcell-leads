import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { users } from "../../drizzle-v2/schema";
import { getV2Db, type V2Database } from "./database";
import { hashV2Password, verifyV2Password } from "./password";
import { writeV2Audit } from "./partnerService";

/**
 * A deliberately explicit, opt-in recovery path for the first V2 Super
 * Admin. It is a CLI only operation: it is never exposed through HTTP and is
 * not called by application startup.
 */
export const V2_ADMIN_RECOVERY_CONFIRMATION = "PLAYCELL_V2_ADMIN_RECOVERY";

export type V2AdminRecoveryConfig = {
  email: string;
  password: string;
};

function localOpenId(email: string) {
  return `local:${createHash("sha256").update(email).digest("hex")}`;
}

export function readV2AdminRecoveryConfig(
  environment: NodeJS.ProcessEnv = process.env
): V2AdminRecoveryConfig {
  if (environment.V2_ADMIN_RECOVERY_CONFIRM !== V2_ADMIN_RECOVERY_CONFIRMATION) {
    throw new Error(
      "Recuperação do Super Admin bloqueada. Defina V2_ADMIN_RECOVERY_CONFIRM explicitamente para executá-la."
    );
  }

  const email = environment.V2_ADMIN_RECOVERY_EMAIL?.trim().toLowerCase();
  const password = environment.V2_ADMIN_RECOVERY_PASSWORD;
  if (!email || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("V2_ADMIN_RECOVERY_EMAIL deve conter um e-mail válido.");
  }
  if (!password || password.length < 12) {
    throw new Error(
      "V2_ADMIN_RECOVERY_PASSWORD deve ser definido e ter no mínimo 12 caracteres."
    );
  }
  return { email, password };
}

/**
 * Updates the single existing Super Admin in place. Its numeric identity and
 * historical records are preserved; only credentials and global access state
 * are repaired. The operation refuses ambiguity instead of creating another
 * privileged account.
 */
export async function recoverV2SuperAdmin(
  config: V2AdminRecoveryConfig = readV2AdminRecoveryConfig()
) {
  const db = await getV2Db();
  const superAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.systemRole, "super_admin"))
    .limit(2);
  if (superAdmins.length !== 1) {
    throw new Error(
      "A recuperação exige exatamente um Super Admin existente. Nenhuma alteração foi feita."
    );
  }

  const superAdminId = superAdmins[0].id;
  const conflictingUser = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, config.email))
      .limit(1)
  )[0];
  if (conflictingUser && conflictingUser.id !== superAdminId) {
    throw new Error(
      "O e-mail informado já pertence a outro usuário. Nenhuma alteração foi feita."
    );
  }

  const passwordHash = await hashV2Password(config.password);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const updated = await tx
      .update(users)
      .set({
        openId: localOpenId(config.email),
        email: config.email,
        passwordHash,
        loginMethod: "password",
        systemRole: "super_admin",
        isActive: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, superAdminId),
          eq(users.systemRole, "super_admin")
        )
      );
    const affectedRows = Number(
      (updated as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
    );
    if (affectedRows !== 1) {
      throw new Error(
        "O Super Admin mudou durante a recuperação. Nenhuma alteração foi concluída."
      );
    }

    // Do not report a successful recovery unless the exact secret supplied to
    // this one-shot CLI can authenticate against the value just persisted.
    // This remains entirely inside the process and never logs the password.
    const repairedUser = (
      await transactionDb
        .select({
          email: users.email,
          passwordHash: users.passwordHash,
          systemRole: users.systemRole,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, superAdminId))
        .limit(1)
    )[0];
    const verified =
      repairedUser?.email === config.email &&
      repairedUser.systemRole === "super_admin" &&
      repairedUser.isActive &&
      (await verifyV2Password(config.password, repairedUser.passwordHash));
    if (!verified) {
      throw new Error(
        "A senha recuperada não pôde ser validada. A transação foi revertida."
      );
    }

    // There is no authenticated actor during an emergency credential recovery.
    // The repaired user is recorded as the affected account, with the mechanism
    // clearly marked and without e-mail, password or secret values in metadata.
    await writeV2Audit(transactionDb, {
      actorUserId: superAdminId,
      action: "super_admin_credentials_recovered",
      entityType: "user",
      entityId: superAdminId,
      metadata: { mechanism: "explicit_recovery_cli" },
    });
  });

  return { updatedUserId: superAdminId, verified: true };
}
