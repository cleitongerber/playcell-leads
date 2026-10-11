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

import { listLeads } from "./leadService";

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
});
