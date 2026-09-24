import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { eq } from "drizzle-orm";
import { users, type V2User } from "../../drizzle-v2/schema";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { sdk } from "../_core/sdk";
import { getV2Db } from "./database";

export type V2TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: V2User | null;
  requestedPartnerId: number | null;
};

function parsePartnerId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function createV2Context(opts: CreateExpressContextOptions): Promise<V2TrpcContext> {
  let user: V2User | null = null;
  try {
    const token = parseCookieHeader(opts.req.headers.cookie ?? "")[COOKIE_NAME];
    const session = await sdk.verifySession(token);
    if (session) {
      const db = await getV2Db();
      user = (await db.select().from(users).where(eq(users.openId, session.openId)).limit(1))[0] ?? null;
    }
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    // This header selects a tenant but is never an authorization grant.
    requestedPartnerId: parsePartnerId(opts.req.headers["x-partner-id"]),
  };
}
