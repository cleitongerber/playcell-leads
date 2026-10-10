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
  const productivity = readProjectFile("client/src/pages/V2Productivity.tsx");
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

  it("keeps the dashboard as a detection flow rather than a funnel of unrelated facts", () => {
    const summary = dashboard.indexOf("Resumo da operação");
    const attention = dashboard.indexOf("Pontos de atenção");
    const journey = dashboard.indexOf("Jornada da base");
    const quality = dashboard.indexOf("Qualidade dos registros");
    const overview = dashboard.indexOf("Visão operacional");

    expect(summary).toBeGreaterThan(-1);
    expect(attention).toBeGreaterThan(summary);
    expect(journey).toBeGreaterThan(attention);
    expect(quality).toBeGreaterThan(journey);
    expect(overview).toBeGreaterThan(quality);
    expect(dashboard).toContain("Cobertura de trabalho");
    expect(dashboard).toContain("Leads com tentativa");
    expect(dashboard).toContain("Evidências nas tentativas");
    expect(dashboard).toContain('Base atual');
    expect(dashboard).toContain('Tx. contato');
    expect(dashboard).not.toContain("Funil da coorte do período");
    expect(dashboard).toContain("JourneyStage");
    expect(dashboard).toContain("openHealthDetail(\"assigned_without_work\")");
    expect(dashboard).toContain("openHealthDetail(\"follow_ups_overdue\")");
    expect(dashboard).toContain('className="v2-metric-card-header"');
    expect(dashboard).toContain("v2-metric-icon");
    expect(dashboard).toContain("function compactDelta(");
    expect(dashboard).toContain("return `↑ ${formatted}`;");
    expect(dashboard).toContain("return `↓ ${formatted}`;");
    expect(styles).toContain(".v2-dashboard-summary-metrics");
    expect(styles).toContain(".v2-dashboard-journey-content");
    expect(styles).toContain(".v2-dashboard-quality-list");
  });

  it("keeps the dashboard filter action inline and scoped to the dashboard grid", () => {
    expect(styles).toContain(
      "grid-template-columns:8.75rem minmax(11.25rem,1.2fr)"
    );
    expect(styles).toContain("grid-column:5 !important");
    expect(styles).toContain("align-self:end");
  });

  it("keeps productivity focused on diagnosing people and execution cadence", () => {
    expect(productivity).toContain("Desempenho por vendedor");
    expect(productivity).toContain("Evolução da produtividade");
    expect(productivity).toContain("Cobertura de trabalho");
    expect(productivity).toContain("Tentativas médias por Lead");
    expect(productivity).toContain("Leads com tentativa");
    expect(productivity).toContain("Tent. / Lead");
    expect(productivity).toContain("function ratio(");
    expect(productivity).toContain("SellerDrawer");
    expect(productivity).toContain("Ver evolução individual");
    expect(productivity).toContain("SortableHead");
    expect(productivity).not.toContain("Atividade por vendedor");
    expect(styles).toContain(".v2-productivity-bars");
    expect(styles).toContain(".v2-productivity-daily");
  });

  it("uses one responsive reports toolbar instead of independently wrapping filter groups", () => {
    expect(reports).toContain('className="v2-reports-toolbar-fields"');
    expect(reports).toContain('className="v2-reports-toolbar-actions"');
    expect(reports).toContain('data-report-field="type"');
    expect(reports).toContain('className="v2-reports-analytics min-w-0"');
    expect(reports).toContain("hideClear");
    expect(styles).toContain(".v2-reports-toolbar-fields");
    expect(styles).toContain(".v2-reports-toolbar-actions");
    expect(styles).toContain(".v2-reports-toolbar { grid-template-columns:repeat(5");
    expect(styles).toContain(".v2-reports-toolbar-actions { grid-column:4 / span 2");
    expect(styles).toContain('[data-analytics-field="campaign"]');
  });
});
