import { z } from "zod";
import { getSessionCookieOptions } from "../_core/cookies";
import { loginV2WithPassword } from "./auth";
import {
  createV2SessionToken,
  V2_SESSION_COOKIE_NAME,
  V2_SESSION_DURATION_MS,
} from "./session";
import {
  createCampaign,
  getCampaignDetail,
  listCampaigns,
  setCampaignFrozen,
  transitionCampaign,
  updateCampaign,
} from "./campaignService";
import {
  addLeadNote,
  assumeLead,
  changeLeadStatus,
  createLead,
  getLeadDetail,
  initializeLeadConfiguration,
  listLeadConfiguration,
  listLeads,
  recordLeadContact,
  saveLeadSource,
  saveLeadStatus,
  transferLead,
} from "./leadService";
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  followUpAlerts,
  listFollowUpFilters,
  listFollowUps,
  rescheduleFollowUp,
} from "./followUpService";
import {
  getEvidenceDownloadUrl,
  softDeleteLeadEvidence,
  uploadLeadEvidence,
} from "./evidenceService";
import {
  getCampaignGovernance,
  getPartnerGovernance,
  setCampaignGovernance,
  updatePartnerGovernance,
} from "./governanceService";
import {
  confirmImportBatch,
  createImportDraft,
  getCampaignImportPolicy,
  getImportBatch,
  getImportSetup,
  getPartnerImportPolicy,
  listCampaignImportBatches,
  listCustomFields,
  listImportIssues,
  listImportPreviewRows,
  listTemplates,
  saveCustomField,
  setCampaignImportPolicy,
  setPartnerImportPolicy,
  setTemplateActive,
  validateImportBatch,
} from "./importService";
import {
  createPartner,
  listPartners,
  listSelectablePartners,
  setPartnerActive,
} from "./partnerService";
import {
  createPdv,
  listAccessiblePdvs,
  setPdvActive,
  updatePdv,
} from "./pdvService";
import {
  createPartnerUser,
  listPartnerUsers,
  setGlobalUserActive,
  updatePartnerMembership,
} from "./userService";
import {
  v2ManagerProcedure,
  v2PartnerAdminProcedure,
  v2PartnerOrSuperProcedure,
  v2PartnerProcedure,
  v2PublicProcedure,
  v2ProtectedProcedure,
  v2Router,
  v2SuperAdminProcedure,
} from "./trpc";

const governanceRuleInput = z.object({
  evidenceRequired: z.boolean(),
  noteRequired: z.boolean(),
  followUpRequired: z.boolean(),
  allowedChannels: z.array(z.string().min(1).max(48)).max(50).nullable(),
  allowedOutcomes: z.array(z.string().min(1).max(96)).max(50).nullable(),
  allowedEvidenceMimeTypes: z
    .array(z.string().min(1).max(128))
    .max(10)
    .nullable(),
  maxEvidenceSizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  retentionDays: z.number().int().min(1).max(3650).nullable(),
});

const importMappingInput = z.object({
  sourceHeader: z.string().min(1).max(255),
  targetKind: z.enum(["core", "custom"]),
  targetKey: z.string().min(1).max(96),
  valueType: z.enum(["text", "number", "date", "boolean"]),
  isRequired: z.boolean(),
  transformKey: z.string().max(96).nullable().optional(),
});

const importPolicyInput = z.object({
  policy: z.enum(["reject", "allow", "update_safe_fields"]),
  matchStrategy: z.enum([
    "phone",
    "email",
    "phone_or_email",
    "phone_and_email",
  ]),
  safeUpdateFields: z
    .array(z.string().min(1).max(96))
    .max(20)
    .nullable()
    .optional(),
});

/**
 * V2 foundation router. It is intentionally exported separately until the V2
 * application shell replaces V1 routes at the approved cutover.
 */
