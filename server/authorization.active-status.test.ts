import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(
  role: "admin" | "supervisor" | "user",
  isActive: boolean
): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 42,
      openId: "active-status-test",
      name: "Usuário de teste",
      email: "test@example.com",
      loginMethod: "test",
      role,
      isActive,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("authorization for inactive users", () => {
  it("allows an active authenticated user through protected procedures", async () => {
    const caller = appRouter.createCaller(createContext("user", true));
    await expect(caller.leads.list()).resolves.toEqual([]);
  });

  it("blocks an inactive user from protected endpoints", async () => {
    const caller = appRouter.createCaller(createContext("user", false));
    await expect(caller.leads.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Seu acesso está inativo. Fale com um administrador.",
    });
  });

  it("blocks an inactive administrator before administrative endpoints execute", async () => {
    const caller = appRouter.createCaller(createContext("admin", false));
    await expect(caller.team.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Seu acesso está inativo. Fale com um administrador.",
    });
  });
});
