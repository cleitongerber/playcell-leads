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
  const importConfiguration = readProjectFile(
    "client/src/pages/V2ImportConfiguration.tsx"
  );
  const importer = readProjectFile("client/src/pages/V2Importer.tsx");
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
    expect(leads).toContain("view: option,");
    expect(leads).toContain("page: 1,");
    expect(followUps).toContain('className="v2-tab-list"');
    expect(followUps).toContain("setView(option);");
  });

  it("keeps Minha carteira operational without changing the available queue", () => {
    const mobileFilterStart = leads.indexOf(
      'className="w-full min-w-0 md:hidden"'
    );
    const desktopFilterStart = leads.indexOf(
      'className="hidden min-w-0 flex-1 space-y-1.5 md:block"'
    );
    const mobilePortfolioFilter = leads.slice(
      mobileFilterStart,
      desktopFilterStart
    );

    expect(leads).toContain("Prioridade operacional");
    expect(leads).toContain("Filtros da carteira");
    expect(leads).toContain("Prioridade: {operationalFilterLabels[operationalFilter]}");
    expect(leads).toContain("<SlidersHorizontal className=\"mr-2 size-4\" /> Ajustar");
    expect(leads).toContain('className="hidden min-w-0 flex-1 space-y-1.5 md:block"');
    expect(leads).toContain('className="w-full min-w-0 md:hidden"');
    expect(leads).toContain('updateOperationalFilter("all")');
    expect(leads).toContain('option === "mine" ? operationalFilter : "all"');
    expect(leads).toContain('view === "mine" || operationalFilter === "all"');
    expect(mobilePortfolioFilter).toContain("<Select");
    expect(mobilePortfolioFilter).toContain("<SelectItem key={option} value={option}>");
    expect(mobilePortfolioFilter).toContain('side="bottom"');
    expect(mobilePortfolioFilter).toContain('align="start"');
    expect(mobilePortfolioFilter).toContain("collisionBoundary={");
    expect(mobilePortfolioFilter).toContain(
      "portfolioDrawerBoundary ?? undefined"
    );
    expect(mobilePortfolioFilter).toContain("collisionPadding={12}");
    expect(mobilePortfolioFilter).not.toContain('className="v2-tab-list"');
    expect(mobilePortfolioFilter).toContain(
      "updateOperationalFilter(pendingOperationalFilter)"
    );
    expect(leads).toContain("Para agir");
    expect(leads).toContain("Retorno vencido");
    expect(leads).toContain("Sem atendimento");
    expect(leads).toContain('view === "mine" && presentation');
    expect(leads).toContain('<Badge variant="secondary">Atribuído</Badge>');
    expect(leads).toContain("<Badge>Disponível</Badge>");
    expect(leads).toContain('view === "mine" ? "Operação" : "Responsável"');
  });

  it("uses natural singular and plural language for the existing follow-up alert", () => {
    expect(leads).toContain("function pendingReturnsLabel(count: number)");
    expect(leads).toContain(
      '`${count} retorno${count === 1 ? "" : "s"} pendente${count === 1 ? "" : "s"}`'
    );
    expect(leads).toContain("pendingReturnsLabel(");
    expect(leads).not.toContain("follow-up(s) pendente(s)");
  });

  it("keeps a single quick-contact area in the Lead workspace", () => {
    expect(journey).toContain('className="v2-contact-shortcuts flex');
    expect(journey).not.toContain('actionPresentation.cta === "contact"');
    expect(journey).toContain("onClick={openWhatsApp}");
    expect(journey).toContain("onClick={openTelephone}");
  });

  it("keeps lead custom data dynamic and read-only in the existing detail section", () => {
    expect(journey).toContain('import { presentLeadCustomData } from "@/lib/leadDetailPresentation"');
    expect(journey).toContain("const customLeadData = useMemo(");
    expect(journey).toContain("definitions: detail.data?.customFields");
    expect(journey).toContain("customLeadData.map(field => (");
    expect(journey).toContain("Dados do Lead");
  });

  it("keeps sales scripts as a passive, contextual Lead aid", () => {
    expect(journey).toContain("Scripts de venda");
    expect(journey).toContain("v2trpc.salesScripts.forLead.useQuery");
    expect(journey).toContain("navigator.clipboard.writeText");
    expect(journey).toContain("Nenhum script disponível para esta campanha.");
    expect(journey).toContain("Revise antes de enviar e personalize os campos entre [colchetes].");
    expect(journey).not.toContain("Use como apoio à conversa. Revise antes de enviar e personalize os campos entre [colchetes].");
    expect(journey).toContain('className="w-full sm:w-[220px]" aria-label="Filtrar scripts por categoria"');
    expect(journey).toContain('className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-6"');
    expect(journey).toContain('introduction: "Apresentação"');
    expect(journey).toContain('<Badge variant="secondary">{salesScriptCategoryLabel[script.category]');
    expect(journey).not.toContain("salesScripts.copy.useMutation");
    expect(administration).toContain("Mensagem inicial do WhatsApp");
    expect(administration).toContain("Conteúdos de apoio disponíveis aos vendedores");
    expect(administration.indexOf("Mensagem inicial do WhatsApp")).toBeLessThan(
      administration.indexOf("Scripts de venda")
    );
  });

  it("keeps the new presentation category available to administration without changing WhatsApp configuration", () => {
    expect(administration).toContain('introduction: "Apresentação"');
    expect(administration).toContain('"opening" | "introduction" | "discovery"');
    expect(administration).toContain("Mensagem inicial do WhatsApp");
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
    expect(overview).toBeGreaterThan(journey);
    expect(quality).toBeGreaterThan(overview);
    expect(dashboard).toContain("Cobertura dos recebidos");
    expect(dashboard).toContain("Fatos da operação no período");
    expect(dashboard).toContain("Leads com atividade no período");
    expect(dashboard).toContain("entre os Leads recebidos no período");
    expect(dashboard).toContain('label="Recebidos trabalhados"');
    expect(dashboard).toContain("Com atividade");
    expect(dashboard).not.toContain('title="Cobertura de trabalho"');
    expect(dashboard).not.toContain("Leads trabalhados na operação");
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
    expect(dashboard).toContain("return `↑ ${formatted} vs. anterior`;");
    expect(dashboard).toContain("return `↓ ${formatted} vs. anterior`;");
    expect(styles).toContain(".v2-dashboard-summary-metrics");
    expect(styles).toContain(".v2-dashboard-journey-content");
    expect(styles).toContain(".v2-dashboard-quality-list");
    expect(styles).toContain("grid-template-columns:repeat(5,minmax(0,1fr))");
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
    expect(productivity).toContain("compactPdvNames");
    expect(productivity).toContain('title="Alcance"');
    expect(productivity).toContain('title="Esforço"');
    expect(productivity).toContain('title="Eficiência"');
    expect(productivity).toContain('title="Velocidade"');
    expect(productivity).toContain('title="Disciplina"');
    expect(productivity).toContain("Ver evolução individual");
    expect(productivity).toContain('className="v2-productivity-daily-bar"');
    expect(productivity).toContain("value > 0 && <b>{number(value)}</b>");
    expect(productivity).toContain("metricName");
    expect(productivity).toContain("SortableHead");
    expect(productivity).not.toContain("Atividade por vendedor");
    expect(styles).toContain(".v2-productivity-bars");
    expect(styles).toContain(".v2-productivity-daily");
    expect(styles).toContain(".v2-productivity-drawer-group");
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

  it("keeps import configuration human-readable while preserving the V2 contract", () => {
    expect(importConfiguration).toContain("Regras de duplicidade");
    expect(importConfiguration).toContain("Campos da importação");
    expect(importConfiguration).toContain("Modelos de importação");
    expect(importConfiguration).toContain("Recusar novo registro");
    expect(importConfiguration).toContain("Permitir outro registro");
    expect(importConfiguration).toContain("Atualizar Lead existente");
    expect(importConfiguration).toContain("duplicateIdentifiers: identifiers");
    expect(importConfiguration).toContain('duplicateMatchVersion: "any_v2"');
    expect(importConfiguration).toContain("Regra existente: Telefone + E-mail");
    expect(importConfiguration).toContain("Usar nova regra");
    expect(importConfiguration).toContain("CPF antigo");
    expect(importConfiguration).toContain("Documento do sistema");
    expect(importConfiguration).toContain("Ver configuração");
    expect(importConfiguration).toContain("campos mapeados");
  });

  it("keeps CPF mapping and an explainable import preview available", () => {
    expect(importer).toContain('{ key: "cpf", label: "CPF · Documento" }');
    expect(importer).toContain("Registros encontrados");
    expect(importer).toContain("Prontos para importar");
    expect(importer).toContain("Registros com problema");
    expect(importer).toContain("Telefone já cadastrado");
    expect(importer).toContain("CPF inválido");
  });

  it("keeps campaign duplicate rules aligned with the V2 partner rule experience", () => {
    expect(importer).toContain("Regras de duplicidade da campanha");
    expect(importer).toContain("Usando o padrão do parceiro");
    expect(importer).toContain("Usar regra específica da campanha");
    expect(importer).toContain('["phone", "Telefone"],');
    expect(importer).toContain('["cpf", "CPF"],');
    expect(importer).toContain('["email", "E-mail"],');
    expect(importer).toContain("Recusar novo registro");
    expect(importer).toContain("Permitir outro registro");
    expect(importer).toContain("Atualizar Lead existente");
    expect(importer).toContain("Regra existente: Telefone + E-mail");
    expect(importer).toContain("duplicateIdentifiers,");
    expect(importer).toContain('duplicateMatchVersion: "any_v2"');
  });
});
