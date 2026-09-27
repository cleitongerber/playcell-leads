import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("FLUXO visual identity contracts", () => {
  it("uses the official product name and PWA colors in the manifest", () => {
    const manifest = JSON.parse(
      readProjectFile("client/public/manifest.webmanifest")
    ) as Record<string, unknown>;

    expect(manifest.name).toBe("FLUXO");
    expect(manifest.short_name).toBe("FLUXO");
    expect(manifest.description).toBe(
      "Gestão de leads e performance comercial."
    );
    expect(manifest.theme_color).toBe("#0F4C5C");
    expect(manifest.background_color).toBe("#F4F6F8");
    expect(manifest.display).toBe("standalone");
  });

  it("centralizes the approved palette and typography in visual tokens", () => {
    const styles = readProjectFile("client/src/index.css");

    for (const token of [
      "--brand-primary: #0f4c5c",
      "--brand-secondary: #2e7d8c",
      "--brand-accent: #46b3bc",
      "--success: #22c55e",
      "--warning: #d99a2b",
      "--danger: #c84c4c",
      "--background: #f4f6f8",
      '"Inter"',
      '"Manrope"',
    ]) {
      expect(styles).toContain(token);
    }
  });

  it("renders the V2 shell with the new textual brand without fabricating a symbol", () => {
    const shell = readProjectFile("client/src/components/v2/V2AppShell.tsx");
    const brand = readProjectFile("client/src/components/v2/FluxoBrand.tsx");

    expect(shell).toContain("<FluxoBrand");
    expect(shell).not.toContain("Playcell Leads");
    expect(brand).toContain("FLUXO");
    expect(brand).toContain("avoids fabricating");
  });
});
