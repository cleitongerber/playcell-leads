import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../../drizzle-v2/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartnerContext } from "./access";

const databaseMock = vi.hoisted(() => ({
  database: null as unknown,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("./database", async importOriginal => {
  const actual = await importOriginal<typeof import("./database")>();
  return {
    ...actual,
    getV2Db: vi.fn(async () => databaseMock.database),
  };
});

import { listLeadListFilters, listLeads } from "./leadService";

const context: PartnerContext = {
  partnerId: 41,
  membershipId: 17,
  role: "partner_admin",
  pdvScopeMode: "all",
  userId: 9,
};

function createDialectDatabase() {
  const client = {
    async query(
      query: { sql?: string },
      params: unknown[] = []
    ): Promise<[unknown[][], unknown[]]> {
      databaseMock.queries.push({ sql: query.sql ?? "", params });
      // A real mysql2 Drizzle session compiles every query; returned rows are
      // controlled and read-only, so no database connection is required.
      return [[], []];
    },
  };
  return drizzle({
    client: client as never,
    schema,
    mode: "default",
  });
}

describe("seller portfolio MySQL/TiDB query execution contract", () => {
  beforeEach(() => {
    databaseMock.queries.length = 0;
    databaseMock.database = createDialectDatabase();
  });

  it("qualifies the pending follow-up fact in priority, operational filters and ordering", async () => {
    for (const operationalFilter of ["all", "action", "returns"] as const) {
      await listLeads(context, {
        view: "mine",
        page: 1,
        pageSize: 25,
        operationalFilter,
      });
    }

    const portfolioQueries = databaseMock.queries.filter(
      query =>
        query.sql.includes("portfolio_pending_follow_up_facts") &&
        query.sql.includes("as `priorityRank`")
    );
    expect(portfolioQueries).toHaveLength(3);

    for (const query of portfolioQueries) {
      expect(query.sql).toContain("as `pendingNextFollowUpAt`");
      expect(query.sql).toContain(
        "`portfolio_pending_follow_up_facts`.`pendingNextFollowUpAt`"
      );
      expect(query.sql).toContain("`portfolio_attempt_facts`.`attemptCount`");
      expect(query.sql).toContain(
        "`portfolio_effective_contact_facts`.`lastEffectiveContactAt`"
      );
      expect(query.sql).toContain(
        "`portfolio_conversion_facts`.`conversionAt`"
      );
      expect(query.sql).not.toContain("when `nextFollowUpAt` is not null");
      expect(query.sql).not.toContain("then `nextFollowUpAt` end");
      expect(query.params).toContain(context.partnerId);
    }

    expect(
      portfolioQueries.some(query => query.sql.includes("in (1, 2, 3, 4)"))
    ).toBe(true);
    expect(
      portfolioQueries.some(query => query.sql.includes("in (1, 2, 6)"))
    ).toBe(true);
  });

  it("projects the tenant-safe assignee name and operational facts outside Minha carteira without changing chronology", async () => {
    await listLeads(context, {
      view: "all",
      page: 1,
      pageSize: 25,
    });

    const listQuery = databaseMock.queries.find(query =>
      query.sql.includes("left join `user_partners`")
    );
    expect(listQuery).toBeDefined();
    expect(listQuery?.sql).toContain("left join `user_partners`");
    expect(listQuery?.sql).toContain("`user_partners`.`partnerId` = `leads`.`partnerId`");
    expect(listQuery?.sql).toContain("left join `users`");
    expect(listQuery?.sql).toContain("portfolio_attempt_facts");
    expect(listQuery?.sql).toContain("order by `leads`.`receivedAt` desc, `leads`.`id` desc");
    expect(listQuery?.sql).not.toContain("order by case");
    expect(listQuery?.params).toContain(context.partnerId);
  });

  it("applies commercial status, PDV and assignee filters before pagination in the tenant query", async () => {
    await listLeads(context, {
      view: "all",
      page: 1,
      pageSize: 25,
      statusId: 12,
      pdvId: 31,
      assignedMembershipId: 44,
    });

    const listQuery = databaseMock.queries.find(query =>
      query.sql.includes("order by `leads`.`receivedAt` desc")
    );
    expect(listQuery).toBeDefined();
    expect(listQuery?.sql).toContain("`leads`.`partnerId` = ?");
    expect(listQuery?.sql).toContain("`leads`.`pdvId` = ?");
    expect(listQuery?.sql).toContain("`leads`.`statusId` = ?");
    expect(listQuery?.sql).toContain("`leads`.`assignedMembershipId` = ?");
    expect(listQuery?.params).toEqual(
      expect.arrayContaining([context.partnerId, 31, 12, 44])
    );
  });

  it("returns management filter options from the current tenant only", async () => {
    await listLeadListFilters(context);

    const sellerQuery = databaseMock.queries.find(query =>
      query.sql.includes("`user_partners`.`role` = ?")
    );
    expect(sellerQuery).toBeDefined();
    expect(sellerQuery?.sql).toContain("`user_partners`.`partnerId` = ?");
    expect(sellerQuery?.sql).toContain(
      "`user_pdv_assignments`.`partnerId` = ?"
    );
    expect(sellerQuery?.params).toEqual(
      expect.arrayContaining([context.partnerId, "seller"])
    );
  });

  it("keeps the assigned view limited to the seller's own portfolio", async () => {
    await listLeads(
      { ...context, role: "seller", membershipId: 17, pdvScopeMode: "all" },
      { view: "assigned", page: 1, pageSize: 25 }
    );

    const listQuery = databaseMock.queries.find(query =>
      query.sql.includes("order by `leads`.`receivedAt` desc")
    );
    expect(listQuery?.sql).toContain("`leads`.`assignedMembershipId` = ?");
    expect(listQuery?.params).toEqual(
      expect.arrayContaining([context.partnerId, 17])
    );
  });
});
