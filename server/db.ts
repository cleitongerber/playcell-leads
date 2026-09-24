import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import {
  auditLogs,
  campaignPdvs,
  campaigns,
  followUps,
  InsertUser,
  leadActivities,
  leadImports,
  LeadStatus,
  leads,
  passwordResetRequests,
  pdvs,
  sellerProfiles,
  userPdvs,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let initializePromise: Promise<void> | null = null;

function getDatabaseConfig() {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL não configurada");
  const sourceDatabase = new URL(sourceUrl).pathname.replace(/^\//, "");
  const databaseName =
    process.env.APP_DATABASE?.trim() ||
    (sourceDatabase === "sys" ? "playcell_leads" : sourceDatabase);
  if (!/^[a-zA-Z0-9_]+$/.test(databaseName))
    throw new Error("APP_DATABASE possui um nome inválido");
  const appUrl = new URL(sourceUrl);
  appUrl.pathname = `/${databaseName}`;
  return { appUrl: appUrl.toString() };
}

const tls = { minVersion: "TLSv1.2" as const, rejectUnauthorized: true };

async function initializeDatabase() {
  const { appUrl } = getDatabaseConfig();
  const pool = mysql.createPool({ uri: appUrl, ssl: tls });
  try {
    _db = drizzle({ client: pool });
  } catch (error) {
    await pool.promise().end();
    throw error;
  }
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Connecting never changes schema or operational data. Schema evolution
      // is performed only by reviewed Drizzle migrations.
      initializePromise ??= initializeDatabase();
      await initializePromise;
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      initializePromise = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}

export async function getSellerProfile(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, userId))
    .limit(1);
  return result[0];
}

type AppRole = "admin" | "supervisor" | "user";
type AccessUser = { id: number; role: AppRole; isActive?: boolean };

async function getAccessiblePdvIds(user: AccessUser) {
  const db = await getDb();
  if (!db || user.role === "admin") return null;
  const rows = await db
    .select({ pdvId: userPdvs.pdvId })
    .from(userPdvs)
    .where(eq(userPdvs.userId, user.id));
  return rows.map(row => row.pdvId);
}

async function writeAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId?: number | string,
  details?: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(auditLogs)
    .values({
      userId,
      action,
      entityType,
      entityId: entityId === undefined ? null : String(entityId),
      details: details ? JSON.stringify(details) : null,
    });
}

export async function getTeam() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      store: sellerProfiles.store,
      displayName: sellerProfiles.displayName,
    })
    .from(users)
    .leftJoin(sellerProfiles, eq(users.id, sellerProfiles.userId))
    .orderBy(users.name);
  const scopes = await db
    .select({ userId: userPdvs.userId, pdvId: pdvs.id, pdvName: pdvs.name })
    .from(userPdvs)
    .innerJoin(pdvs, eq(userPdvs.pdvId, pdvs.id));
  return rows.map(row => ({
    ...row,
    pdvs: scopes
      .filter(scope => scope.userId === row.id)
      .map(({ pdvId, pdvName }) => ({ id: pdvId, name: pdvName })),
  }));
}

export async function assignSellerToStore(input: {
  userId: number;
  store: string;
  displayName: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const pdv = (
    await db
      .select({ id: pdvs.id, name: pdvs.name, isActive: pdvs.isActive })
      .from(pdvs)
      .where(eq(pdvs.name, input.store.trim()))
      .limit(1)
  )[0];
  if (!pdv?.isActive) throw new Error("Selecione um PDV ativo e cadastrado");
  const existing = await getSellerProfile(input.userId);
  await db.transaction(async tx => {
    // This legacy single-PDV editor must update the authorization relation too.
    // Keeping only seller_profiles in sync was the source of sellers seeing the
    // wrong portfolio (or none at all).
    await tx.delete(userPdvs).where(eq(userPdvs.userId, input.userId));
    await tx.insert(userPdvs).values({ userId: input.userId, pdvId: pdv.id });
    if (existing) {
      await tx
        .update(sellerProfiles)
        .set({
          store: pdv.name,
          displayName: input.displayName.trim(),
          updatedAt: new Date(),
        })
        .where(eq(sellerProfiles.userId, input.userId));
    } else {
      await tx
        .insert(sellerProfiles)
        .values({
          userId: input.userId,
          store: pdv.name,
          displayName: input.displayName.trim(),
        });
    }
  });
  return { success: true } as const;
}

export async function getVisibleLeads(
  user: AccessUser,
  filters: {
    status?: LeadStatus;
    search?: string;
    store?: string;
    pdvId?: number;
    campaignId?: number;
    view?: "available" | "mine" | "all";
  }
) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.status) conditions.push(eq(leads.status, filters.status));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(like(leads.name, term), like(leads.phone, term)));
  }
  if (filters.store) conditions.push(eq(leads.store, filters.store));
  if (filters.pdvId) conditions.push(eq(leads.pdvId, filters.pdvId));
  if (filters.campaignId)
    conditions.push(eq(leads.campaignId, filters.campaignId));
  conditions.push(isNull(leads.deletedAt));
  if (user.role !== "admin") {
    const allowedPdvs = await getAccessiblePdvIds(user);
    if (!allowedPdvs?.length) return [];
    conditions.push(inArray(leads.pdvId, allowedPdvs));
    if (user.role === "user") {
      if (filters.view === "available")
        conditions.push(isNull(leads.assignedTo));
      else if (filters.view === "mine")
        conditions.push(eq(leads.assignedTo, user.id));
      else
        conditions.push(
          or(eq(leads.assignedTo, user.id), isNull(leads.assignedTo))
        );
    }
  } else if (filters.view === "available") {
    conditions.push(isNull(leads.assignedTo));
  } else if (filters.view === "mine") {
    conditions.push(eq(leads.assignedTo, user.id));
  }
  const query = db
    .select()
    .from(leads)
    .orderBy(desc(leads.updatedAt))
    .limit(500);
  return conditions.length ? query.where(and(...conditions)) : query;
}

