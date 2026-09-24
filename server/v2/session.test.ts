import { describe, expect, it } from "vitest";
import { createV2SessionCodec, readV2SessionSecret } from "./session";

const secret = "v2-test-secret-that-is-longer-than-thirty-two-characters";

describe("V2 isolated session", () => {
  it("requires a dedicated strong V2 secret", () => {
    expect(() => readV2SessionSecret({})).toThrow("V2_SESSION_SECRET");
    expect(() =>
      readV2SessionSecret({ V2_SESSION_SECRET: "too-short" })
    ).toThrow("V2_SESSION_SECRET");
  });

  it("does not accept malformed or foreign session tokens", async () => {
    const codec = createV2SessionCodec(secret);
    const token = await codec.create({ openId: "local:test", name: "Teste" });
    await expect(codec.verify(token)).resolves.toEqual({
      openId: "local:test",
      name: "Teste",
    });
    await expect(codec.verify("not-a-token")).resolves.toBeNull();
    await expect(
      createV2SessionCodec(`${secret}-other`).verify(token)
    ).resolves.toBeNull();
  });
});
