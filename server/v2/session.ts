import { SignJWT, jwtVerify } from "jose";

export const V2_SESSION_COOKIE_NAME = "playcell_v2_session";
const V2_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 365;

export type V2Session = {
  openId: string;
  name: string;
};

export function readV2SessionSecret(
  environment: NodeJS.ProcessEnv = process.env
) {
  const secret = environment.V2_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "V2_SESSION_SECRET deve ser configurado com ao menos 32 caracteres"
    );
  }
  return secret;
}

export function createV2SessionCodec(secret: string) {
  const key = new TextEncoder().encode(secret);
  return {
    async create(session: V2Session) {
      const expirationSeconds = Math.floor(
        (Date.now() + V2_SESSION_DURATION_MS) / 1000
      );
      return new SignJWT({ openId: session.openId, name: session.name })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setExpirationTime(expirationSeconds)
        .sign(key);
    },
    async verify(token: string | undefined | null): Promise<V2Session | null> {
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ["HS256"],
        });
        const openId = payload.openId;
        const name = payload.name;
        if (typeof openId !== "string" || typeof name !== "string") return null;
        return { openId, name };
      } catch {
        return null;
      }
    },
  };
}

export function createV2SessionToken(session: V2Session) {
  return createV2SessionCodec(readV2SessionSecret()).create(session);
}

export function verifyV2SessionToken(token: string | undefined | null) {
  return createV2SessionCodec(readV2SessionSecret()).verify(token);
}

export { V2_SESSION_DURATION_MS };