export async function getVisibleLeadsPage(
  user: AccessUser,
  filters: Parameters<typeof getVisibleLeads>[1] & {
    page: number;
    pageSize: number;
  }
) {
  const all = await getVisibleLeads(user, filters);
  const page = Math.max(1, filters.page);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize));
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
  };
}

export async function getLeadById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return result[0];
}

export async function getLeadActivities(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt));
}

export async function canAccessLead(
  user: AccessUser,
  lead: typeof leads.$inferSelect
) {
  if (user.role === "admin") return true;
  const allowedPdvs = await getAccessiblePdvIds(user);
  if (!allowedPdvs?.includes(lead.pdvId ?? -1)) return false;
  return (
    user.role === "supervisor" ||
    lead.assignedTo === user.id ||
    lead.assignedTo === null
  );
}

export async function importLeadRows(
  rows: Array<{
    name: string;
    phone: string;
    email?: string;
    store: string;
    segment?: string;
    priority?: "high" | "medium" | "low";
    source?: string;
    extraData?: string;
  }>,
  campaignId: number,
  importedBy: number,
  fileName: string,
  targetPdvId?: number,
  useSpreadsheetPdv = false
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  if (!rows.length) return { inserted: 0 };
  const campaign = (
    await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.isActive, true),
          isNull(campaigns.deletedAt)
        )
      )
      .limit(1)
  )[0];
  if (!campaign) throw new Error("A campanha selecionada não está disponível");
  if (campaign.isFrozen)
    throw new Error(
      "Esta campanha está congelada e não aceita novas importações"
    );
  const campaignPdvRows = await db
    .select({ pdvId: campaignPdvs.pdvId })
    .from(campaignPdvs)
    .where(eq(campaignPdvs.campaignId, campaignId));
  const campaignPdvIds = new Set(campaignPdvRows.map(row => row.pdvId));
  if (!campaignPdvIds.size)
    throw new Error("A campanha não possui PDVs autorizados");
  const normalizePhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10
      ? digits.startsWith("55")
        ? digits
        : `55${digits}`
      : "";
  };
  const pdvRows = await db
    .select({ id: pdvs.id, name: pdvs.name, isActive: pdvs.isActive })
    .from(pdvs);
  const pdvByName = new Map(
    pdvRows.map(pdv => [pdv.name.trim().toLocaleLowerCase(), pdv])
  );
  const targetPdv = targetPdvId
    ? pdvRows.find(pdv => pdv.id === targetPdvId)
    : undefined;
  if (
    targetPdvId &&
    (!targetPdv?.isActive || !campaignPdvIds.has(targetPdv.id))
  ) {
    throw new Error(
      "O PDV selecionado não está ativo ou não tem acesso a esta campanha"
    );
  }
  const phones = rows.map(row => normalizePhone(row.phone)).filter(Boolean);
  const existing = phones.length
    ? await db
        .select({ id: leads.id, phone: leads.phone })
        .from(leads)
        .where(
          and(inArray(leads.phone, phones), eq(leads.campaignId, campaignId))
        )
    : [];
  const existingByPhone = new Map(existing.map(lead => [lead.phone, lead.id]));
  const newRows = [];
  let updated = 0;
  const processedPhones = new Set<string>();
  let duplicates = 0;
  let invalid = 0;
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    // The selected target is authoritative. Spreadsheet PDV values are only
    // used when the administrator deliberately opts into a multi-PDV sheet.
    const spreadsheetPdv = pdvByName.get(row.store.trim().toLocaleLowerCase());
    const pdv = useSpreadsheetPdv
      ? spreadsheetPdv
      : (targetPdv ?? spreadsheetPdv);
    if (
      !phone ||
      !row.name.trim() ||
      !pdv ||
      !pdv.isActive ||
      !campaignPdvIds.has(pdv.id)
    ) {
      invalid += 1;
      continue;
    }
    if (processedPhones.has(phone)) {
      duplicates += 1;
      continue;
    }
    processedPhones.add(phone);
    const normalized = {
      name: row.name.trim(),
      phone,
      email: row.email?.trim() || null,
      store: pdv.name,
      pdvId: pdv.id,
      campaignId,
      segment: row.segment?.trim() || null,
      priority: row.priority ?? "medium",
      source: row.source?.trim() || `Importação: ${fileName}`,
      extraData: row.extraData ?? null,
    };
    const existingId = existingByPhone.get(normalized.phone);
    if (existingId) {
      await db
        .update(leads)
        .set({ ...normalized, updatedAt: new Date() })
        .where(eq(leads.id, existingId));
      updated += 1;
    } else {
      newRows.push(normalized);
    }
  }
  if (newRows.length) await db.insert(leads).values(newRows);
  await db
    .insert(leadImports)
    .values({ fileName, importedBy, rowCount: rows.length });
  await writeAudit(importedBy, "leads_imported", "lead_import", fileName, {
    campaignId,
    campaign: campaign.name,
    targetPdvId: targetPdv?.id ?? null,
    useSpreadsheetPdv,
    total: rows.length,
    inserted: newRows.length,
    updated,
    duplicates,
    invalid,
  });
  return {
    processed: rows.length,
    inserted: newRows.length,
    updated,
    duplicates,
    invalid,
  };
}

