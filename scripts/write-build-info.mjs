import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const VERSION_PATTERN = /^[a-f0-9]{7,64}$/i;

function resolveVersion() {
  const environmentVersion =
    process.env.RENDER_GIT_COMMIT ?? process.env.BUILD_COMMIT;
  if (environmentVersion && VERSION_PATTERN.test(environmentVersion)) {
    return environmentVersion.toLowerCase();
  }

  try {
    const version = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return VERSION_PATTERN.test(version) ? version.toLowerCase() : "unknown";
  } catch {
    return "unknown";
  }
}

const outputDirectory = path.resolve(process.cwd(), "dist");
const buildInfo = { version: resolveVersion() };

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, "build-info.json"),
  `${JSON.stringify(buildInfo)}\n`,
  "utf8"
);
console.log(`Build version: ${buildInfo.version}`);
