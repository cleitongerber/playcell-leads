import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("mobile operational experience contracts", () => {
  it("uses a dedicated visible surface for the Mais sheet on its first render", () => {
    const shell = readProjectFile("client/src/components/v2/V2AppShell.tsx");
    const styles = readProjectFile("client/src/index.css");
    const moreSheet = shell.slice(shell.indexOf("<Sheet open={moreOpen}"));

    expect(moreSheet).toContain('surface="more"');
    expect(moreSheet).toContain("v2-mobile-more-nav-item w-full");
    expect(moreSheet).not.toContain('className="v2-sidebar-nav-item');
    expect(styles).toContain(".v2-mobile-more-nav-item {");
    expect(styles).toContain("color: var(--foreground);");
    expect(styles).toContain(".v2-mobile-more-nav-item:focus-visible");
    expect(shell).toContain("const moreIsActive = moreNavigation.some");
  });

  it("keeps the shared mobile density and disclosure patterns available", () => {
    const styles = readProjectFile("client/src/index.css");
    const dashboard = readProjectFile("client/src/pages/V2Dashboard.tsx");
    const productivity = readProjectFile("client/src/pages/V2Productivity.tsx");
    const reports = readProjectFile("client/src/pages/V2Reports.tsx");
    const followUps = readProjectFile("client/src/pages/V2FollowUps.tsx");

    expect(styles).toContain(".v2-metric-grid");
    expect(styles).toContain(".v2-mobile-detail-grid");
    expect(dashboard).toContain(
      "v2-metric-grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6"
    );
    expect(productivity).toContain("aria-expanded={expanded}");
    expect(productivity).toContain("Ver detalhes");
    expect(reports).toContain(
      "const detailColumns = report.data.columns.slice(4);"
    );
    expect(reports).toContain("Ver mais ${detailColumns.length} campo(s)");
    expect(followUps).toContain("aria-expanded={isRescheduleOpen}");
    expect(followUps).toContain("Confirmar reagendamento");
  });
});