export const v2FoundationRouter = v2Router({
  auth: v2Router({
    me: v2PublicProcedure.query(({ ctx }) => ctx.user),
    login: v2PublicProcedure
      .input(
        z.object({
          email: z.string().email().max(320),
          password: z.string().min(8).max(256),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await loginV2WithPassword(input.email, input.password);
        const token = await createV2SessionToken({
          openId: user.openId,
          name: user.name,
        });
        ctx.res.cookie(V2_SESSION_COOKIE_NAME, token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: V2_SESSION_DURATION_MS,
        });
        return { success: true } as const;
      }),
    logout: v2PublicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(V2_SESSION_COOKIE_NAME, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      return { success: true } as const;
    }),
  }),
  access: v2Router({
    context: v2PartnerProcedure.query(({ ctx }) => ctx.partner),
  }),
  partners: v2Router({
    available: v2ProtectedProcedure.query(({ ctx }) =>
      listSelectablePartners({
        userId: ctx.user.id,
        systemRole: ctx.user.systemRole,
      })
    ),
    list: v2PartnerOrSuperProcedure.query(({ ctx }) =>
      listPartners(
        { userId: ctx.user.id, systemRole: ctx.user.systemRole },
        ctx.partner ?? undefined
      )
    ),
    create: v2SuperAdminProcedure
      .input(
        z.object({
          code: z.string().min(2).max(64),
          name: z.string().min(2).max(160),
        })
      )
      .mutation(({ ctx, input }) =>
        createPartner({ userId: ctx.user.id, role: "super_admin" }, input)
      ),
    setActive: v2SuperAdminProcedure
      .input(
        z.object({
          partnerId: z.number().int().positive(),
          isActive: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) =>
        setPartnerActive(
          { userId: ctx.user.id, role: "super_admin" },
          input.partnerId,
          input.isActive
        )
      ),
  }),
  pdvs: v2Router({
    list: v2PartnerProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(({ ctx, input }) =>
        listAccessiblePdvs(ctx.partner, input?.includeInactive === true)
      ),
    create: v2PartnerAdminProcedure
      .input(
        z.object({
          code: z.string().min(1).max(64),
          name: z.string().min(1).max(160),
          city: z.string().max(120).nullable().optional(),
          region: z.string().max(120).nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => createPdv(ctx.partner, input)),
    update: v2PartnerAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          code: z.string().min(1).max(64),
          name: z.string().min(1).max(160),
          city: z.string().max(120).nullable().optional(),
          region: z.string().max(120).nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => updatePdv(ctx.partner, input.id, input)),
    setActive: v2PartnerAdminProcedure
      .input(
        z.object({ id: z.number().int().positive(), isActive: z.boolean() })
      )
      .mutation(({ ctx, input }) =>
        setPdvActive(ctx.partner, input.id, input.isActive)
      ),
  }),
  users: v2Router({
    list: v2PartnerAdminProcedure.query(({ ctx }) =>
      listPartnerUsers(ctx.partner)
    ),
    create: v2PartnerAdminProcedure
      .input(
        z.object({
          name: z.string().min(2).max(160),
          email: z.string().email().max(320),
          password: z.string().min(8).max(256),
          role: z.enum(["partner_admin", "manager", "seller"]),
          pdvIds: z.array(z.number().int().positive()).max(100),
        })
      )
      .mutation(({ ctx, input }) => createPartnerUser(ctx.partner, input)),
    updateMembership: v2PartnerAdminProcedure
      .input(
        z.object({
          membershipId: z.number().int().positive(),
          role: z.enum(["partner_admin", "manager", "seller"]),
          isActive: z.boolean(),
          pdvIds: z.array(z.number().int().positive()).max(100).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        updatePartnerMembership(ctx.partner, input.membershipId, input)
      ),
    setGlobalActive: v2PartnerProcedure
      .input(
        z.object({ userId: z.number().int().positive(), isActive: z.boolean() })
      )
      .mutation(({ ctx, input }) =>
        setGlobalUserActive(ctx.partner, input.userId, input.isActive)
      ),
  }),
  campaigns: v2Router({
    list: v2PartnerProcedure
      .input(z.object({ includeArchived: z.boolean().optional() }).optional())
      .query(({ ctx, input }) =>
        listCampaigns(ctx.partner, input?.includeArchived === true)
      ),
    get: v2PartnerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) => getCampaignDetail(ctx.partner, input.id)),
    create: v2PartnerAdminProcedure
      .input(
        z.object({
          code: z.string().min(1).max(64),
          name: z.string().min(1).max(160),
          description: z.string().max(10_000).nullable().optional(),
          startsAt: z.coerce.date().nullable().optional(),
          endsAt: z.coerce.date().nullable().optional(),
          pdvIds: z.array(z.number().int().positive()).min(1).max(100),
        })
      )
      .mutation(({ ctx, input }) => createCampaign(ctx.partner, input)),
    update: v2PartnerAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          code: z.string().min(1).max(64),
          name: z.string().min(1).max(160),
          description: z.string().max(10_000).nullable().optional(),
          startsAt: z.coerce.date().nullable().optional(),
          endsAt: z.coerce.date().nullable().optional(),
          pdvIds: z.array(z.number().int().positive()).min(1).max(100),
        })
      )
      .mutation(({ ctx, input }) =>
        updateCampaign(ctx.partner, input.id, input)
      ),
    transition: v2PartnerAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(["active", "closed", "archived"]),
        })
      )
      .mutation(({ ctx, input }) =>
        transitionCampaign(ctx.partner, input.id, input.status)
      ),
    setFrozen: v2PartnerAdminProcedure
      .input(
        z.object({ id: z.number().int().positive(), isFrozen: z.boolean() })
      )
      .mutation(({ ctx, input }) =>
        setCampaignFrozen(ctx.partner, input.id, input.isFrozen)
      ),
  }),
  leads: v2Router({
    configuration: v2PartnerProcedure.query(({ ctx }) =>
      listLeadConfiguration(ctx.partner)
    ),
    initializeConfiguration: v2PartnerAdminProcedure.mutation(({ ctx }) =>
      initializeLeadConfiguration(ctx.partner)
    ),
    saveStatus: v2PartnerAdminProcedure
      .input(
        z.object({
          code: z.string().min(1).max(64),
          label: z.string().min(1).max(120),
          category: z.enum(["open", "in_progress", "completed", "discarded"]),
          sortOrder: z.number().int().min(0).max(10_000),
          isTerminal: z.boolean(),
          isActive: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) => saveLeadStatus(ctx.partner, input)),
    saveSource: v2PartnerAdminProcedure
      .input(
        z.object({
          code: z.string().min(1).max(64),
          label: z.string().min(1).max(120),
          isActive: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) => saveLeadSource(ctx.partner, input)),
    list: v2PartnerProcedure
      .input(
        z.object({
          view: z.enum(["available", "mine", "all"]).default("all"),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
          campaignId: z.number().int().positive().optional(),
          pdvId: z.number().int().positive().optional(),
          statusId: z.number().int().positive().optional(),
          search: z.string().max(200).optional(),
        })
      )
      .query(({ ctx, input }) => listLeads(ctx.partner, input)),
    get: v2PartnerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) => getLeadDetail(ctx.partner, input.id)),
    create: v2PartnerAdminProcedure
      .input(
        z.object({
          campaignId: z.number().int().positive(),
          pdvId: z.number().int().positive(),
          statusId: z.number().int().positive(),
          sourceId: z.number().int().positive().nullable().optional(),
          name: z.string().max(200).nullable().optional(),
          phone: z.string().max(64).nullable().optional(),
          email: z.string().email().max(320).nullable().optional(),
          customData: z.record(z.string(), z.unknown()).nullable().optional(),
          receivedAt: z.coerce.date().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => createLead(ctx.partner, input)),
    assume: v2PartnerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => assumeLead(ctx.partner, input.id)),
    transfer: v2ManagerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          membershipId: z.number().int().positive(),
          reason: z.string().max(1_000).nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        transferLead(ctx.partner, input.id, input.membershipId, input.reason)
      ),
    changeStatus: v2PartnerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          statusId: z.number().int().positive(),
        })
      )
      .mutation(({ ctx, input }) =>
        changeLeadStatus(ctx.partner, input.id, input.statusId)
      ),
    contact: v2PartnerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          channel: z.string().min(1).max(48),
          outcome: z.string().min(1).max(96),
          summary: z.string().max(5_000).nullable().optional(),
          occurredAt: z.coerce.date().optional(),
          statusId: z.number().int().positive().optional(),
          followUpDueAt: z.coerce.date().nullable().optional(),
          followUpNote: z.string().max(5_000).nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        recordLeadContact(ctx.partner, input.id, input)
      ),
    note: v2PartnerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          text: z.string().min(1).max(5_000),
        })
      )
      .mutation(({ ctx, input }) =>
        addLeadNote(ctx.partner, input.id, input.text)
      ),
  }),
  followUps: v2Router({
    alerts: v2PartnerProcedure.query(({ ctx }) => followUpAlerts(ctx.partner)),
    filters: v2PartnerProcedure.query(({ ctx }) =>
      listFollowUpFilters(ctx.partner)
    ),
    list: v2PartnerProcedure
      .input(
        z.object({
          view: z.enum(["overdue", "today", "upcoming", "completed"]),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
          ownerMembershipId: z.number().int().positive().optional(),
          pdvId: z.number().int().positive().optional(),
        })
      )
      .query(({ ctx, input }) => listFollowUps(ctx.partner, input)),
    create: v2PartnerProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          dueAt: z.coerce.date(),
          note: z.string().max(5_000).nullable().optional(),
          ownerMembershipId: z.number().int().positive().optional(),
        })
      )
      .mutation(({ ctx, input }) => createFollowUp(ctx.partner, input)),
    complete: v2PartnerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => completeFollowUp(ctx.partner, input.id)),
    cancel: v2PartnerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => cancelFollowUp(ctx.partner, input.id)),
    reschedule: v2PartnerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          dueAt: z.coerce.date(),
          reason: z.string().max(5_000).nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        rescheduleFollowUp(ctx.partner, input.id, input)
      ),
  }),
  governance: v2Router({
    partner: v2PartnerAdminProcedure.query(({ ctx }) =>
      getPartnerGovernance(ctx.partner)
    ),
    updatePartner: v2PartnerAdminProcedure
      .input(governanceRuleInput)
      .mutation(({ ctx, input }) =>
        updatePartnerGovernance(ctx.partner, input)
      ),
    campaign: v2PartnerAdminProcedure
      .input(z.object({ campaignId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        getCampaignGovernance(ctx.partner, input.campaignId)
      ),
    setCampaign: v2PartnerAdminProcedure
      .input(
        z.object({
          campaignId: z.number().int().positive(),
          setting: z.discriminatedUnion("mode", [
            z.object({ mode: z.literal("inherit") }),
            z.object({
              mode: z.literal("override"),
              rule: governanceRuleInput,
            }),
          ]),
        })
      )
      .mutation(({ ctx, input }) =>
        setCampaignGovernance(ctx.partner, input.campaignId, input.setting)
      ),
  }),
  imports: v2Router({
    setup: v2ManagerProcedure
      .input(z.object({ campaignId: z.number().int().positive() }))
      .query(({ ctx, input }) => getImportSetup(ctx.partner, input.campaignId)),
    customFields: v2ManagerProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(({ ctx, input }) =>
        listCustomFields(ctx.partner, input?.includeInactive === true)
      ),
    saveCustomField: v2PartnerAdminProcedure
      .input(
        z.object({
          key: z.string().min(1).max(96),
          label: z.string().min(1).max(160),
          fieldType: z.enum(["text", "number", "date", "boolean", "select"]),
          options: z
            .array(z.string().min(1).max(160))
            .max(100)
            .nullable()
            .optional(),
          isRequired: z.boolean(),
          isActive: z.boolean(),
          sortOrder: z.number().int().min(0).max(10_000),
        })
      )
      .mutation(({ ctx, input }) => saveCustomField(ctx.partner, input)),
    templates: v2ManagerProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(({ ctx, input }) =>
        listTemplates(ctx.partner, input?.includeInactive === true)
      ),
    setTemplateActive: v2PartnerAdminProcedure
      .input(
        z.object({
          templateId: z.number().int().positive(),
          isActive: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) =>
        setTemplateActive(ctx.partner, input.templateId, input.isActive)
      ),
    createDraft: v2ManagerProcedure
      .input(
        z.object({
          campaignId: z.number().int().positive(),
          fileName: z.string().min(1).max(255),
          // CSV is bounded to 5 MiB server-side; base64 carries expansion.
          base64: z.string().min(4).max(7_100_000),
          targetPdvId: z.number().int().positive().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => createImportDraft(ctx.partner, input)),
    validate: v2ManagerProcedure
      .input(
        z.object({
          batchId: z.number().int().positive(),
          mappings: z.array(importMappingInput).min(1).max(200),
          templateId: z.number().int().positive().nullable().optional(),
          saveTemplateName: z.string().min(1).max(160).nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => validateImportBatch(ctx.partner, input)),
    confirm: v2ManagerProcedure
      .input(z.object({ batchId: z.number().int().positive() }))
      .mutation(({ ctx, input }) =>
        confirmImportBatch(ctx.partner, input.batchId)
      ),
    getBatch: v2ManagerProcedure
      .input(z.object({ batchId: z.number().int().positive() }))
      .query(({ ctx, input }) => getImportBatch(ctx.partner, input.batchId)),
    previewRows: v2ManagerProcedure
      .input(
        z.object({
          batchId: z.number().int().positive(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
        })
      )
      .query(({ ctx, input }) => listImportPreviewRows(ctx.partner, input)),
    issues: v2ManagerProcedure
      .input(
        z.object({
          batchId: z.number().int().positive(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
        })
      )
      .query(({ ctx, input }) => listImportIssues(ctx.partner, input)),
    history: v2ManagerProcedure
      .input(
        z.object({
          campaignId: z.number().int().positive(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
        })
      )
      .query(({ ctx, input }) => listCampaignImportBatches(ctx.partner, input)),
    partnerPolicy: v2PartnerAdminProcedure.query(({ ctx }) =>
      getPartnerImportPolicy(ctx.partner)
    ),
    setPartnerPolicy: v2PartnerAdminProcedure
      .input(importPolicyInput)
      .mutation(({ ctx, input }) => setPartnerImportPolicy(ctx.partner, input)),
    campaignPolicy: v2PartnerAdminProcedure
      .input(z.object({ campaignId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        getCampaignImportPolicy(ctx.partner, input.campaignId)
      ),
    setCampaignPolicy: v2PartnerAdminProcedure
      .input(
        z.object({
          campaignId: z.number().int().positive(),
          setting: z.discriminatedUnion("mode", [
            z.object({ mode: z.literal("inherit") }),
            z.object({ mode: z.literal("override") }).merge(importPolicyInput),
          ]),
        })
      )
      .mutation(({ ctx, input }) =>
        setCampaignImportPolicy(
          ctx.partner,
          input.campaignId,
          input.setting.mode === "inherit"
            ? { mode: "inherit" }
            : {
                policy: input.setting.policy,
                matchStrategy: input.setting.matchStrategy,
                safeUpdateFields: input.setting.safeUpdateFields,
              }
        )
      ),
  }),
  evidences: v2Router({
    upload: v2PartnerProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          timelineEventId: z.number().int().positive(),
          fileName: z.string().min(1).max(255),
          mimeType: z.string().min(1).max(128),
          // 10 MiB binary payload is at most ~13.4 MiB of base64.
          base64: z.string().min(4).max(14_000_000),
        })
      )
      .mutation(({ ctx, input }) => uploadLeadEvidence(ctx.partner, input)),
    download: v2PartnerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) =>
        getEvidenceDownloadUrl(ctx.partner, input.id)
      ),
    remove: v2PartnerAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) =>
        softDeleteLeadEvidence(ctx.partner, input.id)
      ),
  }),
});

export type V2FoundationRouter = typeof v2FoundationRouter;