export async function assumeLead(leadId: number, user: AccessUser) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  if (user.role !== "user")
    throw new Error("Somente vendedores podem assumir leads");
  if (user.isActive === false) throw new Error("Seu acesso está inativo");
  const allowedPdvs = await getAccessiblePdvIds(user);
  if (!allowedPdvs?.length)
    throw new Error("Seu usuário não possui PDV autorizado");
  const now = new Date();
  // The conditional UPDATE is the lock: exactly one concurrent request can affect a row.
  const result = await db
    .update(leads)
    .set({
      assignedTo: user.id,
      assignedAt: now,
      status: "assigned",
      updatedAt: now,
    })
    .where(
      and(
        eq(leads.id, leadId),
        isNull(leads.assignedTo),
        inArray(leads.pdvId, allowedPdvs),
        isNull(leads.deletedAt)
      )
    );
  const affected = Number(
    (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
  if (affected !== 1)
    throw new Error("Este lead já foi assumido por outro vendedor.");
  await db
    .insert(leadActivities)
    .values({
      leadId,
      userId: user.id,
      action: "assigned",
      status: "assigned",
      note: "Lead assumido pelo vendedor",
    });
  await writeAudit(user.id, "lead_assumed", "lead", leadId);
  return getLeadById(leadId);
}

export async function updateLeadTreatment(input: {
  leadId: number;
  userId: number;
  role: AppRole;
  status: LeadStatus;
  channel?: "whatsapp" | "phone" | "other";
  note?: string;
  nextFollowUpAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const lead = await getLeadById(input.leadId);
  if (!lead) throw new Error("Lead não encontrado");
  if (input.role === "supervisor")
    throw new Error("Supervisores possuem acesso de acompanhamento");
  if (input.role !== "admin" && lead.assignedTo !== input.userId)
    throw new Error("Assuma o lead antes de atualizar o atendimento");
  const now = new Date();
  await db
    .update(leads)
    .set({
      status: input.status,
      lastContactAt: input.channel ? now : lead.lastContactAt,
      firstContactAt:
        input.channel && !lead.firstContactAt ? now : lead.firstContactAt,
      lastContactChannel: input.channel ?? lead.lastContactChannel,
      lastNote: input.note ?? lead.lastNote,
      nextFollowUpAt: input.nextFollowUpAt ?? null,
      updatedAt: now,
    })
    .where(eq(leads.id, input.leadId));
  await db
    .insert(leadActivities)
    .values({
      leadId: input.leadId,
      userId: input.userId,
      action: input.channel ? "contact" : "status",
      channel: input.channel,
      status: input.status,
      note: input.note,
    });
  if (input.nextFollowUpAt)
    await db
      .insert(followUps)
      .values({
        leadId: input.leadId,
        createdBy: input.userId,
        dueAt: input.nextFollowUpAt,
        note: input.note ?? null,
      });
  await writeAudit(
    input.userId,
    input.channel ? "lead_contacted" : "lead_updated",
    "lead",
    input.leadId,
    { status: input.status }
  );
  return getLeadById(input.leadId);
}

export async function getDashboardStats() {
  const db = await getDb();
  if (!db)
    return {
      total: 0,
      newLeads: 0,
      assigned: 0,
      inTreatment: 0,
      scheduled: 0,
      converted: 0,
      noAnswer: 0,
      byStore: [],
    };
  const [summary, stores] = await Promise.all([
    db
      .select({ status: leads.status, count: sql<number>`count(*)` })
      .from(leads)
      .groupBy(leads.status),
    db
      .select({
        store: leads.store,
        total: sql<number>`count(*)`,
        converted: sql<number>`sum(case when ${leads.status} = 'converted' then 1 else 0 end)`,
        scheduled: sql<number>`sum(case when ${leads.status} = 'scheduled' then 1 else 0 end)`,
      })
      .from(leads)
      .groupBy(leads.store),
  ]);
  const counts = Object.fromEntries(
    summary.map(row => [row.status, Number(row.count)])
  );
  return {
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    newLeads: counts.new ?? 0,
    assigned: (counts.assigned ?? 0) + (counts.contacted ?? 0),
    inTreatment:
      (counts.interested ?? 0) +
      (counts.proposal ?? 0) +
      (counts.callback ?? 0),
    scheduled: counts.scheduled ?? 0,
    converted: counts.converted ?? 0,
    noAnswer: counts.no_answer ?? 0,
    byStore: stores.map(row => ({
      store: row.store,
      total: Number(row.total),
      converted: Number(row.converted),
      scheduled: Number(row.scheduled),
    })),
  };
}

export async function getDashboardStatsScoped(
  user: AccessUser,
  filters: {
    from?: Date;
    to?: Date;
    pdvId?: number;
    campaignId?: number;
    sellerId?: number;
    status?: LeadStatus;
    source?: string;
  }
) {
  const visible = await getVisibleLeads(user, {
    pdvId: filters.pdvId,
    campaignId: filters.campaignId,
    status: filters.status,
    view: user.role === "user" ? "mine" : "all",
  });
  const rows = visible.filter(
    lead =>
      (!filters.from || lead.createdAt >= filters.from) &&
      (!filters.to || lead.createdAt <= filters.to) &&
      (!filters.sellerId || lead.assignedTo === filters.sellerId) &&
      (!filters.source || lead.source === filters.source)
  );
  const count = (predicate: (lead: typeof leads.$inferSelect) => boolean) =>
    rows.filter(predicate).length;
  const received = rows.length;
  const assumed = count(lead => lead.assignedTo !== null);
  const contacted = count(lead => lead.firstContactAt !== null);
  const interested = count(lead =>
    ["interested", "proposal", "scheduled", "converted"].includes(lead.status)
  );
  const scheduled = count(lead => lead.status === "scheduled");
  const converted = count(lead => lead.status === "converted");
  const average = (values: number[]) =>
    values.length
      ? Math.round(values.reduce((sum, item) => sum + item, 0) / values.length)
      : 0;
  return {
    total: received,
    newLeads: count(lead => lead.assignedTo === null),
    received,
    available: count(lead => lead.assignedTo === null),
    assumed,
    contacted,
    interested,
    scheduled,
    converted,
    inTreatment: count(lead =>
      ["assigned", "contacted", "interested", "proposal", "callback"].includes(
        lead.status
      )
    ),
    noAnswer: count(lead => lead.status === "no_answer"),
    conversionRate: received
      ? Math.round((converted / received) * 1000) / 10
      : 0,
    avgClaimMinutes: average(
      rows
        .filter(lead => lead.assignedAt)
        .map(
          lead =>
            (lead.assignedAt!.getTime() - lead.createdAt.getTime()) / 60000
        )
    ),
    avgFirstContactMinutes: average(
      rows
        .filter(lead => lead.assignedAt && lead.firstContactAt)
        .map(
          lead =>
            (lead.firstContactAt!.getTime() - lead.assignedAt!.getTime()) /
            60000
        )
    ),
    funnel: [
      { label: "Recebidos", value: received },
      { label: "Assumidos", value: assumed },
      { label: "Contatados", value: contacted },
      { label: "Interessados", value: interested },
      { label: "Agendados", value: scheduled },
      { label: "Convertidos", value: converted },
    ],
    byStore: Object.entries(
      rows.reduce<
        Record<string, { total: number; converted: number; scheduled: number }>
      >(
        (result, lead) => ({
          ...result,
          [lead.store]: {
            total: (result[lead.store]?.total ?? 0) + 1,
            converted:
              (result[lead.store]?.converted ?? 0) +
              (lead.status === "converted" ? 1 : 0),
            scheduled:
              (result[lead.store]?.scheduled ?? 0) +
              (lead.status === "scheduled" ? 1 : 0),
          },
        }),
        {}
      )
    ).map(([store, values]) => ({ store, ...values })),
    byStatus: Object.entries(
      rows.reduce<Record<string, number>>(
        (result, lead) => ({
          ...result,
          [lead.status]: (result[lead.status] ?? 0) + 1,
        }),
        {}
      )
    ).map(([status, value]) => ({ status, value })),
  };
}

export async function getProductivityReport(
  user: AccessUser,
  filters: { pdvId?: number; campaignId?: number; sellerId?: number } = {}
) {
  if (user.role === "user")
    throw new Error("O relatório de produtividade é destinado à gestão");
  const db = await getDb();
  if (!db)
    return {
      rows: [],
      totals: {
        leads: 0,
        contacted: 0,
        scheduled: 0,
        converted: 0,
        conversionRate: 0,
      },
    };
  const visible = await getVisibleLeads(user, {
    pdvId: filters.pdvId,
    campaignId: filters.campaignId,
    view: "all",
  });
  const selected = visible.filter(
    lead => !filters.sellerId || lead.assignedTo === filters.sellerId
  );
  const sellerIds = Array.from(
    new Set(
      selected.flatMap(lead =>
        lead.assignedTo === null ? [] : [lead.assignedTo]
      )
    )
  );
  const people = sellerIds.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          displayName: sellerProfiles.displayName,
        })
        .from(users)
        .leftJoin(sellerProfiles, eq(users.id, sellerProfiles.userId))
        .where(inArray(users.id, sellerIds))
    : [];
  const peopleById = new Map(people.map(person => [person.id, person]));
  const grouped = new Map<
    string,
    {
      userId: number | null;
      seller: string | null;
      displayName: string | null;
      store: string;
      leads: number;
      contacted: number;
      scheduled: number;
      converted: number;
      noAnswer: number;
    }
  >();
  for (const lead of selected) {
    const key = `${lead.assignedTo ?? "available"}:${lead.store}`;
    const person =
      lead.assignedTo === null ? undefined : peopleById.get(lead.assignedTo);
    const row = grouped.get(key) ?? {
      userId: lead.assignedTo,
      seller: person?.name ?? null,
      displayName: person?.displayName ?? null,
      store: lead.store,
      leads: 0,
      contacted: 0,
      scheduled: 0,
      converted: 0,
      noAnswer: 0,
    };
    row.leads += 1;
    row.contacted += lead.lastContactAt ? 1 : 0;
    row.scheduled += lead.status === "scheduled" ? 1 : 0;
    row.converted += lead.status === "converted" ? 1 : 0;
    row.noAnswer += lead.status === "no_answer" ? 1 : 0;
    grouped.set(key, row);
  }
  const rows = Array.from(grouped.values()).sort(
    (first, second) => second.leads - first.leads
  );
  const totalLeads = rows.reduce((sum, row) => sum + row.leads, 0);
  const totalContacted = rows.reduce((sum, row) => sum + row.contacted, 0);
  const totalScheduled = rows.reduce((sum, row) => sum + row.scheduled, 0);
  const totalConverted = rows.reduce((sum, row) => sum + row.converted, 0);
  return {
    rows,
    totals: {
      leads: totalLeads,
      contacted: totalContacted,
      scheduled: totalScheduled,
      converted: totalConverted,
      conversionRate: totalLeads
        ? Math.round((totalConverted / totalLeads) * 1000) / 10
        : 0,
    },
  };
}

