import { readFileSync } from "node:fs";
import path from "node:path";

export type BuildInfo = {
  version: string;
};

const VERSION_PATTERN = /^[a-f0-9]{7,64}$/i;
const unknownBuildInfo: BuildInfo = { version: "unknown" };

export function parseBuildInfo(value: unknown): BuildInfo {
  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string" &&
    VERSION_PATTERN.test(value.version)
  ) {
    return { version: value.version.toLowerCase() };
  }

  return unknownBuildInfo;
}

/** Reads the immutable build stamp generated after the production build. */
export function readBuildInfo(directory = import.meta.dirname): BuildInfo {
  try {
    const source = readFileSync(path.resolve(directory, "build-info.json"), "utf8");
    return parseBuildInfo(JSON.parse(source));
  } catch {
    return unknownBuildInfo;
  }
}
