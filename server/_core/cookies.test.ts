import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./cookies";

const initialFlag = process.env.V2_ALLOW_LOCAL_HTTP_SESSION;

function request(input: {
  hostname: string;
  protocol?: string;
  forwardedProto?: string;
  remoteAddress?: string;
}) {
  return {
    hostname: input.hostname,
    protocol: input.protocol ?? "http",
    headers: input.forwardedProto ? { "x-forwarded-proto": input.forwardedProto } : {},
    socket: { remoteAddress: input.remoteAddress ?? "127.0.0.1" },
  } as unknown as Request;
}

afterEach(() => {
  if (initialFlag === undefined) delete process.env.V2_ALLOW_LOCAL_HTTP_SESSION;
  else process.env.V2_ALLOW_LOCAL_HTTP_SESSION = initialFlag;
});

describe("V2 session cookie policy", () => {
  it("allows Lax non-Secure cookies only with explicit local loopback opt-in", () => {
    process.env.V2_ALLOW_LOCAL_HTTP_SESSION = "true";
    expect(getSessionCookieOptions(request({ hostname: "localhost" }))).toMatchObject({
      httpOnly: true, path: "/", sameSite: "lax", secure: false,
    });
  });

  it("keeps HTTPS sessions SameSite=None and Secure", () => {
    process.env.V2_ALLOW_LOCAL_HTTP_SESSION = "true";
    expect(getSessionCookieOptions(request({ hostname: "playcell-leads.onrender.com", protocol: "https", remoteAddress: "10.0.0.2" }))).toMatchObject({
      httpOnly: true, path: "/", sameSite: "none", secure: true,
    });
  });

  it("does not downgrade for an untrusted host or non-loopback connection", () => {
    process.env.V2_ALLOW_LOCAL_HTTP_SESSION = "true";
    expect(getSessionCookieOptions(request({ hostname: "localhost", remoteAddress: "203.0.113.7" }))).toMatchObject({ sameSite: "none", secure: false });
    expect(getSessionCookieOptions(request({ hostname: "example.test" }))).toMatchObject({ sameSite: "none", secure: false });
  });
});
