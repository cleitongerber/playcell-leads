import { existsSync, readFileSync } from "node:fs";
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
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/fluxo-symbol-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/fluxo-symbol-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/fluxo-symbol-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        }),
      ])
    );
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

  it("uses only derivations of the official FLUXO asset for visible marks and PWA icons", () => {
    const shell = readProjectFile("client/src/components/v2/V2AppShell.tsx");
    const brand = readProjectFile("client/src/components/v2/FluxoBrand.tsx");
    const index = readProjectFile("client/index.html");
    const serviceWorker = readProjectFile("client/public/sw.js");

    expect(shell).toContain("<FluxoBrand");
    expect(shell).not.toContain("Playcell Leads");
    expect(shell).toContain("<FluxoBrand inverse />");
    expect(brand).toContain('"/brand/fluxo-logo.png"');
    expect(brand).toContain('"/brand/fluxo-symbol.png"');
    expect(brand).toContain("fluxo-brand-sidebar-symbol");
    expect(index).toContain('/icons/apple-touch-icon.png');
    expect(index).toContain('/icons/favicon-32.png');
    expect(serviceWorker).toContain('const CACHE = "fluxo-app-v2"');
    expect(serviceWorker).not.toContain("icon-192.svg");
    expect(serviceWorker).not.toContain("icon-512.svg");

    for (const asset of [
      "client/public/brand/fluxo-logo-oficial.jpg",
      "client/public/brand/fluxo-logo.png",
      "client/public/brand/fluxo-symbol.png",
      "client/public/icons/favicon-16.png",
      "client/public/icons/favicon-32.png",
      "client/public/icons/apple-touch-icon.png",
      "client/public/icons/fluxo-symbol-192.png",
      "client/public/icons/fluxo-symbol-512.png",
      "client/public/icons/fluxo-symbol-maskable-512.png",
    ]) {
      expect(existsSync(resolve(process.cwd(), asset))).toBe(true);
    }
  });
});
