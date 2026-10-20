import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../../drizzle-v2/schema";
import { describe, expect, it } from "vitest";
import { findDuplicates } from "./importService";

describe("import deduplication MySQL/TiDB query contract", () => {
  it("scopes CPF lookup to the importing partner", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = drizzle({
      client: {
        async query(
          query: { sql?: string },
          params: unknown[] = []
        ): Promise<[unknown[][], unknown[]]> {
          queries.push({ sql: query.sql ?? "", params });
          return [[], []];
        },
      } as never,
      schema,
      mode: "default",
    });

    await findDuplicates(
      db as never,
      91,
      [
        {
          mapped: {
            normalizedPhone: null,
            normalizedEmail: null,
            normalizedCpf: "01234567890",
          },
        },
      ] as never,
      ["cpf"]
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("`leads`.`partnerId`");
    expect(queries[0].sql).toContain("`leads`.`normalizedCpf`");
    expect(queries[0].params).toEqual(expect.arrayContaining([91, "01234567890"]));
  });
});
