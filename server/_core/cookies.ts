import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Deliberately opt-in for disposable localhost homologation only. A host
 * header alone must never downgrade a session served by a deployed instance.
 */
const LOCAL_HTTP_SESSION_ENV = "V2_ALLOW_LOCAL_HTTP_SESSION";

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

function isLoopbackAddress(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function allowsLocalHttpSession(req: Request, environment: NodeJS.ProcessEnv) {
  return (
    environment[LOCAL_HTTP_SESSION_ENV] === "true" &&
    !isSecureRequest(req) &&
    LOCAL_HOSTS.has(req.hostname.toLowerCase()) &&
    isLoopbackAddress(req.socket.remoteAddress)
  );
}

export function getSessionCookieOptions(
  req: Request,
  environment: NodeJS.ProcessEnv = process.env
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  if (allowsLocalHttpSession(req, environment)) {
    return {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    };
  }

  // Fail closed outside the explicit loopback-only homologation mode.
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: true,
  };
}
