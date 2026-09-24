import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { createPartnerAccessRepository, PartnerAccessError, requirePartnerRole, resolvePartnerContext } from "./access";
import type { V2TrpcContext } from "./context";
import { getV2Db } from "./database";

const t = initTRPC.context<V2TrpcContext>().create({ transformer: superjson });

export const v2Router = t.router;
export const v2PublicProcedure = t.procedure;

function toTrpcError(error: PartnerAccessError) {
  const messageByReason = {
    UNAUTHENTICATED: "Autenticação obrigatória",
    USER_INACTIVE: "Seu usuário está inativo",
    PARTNER_SELECTION_REQUIRED: "Selecione um parceiro ativo",
    PARTNER_NOT_FOUND: "Parceiro não encontrado",
    PARTNER_INACTIVE: "Este parceiro está inativo",
    MEMBERSHIP_NOT_FOUND: "Você não possui acesso a este parceiro",
    MEMBERSHIP_INACTIVE: "Seu acesso a este parceiro está inativo",
    ROLE_FORBIDDEN: "Seu perfil não possui permissão para esta ação",
  } as const;
  const code = error.reason === "UNAUTHENTICATED" ? "UNAUTHORIZED" : "FORBIDDEN";
  return new TRPCError({ code, message: messageByReason[error.reason] });
}

const requireV2User = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Autenticação obrigatória" });
  if (!ctx.user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "Seu usuário está inativo" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const v2ProtectedProcedure = t.procedure.use(requireV2User);

export const v2SuperAdminProcedure: typeof v2ProtectedProcedure = v2ProtectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.systemRole !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Apenas Super Admin pode executar esta ação" });
  }
  return next({ ctx });
});

export const v2PartnerProcedure = v2ProtectedProcedure.use(async ({ ctx, next }) => {
  try {
    const db = await getV2Db();
    const partner = await resolvePartnerContext(ctx.user, ctx.requestedPartnerId, createPartnerAccessRepository(db));
    return next({ ctx: { ...ctx, partner } });
  } catch (error) {
    if (error instanceof PartnerAccessError) throw toTrpcError(error);
    throw error;
  }
});

export const v2SellerProcedure = v2PartnerProcedure;

/** Super Admin may list global resources before selecting an active partner. */
export const v2PartnerOrSuperProcedure = v2ProtectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.systemRole === "super_admin") return next({ ctx: { ...ctx, partner: null } });
  try {
    const db = await getV2Db();
    const partner = await resolvePartnerContext(ctx.user, ctx.requestedPartnerId, createPartnerAccessRepository(db));
    return next({ ctx: { ...ctx, partner } });
  } catch (error) {
    if (error instanceof PartnerAccessError) throw toTrpcError(error);
    throw error;
  }
});

export const v2ManagerProcedure = v2PartnerProcedure.use(async ({ ctx, next }) => {
  try {
    requirePartnerRole(ctx.partner, ["super_admin", "partner_admin", "manager"]);
    return next({ ctx });
  } catch (error) {
    if (error instanceof PartnerAccessError) throw toTrpcError(error);
    throw error;
  }
});

export const v2PartnerAdminProcedure = v2PartnerProcedure.use(async ({ ctx, next }) => {
  try {
    requirePartnerRole(ctx.partner, ["super_admin", "partner_admin"]);
    return next({ ctx });
  } catch (error) {
    if (error instanceof PartnerAccessError) throw toTrpcError(error);
    throw error;
  }
});
