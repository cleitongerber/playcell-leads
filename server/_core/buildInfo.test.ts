import { describe, expect, it } from "vitest";
import { parseBuildInfo } from "./buildInfo";

describe("build information", () => {
  it("exposes only a valid commit identifier", () => {
    expect(parseBuildInfo({ version: "4B75E2D" })).toEqual({
      version: "4b75e2d",
    });
  });

  it("does not expose malformed build metadata", () => {
    expect(parseBuildInfo({ version: "not-a-commit" })).toEqual({
      version: "unknown",
    });
    expect(parseBuildInfo({ secret: "never-expose" })).toEqual({
      version: "unknown",
    });
  });
});