export async function listPdvs(includeInactive = false) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pdvs)
    .where(includeInactive ? undefined : eq(pdvs.isActive, true))
    .orderBy(asc(pdvs.name));
}

export async function listCampaigns(user: AccessUser, includeInactive = false) {
  const db = await getDb();
  if (!db) return [];
  const allowedPdvs = await getAccessiblePdvIds(user);
  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(
      includeInactive && user.role === "admin"
        ? undefined
        : and(eq(campaigns.isActive, true), isNull(campaigns.deletedAt))
    )
    .orderBy(desc(campaigns.createdAt));
  const scopes = await db
    .select({
      campaignId: campaignPdvs.campaignId,
      pdvId: pdvs.id,
      pdvName: pdvs.name,
      pdvActive: pdvs.isActive,
    })
    .from(campaignPdvs)
    .innerJoin(pdvs, eq(campaignPdvs.pdvId, pdvs.id));
  return campaignRows
    .map(campaign => ({
      ...campaign,
      pdvs: scopes
        .filter(scope => scope.campaignId === campaign.id)
        .map(({ pdvId, pdvName, pdvActive }) => ({
          id: pdvId,
          name: pdvName,
          isActive: pdvActive,
        })),
    }))
    .filter(
      campaign =>
        user.role === "admin" ||
        campaign.pdvs.some(pdv => allowedPdvs?.includes(pdv.id))
    );
}

