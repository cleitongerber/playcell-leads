import { describe, expect, it } from "vitest";
import type { V2Database } from "./database";
import { writeV2Audit } from "./partnerService";

describe("V2 audit trail", () => {
  it("records a tenant-scoped assignment change without sensitive metadata", async () => {
    const values: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (entry: unknown) => { values.push(entry); },
      }),
    } as unknown as V2Database;

    await writeV2Audit(fakeDb, {
      partnerId: 10,
      actorUserId: 1,
      actorMembershipId: 101,
      action: "membership_pdv_assignment_deactivated",
      entityType: "user_pdv_assignment",
      entityId: "102:45",
      metadata: { membershipId: 102, pdvId: 45 },
    });

    expect(values).toEqual([expect.objectContaining({
      partnerId: 10,
      action: "membership_pdv_assignment_deactivated",
      entityType: "user_pdv_assignment",
      entityId: "102:45",
      metadata: { membershipId: 102, pdvId: 45 },
    })]);
    expect(JSON.stringify(values)).not.toMatch(/password|token|secret/i);
  });
});
