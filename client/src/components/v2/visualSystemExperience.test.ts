import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("FLUXO visual system experience contracts", () => {
  const styles = readProjectFile("client/src/index.css");
  const shell = readProjectFile("client/src/components/v2/V2AppShell.tsx");
  const leads = readProjectFile("client/src/pages/V2Leads.tsx");
  const followUps = readProjectFile("client/src/pages/V2FollowUps.tsx");
  const administration = readProjectFile(
    "client/src/pages/V2Administration.tsx"
  );
  const dashboard = readProjectFile("client/src/pages/V2Dashboard.tsx");
  const reports = readProjectFile("client/src/pages/V2Reports.tsx");
  const journey = readProjectFile(
    "client/src/components/v2/V2SeparatedLeadJourney.tsx"
  );

  it("keeps the shared visual tokens and responsive shell centralized", () => {
    for (const token of [
      "--space-1: 0.25rem",
      "--space-4: 1rem",
      "--space-6: 1.5rem",
      "--space-12: 3rem",
      "--shadow-card:",
      "--shadow-floating:",
      ".v2-desktop-sidebar",
      ".v2-mobile-bottom-nav",
      "@media (min-width: 1024px)",
    ]) {
      expect(styles).toContain(token);
    }
  });

  it("uses the approved split login composition without changing authentication controls", () => {
    expect(shell).toContain("function V2AuthAside()");
    expect(shell).toContain('className="v2-login-aside"');
    expect(shell).toContain('className="v2-login-panel"');
    expect(shell).toContain('id="v2-login-email"');
    expect(shell).toContain('id="v2-login-password"');
    expect(shell).toContain("v2trpc.auth.login.useMutation");
    expect(shell).toContain("Mais oportunidades.");
    expect(shell).toContain("Mais resultados.");
  });

  it("uses compact visual tabs while preserving the existing lead and follow-up state", () => {
    expect(leads).toContain('className="v2-tab-list"');
    expect(leads).toContain("updateListState({ view: option, page: 1 })");
    expect(followUps).toContain('className="v2-tab-list"');
    expect(followUps).toContain("setView(option);");
  });

  it("keeps a single quick-contact area in the Lead workspace", () => {
    expect(journey).toContain('className="v2-contact-shortcuts flex');
    expect(journey).not.toContain('actionPresentation.cta === "contact"');
    expect(journey).toContain("onClick={openWhatsApp}");
    expect(journey).toContain("onClick={openTelephone}");
  });

  it("keeps operational filters compact and separates administration by purpose", () => {
    expect(reports).toContain('<PageToolbar className="v2-reports-toolbar">');
    expect(reports).toContain("inline");
    expect(administration).toContain('setAdminSection("users")');
    expect(administration).toContain('setAdminSection("pdvs")');
    expect(administration).toContain('setAdminSection("settings")');
    expect(administration).toContain("Comunicação com Leads");
    expect(administration.indexOf("Comunicação com Leads")).toBeLessThan(
      administration.indexOf("<CardTitle>Mensagem inicial do WhatsApp")
    );
  });

  it("keeps the operational dashboard in the approved KPI, funnel, health, and overview order", () => {
    const firstKpi = dashboard.indexOf('title="Leads recebidos"');
    const secondMetricBand = dashboard.indexOf(
      "v2-dashboard-secondary-metrics"
    );
    const mainLayout = dashboard.indexOf("v2-dashboard-primary-layout");
    const overviewLayout = dashboard.indexOf("v2-dashboard-overview-shell");

    expect(firstKpi).toBeGreaterThan(-1);
    expect(secondMetricBand).toBeGreaterThan(firstKpi);
    expect(mainLayout).toBeGreaterThan(secondMetricBand);
    expect(overviewLayout).toBeGreaterThan(mainLayout);
    expect(dashboard).toContain("v2-dashboard-health");
    expect(dashboard).toContain("v2-health-attempt-coverage");
    expect(dashboard).toContain("Indicadores do período");
    expect(dashboard).toContain("Funil da coorte do período");
    expect(dashboard).toContain("Os indicadores acima mostram atividades realizadas no");
    expect(dashboard).toContain("Visão operacional");
    expect(dashboard).toContain("v2-dashboard-overview-tabs");
    expect(styles).toContain(".v2-dashboard-primary-metrics { grid-template-columns:repeat(6");
    expect(styles).toContain(".v2-health-list { grid-template-columns:repeat(3");
  });

  it("uses one responsive reports toolbar instead of independently wrapping filter groups", () => {
    expect(reports).toContain('className="v2-reports-toolbar-fields"');
    expect(reports).toContain('className="v2-reports-toolbar-actions"');
    expect(reports).toContain("hideClear");
    expect(styles).toContain(".v2-reports-toolbar-fields");
    expect(styles).toContain(".v2-reports-toolbar-actions");
    expect(styles).toContain(".v2-reports-toolbar-fields { grid-template-columns:repeat(6");
  });
});