export async function saveCampaign(
  input: { id?: number; name: string; description?: string; pdvIds: number[] },
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const uniquePdvIds = Array.from(new Set(input.pdvIds));
  if (!uniquePdvIds.length)
    throw new Error("Selecione ao menos um PDV para a campanha");
  const activePdvs = await db
    .select({ id: pdvs.id })
    .from(pdvs)
    .where(and(inArray(pdvs.id, uniquePdvIds), eq(pdvs.isActive, true)));
  if (activePdvs.length !== uniquePdvIds.length)
    throw new Error("Um ou mais PDVs selecionados não estão ativos");
  const values = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    updatedAt: new Date(),
  };
  let campaignId = input.id;
  await db.transaction(async tx => {
    if (campaignId) {
      const current = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);
      if (!current[0]) throw new Error("Campanha não encontrada");
      await tx
        .update(campaigns)
        .set(values)
        .where(eq(campaigns.id, campaignId));
      await tx
        .delete(campaignPdvs)
        .where(eq(campaignPdvs.campaignId, campaignId));
    } else {
      const inserted = await tx
        .insert(campaigns)
        .values({
          ...values,
          createdBy: actorId,
          isActive: true,
          isFrozen: false,
          deletedAt: null,
        });
      campaignId = Number(inserted[0].insertId);
    }
    await tx
      .insert(campaignPdvs)
      .values(uniquePdvIds.map(pdvId => ({ campaignId: campaignId!, pdvId })));
  });
  await writeAudit(
    actorId,
    input.id ? "campaign_updated" : "campaign_created",
    "campaign",
    campaignId,
    { name: values.name, pdvIds: uniquePdvIds }
  );
  return { id: campaignId };
}

