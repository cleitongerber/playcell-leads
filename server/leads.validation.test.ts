import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAdminContext(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 1,
      openId: "admin-test",
      name: "Admin Teste",
      email: "admin@example.com",
      loginMethod: "test",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("leads validation", () => {
  it("rejects a seller assignment with an unknown store", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.team.assign({ userId: 4, store: "Loja inválida" as never, displayName: "Vendedor" })).rejects.toThrow();
  });

  it("requires a display name when assigning a seller", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.team.assign({ userId: 4, store: "Videira", displayName: "" })).rejects.toThrow();
  });

  it("requires a lead status when updating treatment", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.leads.updateTreatment({ leadId: 1, status: "status-inválido" as never })).rejects.toThrow();
  });
});
