import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./cookies";

function request(input: {
  hostname?: string;
  protocol?: string;
  forwardedProto?: string;
  remoteAddress?: string;
} = {}) {
  return {
    hostname: input.hostname ?? "localhost",
    protocol: input.protocol ?? "http",
    headers: input.forwardedProto ? { "x-forwarded-proto": input.forwardedProto } : {},
    socket: { remoteAddress: input.remoteAddress ?? "127.0.0.1" },
  } as never;
}

describe("getSessionCookieOptions", () => {
  it("allows HTTP loopback only with explicit local homologation configuration", () => {
    expect(getSessionCookieOptions(request(), { V2_ALLOW_LOCAL_HTTP_SESSION: "true" })).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  });

  it("keeps HTTPS production cookies secure", () => {
    expect(getSessionCookieOptions(request({ hostname: "playcell-leads.onrender.com", protocol: "https", remoteAddress: "10.0.0.5" }))).toMatchObject({
      httpOnly: true,
      sameSite: "none",
      secure: true,
    });
  });

  it("fails closed without the explicit local flag", () => {
    expect(getSessionCookieOptions(request())).toMatchObject({ sameSite: "none", secure: true });
  });

  it("does not trust a manipulated localhost host from a remote peer", () => {
    expect(getSessionCookieOptions(request({ hostname: "localhost", remoteAddress: "203.0.113.7" }), { V2_ALLOW_LOCAL_HTTP_SESSION: "true" })).toMatchObject({ sameSite: "none", secure: true });
  });

  it("does not downgrade an HTTPS request", () => {
    expect(getSessionCookieOptions(request({ protocol: "https" }), { V2_ALLOW_LOCAL_HTTP_SESSION: "true" })).toMatchObject({ sameSite: "none", secure: true });
  });
});