export async function deleteCampaign(id: number, actorId: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const campaign = (
    await db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1)
  )[0];
  if (!campaign) throw new Error("Campanha não encontrada");
  const counts = { leads: 0, activities: 0, followUps: 0 };
  await db.transaction(async tx => {
    const campaignLeads = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.campaignId, id));
    const leadIds = campaignLeads.map(lead => lead.id);
    counts.leads = leadIds.length;
    if (leadIds.length) {
      const [activities] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(leadActivities)
        .where(inArray(leadActivities.leadId, leadIds));
      const [followUpsForLeads] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(followUps)
        .where(inArray(followUps.leadId, leadIds));
      counts.activities = Number(activities?.count ?? 0);
      counts.followUps = Number(followUpsForLeads?.count ?? 0);
      await tx.delete(followUps).where(inArray(followUps.leadId, leadIds));
      await tx
        .delete(leadActivities)
        .where(inArray(leadActivities.leadId, leadIds));
      await tx.delete(leads).where(inArray(leads.id, leadIds));
    }
    await tx.delete(campaignPdvs).where(eq(campaignPdvs.campaignId, id));
    await tx.delete(campaigns).where(eq(campaigns.id, id));
  });
  await writeAudit(actorId, "campaign_deleted", "campaign", id, {
    name: campaign.name,
    cascadeDeleted: counts,
  });
  return { success: true } as const;
}

export async function setCampaignFrozen(
  id: number,
  isFrozen: boolean,
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const result = await db
    .update(campaigns)
    .set({ isFrozen, updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.isActive, true),
        isNull(campaigns.deletedAt)
      )
    );
  const affected = Number(
    (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
  if (!affected) throw new Error("Campanha não encontrada");
  await writeAudit(
    actorId,
    isFrozen ? "campaign_frozen" : "campaign_unfrozen",
    "campaign",
    id
  );
  return { success: true } as const;
}

export async function getDashboardFilters(user: AccessUser) {
  const [visiblePdvs, visibleCampaigns] = await Promise.all([
    user.role === "admin"
      ? listPdvs(false)
      : listPdvs(false).then(async items => {
          const allowed = await getAccessiblePdvIds(user);
          return items.filter(pdv => allowed?.includes(pdv.id));
        }),
    listCampaigns(user, false),
  ]);
  const db = await getDb();
  if (!db)
    return { pdvs: visiblePdvs, campaigns: visibleCampaigns, sellers: [] };
  const allowedIds = visiblePdvs.map(pdv => pdv.id);
  if (!allowedIds.length)
    return { pdvs: visiblePdvs, campaigns: visibleCampaigns, sellers: [] };
  const sellerScopes = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      pdvId: userPdvs.pdvId,
    })
    .from(users)
    .innerJoin(userPdvs, eq(users.id, userPdvs.userId))
    .where(
      and(
        eq(users.isActive, true),
        eq(users.role, "user"),
        inArray(userPdvs.pdvId, allowedIds)
      )
    );
  const sellers = Array.from(
    new Map(
      sellerScopes.map(seller => [
        seller.userId,
        {
          id: seller.userId,
          name: seller.name || seller.email || `Vendedor #${seller.userId}`,
        },
      ])
    ).values()
  );
  return { pdvs: visiblePdvs, campaigns: visibleCampaigns, sellers };
}

export async function savePdv(
  input: {
    id?: number;
    name: string;
    code: string;
    city?: string;
    region?: string;
    managerUserId?: number;
    leadTarget?: number;
    conversionTarget?: number;
    isActive?: boolean;
  },
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const values = {
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    managerUserId: input.managerUserId ?? null,
    leadTarget: input.leadTarget ?? null,
    conversionTarget: input.conversionTarget ?? null,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };
  if (input.id) {
    await db.update(pdvs).set(values).where(eq(pdvs.id, input.id));
    await writeAudit(actorId, "pdv_updated", "pdv", input.id, {
      name: values.name,
    });
    return input.id;
  }
  const inserted = await db.insert(pdvs).values(values);
  const id = Number(
    (inserted as unknown as [{ insertId?: number }])[0]?.insertId
  );
  await writeAudit(actorId, "pdv_created", "pdv", id, { name: values.name });
  return id;
}

