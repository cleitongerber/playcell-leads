import { describe, expect, it } from "vitest";
import { hashV2Password, verifyV2Password } from "./password";

describe("V2 password storage", () => {
  it("stores a salted hash and never accepts a different password", async () => {
    const hash = await hashV2Password("senha-de-teste-segura");
    expect(hash).not.toContain("senha-de-teste-segura");
    await expect(verifyV2Password("senha-de-teste-segura", hash)).resolves.toBe(true);
    await expect(verifyV2Password("senha-incorreta", hash)).resolves.toBe(false);
  });
});
