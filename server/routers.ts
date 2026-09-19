import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { assignSellerToStore, assumeLead, canAccessLead, getAuditLogs, getDashboardStatsScoped, getLeadActivities, getLeadById, getPendingLeads, getProductivityReport, getTeam, getVisibleLeads, getVisibleLeadsPage, importLeadRows, listPdvs, savePdv, setPdvActive, updateLeadTreatment, updateUserAccess } from "./db";
import { leadStatus } from "../drizzle/schema";
import { loginWithPassword } from "./localAuth";
import { sdk } from "./_core/sdk";
import { ONE_YEAR_MS } from "@shared/const";

const leadInput = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().optional(),
  store: z.string().min(1),
  segment: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  source: z.string().optional(),
  extraData: z.string().optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(8).max(256) })).mutation(async ({ ctx, input }) => {
      const user = await loginWithPassword(input.email, input.password);
      const token = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: ONE_YEAR_MS });
      ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
      return { success: true };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  leads: router({
    list: protectedProcedure.input(z.object({ status: z.enum(leadStatus).optional(), search: z.string().optional(), store: z.string().optional(), pdvId: z.number().int().positive().optional(), view: z.enum(["available", "mine", "all"]).optional() }).optional()).query(({ ctx, input }) => getVisibleLeads(ctx.user, input ?? {})),
    listPage: protectedProcedure.input(z.object({ status: z.enum(leadStatus).optional(), search: z.string().optional(), store: z.string().optional(), pdvId: z.number().int().positive().optional(), view: z.enum(["available", "mine", "all"]).optional(), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25) })).query(({ ctx, input }) => getVisibleLeadsPage(ctx.user, input)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const lead = await getLeadById(input.id);
      if (!lead) return null;
      if (!(await canAccessLead(ctx.user, lead))) return null;
      return { lead, activities: await getLeadActivities(input.id) };
    }),
    assume: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => assumeLead(input.id, ctx.user)),
    updateTreatment: protectedProcedure.input(z.object({
      leadId: z.number(),
      status: z.enum(leadStatus),
      channel: z.enum(["whatsapp", "phone", "other"]).optional(),
      note: z.string().max(2000).optional(),
      nextFollowUpAt: z.string().optional(),
    })).mutation(({ ctx, input }) => updateLeadTreatment({ ...input, userId: ctx.user.id, role: ctx.user.role, nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : undefined })),
    import: adminProcedure.input(z.object({ fileName: z.string(), rows: z.array(leadInput).min(1).max(10000) })).mutation(({ ctx, input }) => importLeadRows(input.rows, ctx.user.id, input.fileName)),
    dashboard: protectedProcedure.input(z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), pdvId: z.number().int().positive().optional(), sellerId: z.number().int().positive().optional(), status: z.enum(leadStatus).optional(), source: z.string().max(120).optional() }).optional()).query(({ ctx, input }) => getDashboardStatsScoped(ctx.user, { ...input, from: input?.from ? new Date(input.from) : undefined, to: input?.to ? new Date(input.to) : undefined })),
    productivity: adminProcedure.query(() => getProductivityReport()),
    pending: protectedProcedure.query(({ ctx }) => getPendingLeads(ctx.user)),
  }),
  team: router({
    list: adminProcedure.query(() => getTeam()),
    // Legacy endpoint kept for existing interface; new code should use users.updateAccess.
    assign: adminProcedure.input(z.object({ userId: z.number(), store: z.string().min(1).max(80), displayName: z.string().min(1) })).mutation(({ input }) => assignSellerToStore(input)),
  }),
  pdvs: router({
    list: protectedProcedure.input(z.object({ includeInactive: z.boolean().optional() }).optional()).query(({ ctx, input }) => ctx.user.role === "admin" ? listPdvs(input?.includeInactive) : listPdvs(false)),
    save: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), name: z.string().min(2).max(120), code: z.string().min(2).max(60), city: z.string().max(120).optional(), region: z.string().max(120).optional(), managerUserId: z.number().int().positive().optional(), leadTarget: z.number().int().nonnegative().optional(), conversionTarget: z.number().int().nonnegative().optional(), isActive: z.boolean().optional() })).mutation(({ ctx, input }) => savePdv(input, ctx.user.id)),
    setActive: adminProcedure.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(({ ctx, input }) => setPdvActive(input.id, input.isActive, ctx.user.id)),
  }),
  users: router({
    updateAccess: adminProcedure.input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "supervisor", "admin"]), isActive: z.boolean(), pdvIds: z.array(z.number().int().positive()).max(50) })).mutation(({ ctx, input }) => updateUserAccess(input, ctx.user.id)),
  }),
  audit: router({
    list: adminProcedure.input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(50) }).optional()).query(({ input }) => getAuditLogs(input?.page, input?.pageSize)),
  }),
});

export type AppRouter = typeof appRouter;