export async function setPdvActive(
  id: number,
  isActive: boolean,
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  await db
    .update(pdvs)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(pdvs.id, id));
  await writeAudit(
    actorId,
    isActive ? "pdv_activated" : "pdv_deactivated",
    "pdv",
    id
  );
}

export async function updateUserAccess(
  input: { userId: number; role: AppRole; isActive: boolean; pdvIds: number[] },
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  if (input.userId === actorId && input.role !== "admin")
    throw new Error("Você não pode remover seu próprio acesso administrativo");
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!existing[0]) throw new Error("Usuário não encontrado");
  await db.transaction(async tx => {
    await tx
      .update(users)
      .set({
        role: input.role,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId));
    await tx.delete(userPdvs).where(eq(userPdvs.userId, input.userId));
    if (input.pdvIds.length)
      await tx
        .insert(userPdvs)
        .values(input.pdvIds.map(pdvId => ({ userId: input.userId, pdvId })));
  });
  await writeAudit(actorId, "user_access_updated", "user", input.userId, {
    role: input.role,
    isActive: input.isActive,
    pdvIds: input.pdvIds,
  });
}

export async function createManagedUser(
  input: {
    name: string;
    email: string;
    passwordHash: string;
    role: AppRole;
    pdvIds: number[];
  },
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const openId = `local:${email}`;
  if (input.role === "user" && !input.pdvIds.length)
    throw new Error("Selecione ao menos um PDV para o vendedor");
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.openId, openId)))
    .limit(1);
  if (existing.length) throw new Error("Já existe um usuário com este e-mail");
  let userId = 0;
  await db.transaction(async tx => {
    const inserted = await tx
      .insert(users)
      .values({
        openId,
        name,
        email,
        loginMethod: "password",
        passwordHash: input.passwordHash,
        role: input.role,
        isActive: true,
        lastSignedIn: new Date(),
      });
    userId = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId ?? 0
    );
    if (!userId) throw new Error("Não foi possível criar o usuário");
    if (input.pdvIds.length)
      await tx
        .insert(userPdvs)
        .values(input.pdvIds.map(pdvId => ({ userId, pdvId })));
    if (input.role === "user" && input.pdvIds.length) {
      const primaryPdv = await tx
        .select({ name: pdvs.name })
        .from(pdvs)
        .where(eq(pdvs.id, input.pdvIds[0]))
        .limit(1);
      if (primaryPdv[0])
        await tx
          .insert(sellerProfiles)
          .values({ userId, store: primaryPdv[0].name, displayName: name });
    }
  });
  await writeAudit(actorId, "user_created", "user", userId, {
    email,
    role: input.role,
    pdvIds: input.pdvIds,
  });
  return { id: userId };
}

export async function resetManagedUserPassword(
  userId: number,
  passwordHash: string,
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const existing = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing[0]) throw new Error("Usuário não encontrado");
  if (!existing[0].isActive)
    throw new Error("Reative o usuário antes de redefinir a senha");
  const now = new Date();
  await db.transaction(async tx => {
    await tx
      .update(users)
      .set({ passwordHash, loginMethod: "password", updatedAt: now })
      .where(eq(users.id, userId));
    await tx
      .update(passwordResetRequests)
      .set({ resolvedAt: now, resolvedBy: actorId })
      .where(
        and(
          eq(passwordResetRequests.userId, userId),
          isNull(passwordResetRequests.resolvedAt)
        )
      );
  });
  await writeAudit(actorId, "user_password_reset", "user", userId);
}

export async function requestPasswordReset(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const normalizedEmail = email.trim().toLowerCase();
  const user = (
    await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
  )[0];
  // The response remains the same for every address, preventing account discovery.
  if (!user?.isActive) return { accepted: true } as const;
  const pending = await db
    .select({ id: passwordResetRequests.id })
    .from(passwordResetRequests)
    .where(
      and(
        eq(passwordResetRequests.userId, user.id),
        isNull(passwordResetRequests.resolvedAt)
      )
    )
    .limit(1);
  if (!pending[0]) {
    await db
      .insert(passwordResetRequests)
      .values({ userId: user.id, email: normalizedEmail });
    await writeAudit(user.id, "password_reset_requested", "user", user.id);
  }
  return { accepted: true } as const;
}

export async function getPasswordResetRequests() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: passwordResetRequests.id,
      userId: passwordResetRequests.userId,
      email: passwordResetRequests.email,
      requestedAt: passwordResetRequests.requestedAt,
      userName: users.name,
    })
    .from(passwordResetRequests)
    .leftJoin(users, eq(passwordResetRequests.userId, users.id))
    .where(isNull(passwordResetRequests.resolvedAt))
    .orderBy(desc(passwordResetRequests.requestedAt));
}

export async function deactivateManagedUser(userId: number, actorId: number) {
  if (userId === actorId)
    throw new Error("Você não pode excluir seu próprio usuário");
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing[0]) throw new Error("Usuário não encontrado");
  await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await writeAudit(actorId, "user_deactivated", "user", userId);
}

export async function getAuditLogs(page = 1, pageSize = 50) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const [items, count] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs),
  ]);
  return { items, total: Number(count[0]?.count ?? 0) };
}

export async function getScheduledFollowUps(user: AccessUser) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [isNull(followUps.completedAt), isNull(leads.deletedAt)];
  if (user.role === "user") {
    // A seller sees only appointments that they created for leads in their own
    // portfolio, never another seller's or an unassigned lead's follow-up.
    conditions.push(
      eq(followUps.createdBy, user.id),
      eq(leads.assignedTo, user.id)
    );
  } else if (user.role === "supervisor") {
    const allowedPdvs = await getAccessiblePdvIds(user);
    if (!allowedPdvs?.length) return [];
    conditions.push(inArray(leads.pdvId, allowedPdvs));
  }
  return db
    .select({
      id: followUps.id,
      leadId: followUps.leadId,
      dueAt: followUps.dueAt,
      note: followUps.note,
      createdAt: followUps.createdAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadStore: leads.store,
      leadStatus: leads.status,
    })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(and(...conditions))
    .orderBy(asc(followUps.dueAt));
}

export async function getLeadTreatmentExport(
  user: AccessUser,
  filters: { sellerId?: number; pdvId?: number; campaignId?: number } = {}
) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [isNull(leads.deletedAt)];
  if (filters.pdvId) conditions.push(eq(leads.pdvId, filters.pdvId));
  if (filters.campaignId)
    conditions.push(eq(leads.campaignId, filters.campaignId));
  if (user.role === "user") {
    conditions.push(eq(leads.assignedTo, user.id));
  } else if (user.role === "supervisor") {
    const allowedPdvs = await getAccessiblePdvIds(user);
    if (!allowedPdvs?.length) return [];
    conditions.push(inArray(leads.pdvId, allowedPdvs));
  }
  // A seller cannot turn an export filter into access to another seller.
  if (
    filters.sellerId &&
    (user.role !== "user" || filters.sellerId === user.id)
  ) {
    conditions.push(eq(leads.assignedTo, filters.sellerId));
  }
  const scopedLeads = await db
    .select()
    .from(leads)
    .where(and(...conditions))
    .orderBy(asc(leads.id));
  if (!scopedLeads.length) return [];
  const leadIds = scopedLeads.map(lead => lead.id);
  const activities = await db
    .select()
    .from(leadActivities)
    .where(inArray(leadActivities.leadId, leadIds))
    .orderBy(asc(leadActivities.createdAt));
  const personIds = Array.from(
    new Set([
      ...scopedLeads.flatMap(lead =>
        lead.assignedTo ? [lead.assignedTo] : []
      ),
      ...activities.map(activity => activity.userId),
    ])
  );
  const people = personIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, personIds))
    : [];
  const personName = new Map(
    people.map(person => [
      person.id,
      person.name || person.email || `Usuário #${person.id}`,
    ])
  );
  const activitiesByLead = new Map<number, typeof activities>();
  for (const activity of activities)
    activitiesByLead.set(activity.leadId, [
      ...(activitiesByLead.get(activity.leadId) ?? []),
      activity,
    ]);
  return scopedLeads.flatMap(lead => {
    const leadActivities = activitiesByLead.get(lead.id) ?? [];
    const base = {
      leadId: lead.id,
      leadName: lead.name,
      phone: lead.phone,
      pdv: lead.store,
      campaignId: lead.campaignId,
      seller: lead.assignedTo
        ? (personName.get(lead.assignedTo) ?? `Vendedor #${lead.assignedTo}`)
        : "Não assumido",
      statusAtual: lead.status,
      dataEntrada: lead.createdAt,
      proximoFollowUp: lead.nextFollowUpAt,
    };
    return (leadActivities.length ? leadActivities : [null]).map(activity => ({
      ...base,
      dataTratativa: activity?.createdAt ?? null,
      responsavelTratativa: activity
        ? (personName.get(activity.userId) ?? `Usuário #${activity.userId}`)
        : null,
      acao: activity?.action ?? "",
      canal: activity?.channel ?? null,
      statusTratativa: activity?.status ?? null,
      observacao: activity?.note ?? "",
    }));
  });
}

export async function getPendingLeads(user: AccessUser) {
  const visible = await getVisibleLeads(user, {});
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  return {
    withoutContact: visible.filter(lead => !lead.firstContactAt),
    noAnswer: visible.filter(lead => lead.status === "no_answer"),
    followUpsToday: visible.filter(
      lead =>
        lead.nextFollowUpAt &&
        lead.nextFollowUpAt <= new Date(now.getTime() + day)
    ),
    stale: visible.filter(
      lead => now.getTime() - lead.updatedAt.getTime() > day
    ),
    nearSla: visible.filter(
      lead =>
        !lead.assignedTo &&
        now.getTime() - lead.createdAt.getTime() > 5 * 60 * 1000
    ),
  };
}
