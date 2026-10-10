import {
  AnalyticsFilters,
  useAnalyticsUrlFilters,
} from "@/components/v2/AnalyticsFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { buildV2Path, currentV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import {
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

type HealthDetailKind =
  | "unassigned"
  | "assigned_without_work"
  | "follow_ups_overdue"
  | "governance_pending"
  | "awaiting_response"
  | "terminal_residual_follow_ups"
  | "evidence_eligible"
  | "evidence_with"
  | "evidence_without"
  | "evidence_required_pending"
  | "attempt_evidence_eligible"
  | "attempt_evidence_with"
  | "attempt_evidence_without"
  | "attempt_evidence_required_pending";

const healthDetailLabels: Record<HealthDetailKind, string> = {
  unassigned: "Leads sem responsável",
  assigned_without_work: "Leads atribuídos sem trabalho",
  follow_ups_overdue: "Follow-ups vencidos",
  governance_pending: "Pendências documentais",
  awaiting_response: "Aguardando resposta",
  terminal_residual_follow_ups: "Follow-ups residuais em Leads terminais",
  evidence_eligible: "Tratativas elegíveis para evidência",
  evidence_with: "Tratativas com evidência",
  evidence_without: "Tratativas sem evidência",
  evidence_required_pending: "Pendências obrigatórias de evidência",
  attempt_evidence_eligible: "Tentativas elegíveis para evidência",
  attempt_evidence_with: "Tentativas com evidência",
  attempt_evidence_without: "Tentativas sem evidência",
  attempt_evidence_required_pending:
    "Pendências obrigatórias de evidência em tentativas",
};

function number(value: number | undefined | null) {
  return new Intl.NumberFormat("pt-BR").format(value ?? 0);
}

function percent(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function duration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}min`
      : `${minutes}min`;
}

function delta(value: number | null | undefined) {
  if (value == null) return "Sem base anterior";
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Math.abs(value));
  return `${value >= 0 ? "+" : "−"}${formatted} vs. anterior`;
}

function compactDelta(value: number | null | undefined) {
  if (value == null) return undefined;
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Math.abs(value));

  if (value > 0) return `↑ ${formatted} vs. anterior`;
  if (value < 0) return `↓ ${formatted} vs. anterior`;
  return `${formatted} vs. anterior`;
}

function CountFact({
  value,
  singular,
  plural,
}: {
  value: number;
  singular: string;
  plural: string;
}) {
  return (
    <span>
      <strong>{number(value)}</strong> {value === 1 ? singular : plural}
    </span>
  );
}

function MetricCard({
  title,
  tooltip,
  value,
  comparison,
  detail,
  href,
  destructive = false,
  compact = false,
  icon: Icon,
}: {
  title: string;
  tooltip?: string;
  value: string;
  comparison?: number | null;
  detail?: string;
  href?: string;
  destructive?: boolean;
  compact?: boolean;
  icon?: LucideIcon;
}) {
  const comparisonText = detail ?? (comparison !== undefined ? delta(comparison) : undefined);
  const comparisonDisplay = compact
    ? undefined
    : detail ?? compactDelta(comparison);
  const comparisonTone =
    comparison == null
      ? undefined
      : comparison > 0
        ? "positive"
        : comparison < 0
          ? "negative"
          : "neutral";
  const accessibleLabel = [tooltip ?? title, value, comparisonText]
    .filter(Boolean)
    .join(". ");
  const content = (
    <article
      className={`v2-metric-card ${compact ? "v2-metric-card--compact" : ""} ${destructive ? "border-danger/60" : ""}`}
      aria-label={accessibleLabel}
      title={comparisonText ?? undefined}
    >
      <div className="v2-metric-card-content">
        <div className="v2-metric-card-header">
          <p
            className="v2-metric-label text-sm text-muted-foreground"
            title={tooltip ?? title}
          >
            {title}
          </p>
          {!compact && Icon ? (
            <span
              className={`v2-metric-icon rounded-lg ${
                destructive
                  ? "bg-danger/10 text-danger"
                  : "bg-brand-accent/10 text-brand-secondary"
              }`}
              aria-hidden="true"
            >
              <Icon className="size-4" />
            </span>
          ) : null}
        </div>
        {compact ? (
          <p className="v2-kpi-value mt-3 text-3xl" title={value}>
            {value}
          </p>
        ) : (
          <div className="v2-metric-card-bottom-row">
            <p className="v2-kpi-value text-3xl" title={value}>
              {value}
            </p>
            {comparisonDisplay && (
              <p
                className={`v2-metric-comparison v2-metric-comparison--${comparisonTone} text-xs`}
                title={comparisonText}
                aria-label={comparisonText}
              >
                {comparisonDisplay}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function V2Dashboard() {
  const [filters, setFilters] = useAnalyticsUrlFilters();
  const [healthDetail, setHealthDetail] = useState<HealthDetailKind | null>(
    null
  );
  const [healthPage, setHealthPage] = useState(1);
  const [overviewTab, setOverviewTab] = useState<"campaigns" | "pdvs">(
    "campaigns"
  );
  const openHealthDetail = (kind: HealthDetailKind) => {
    setHealthPage(1);
    setHealthDetail(kind);
  };
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const dashboard = v2trpc.analytics.dashboard.useQuery(filters, {
    enabled: canQuery,
  });
  const healthDetails = v2trpc.analytics.healthDetails.useQuery(
    {
      ...filters,
      kind: healthDetail ?? "unassigned",
      page: healthPage,
      pageSize: 25,
    },
    { enabled: healthDetail !== null }
  );
  const healthTotalPages = healthDetails.data
    ? Math.max(
        1,
        Math.ceil(healthDetails.data.total / healthDetails.data.pageSize)
      )
    : 1;
  const followUpPath = (view: "overdue" | "today") =>
    buildV2Path("/v2/follow-ups", {
      view,
      campaignId: filters.campaignId,
      pdvId: filters.pdvId,
      ownerMembershipId: filters.sellerMembershipId,
    });

  return (
    <main className="v2-page v2-dashboard-page">
      <V2PageHeader
        eyebrow="Gestão"
        title="Dashboard operacional"
        description="Fatos operacionais no período selecionado e pendências atuais no seu escopo."
      />
      <AnalyticsFilters
        className="v2-dashboard-filters"
        value={filters}
        onChange={setFilters}
      />
      {!canQuery ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas para consultar o período personalizado.
          </CardContent>
        </Card>
      ) : dashboard.isLoading ? (
        <V2LoadingState label="Calculando indicadores operacionais" />
      ) : dashboard.isError ? (
        <V2ErrorState
          message="Não foi possível carregar os indicadores autorizados."
          onRetry={() => dashboard.refetch()}
        />
      ) : dashboard.data ? (
        <>
          <section className="v2-dashboard-summary" aria-labelledby="dashboard-summary-title">
            <div className="v2-dashboard-section-heading">
              <div>
                <p className="v2-dashboard-section-label">Resumo da operação</p>
                <h2 id="dashboard-summary-title">O que aconteceu no período</h2>
              </div>
              <p>Entrada, alcance, eficiência e velocidade da operação.</p>
            </div>
            <div className="v2-metric-grid v2-dashboard-summary-metrics">
              <MetricCard
                title="Leads recebidos"
                value={number(dashboard.data.cards.leadsReceived)}
                comparison={dashboard.data.comparisons.leadsReceived}
                icon={Inbox}
              />
              <MetricCard
                title="Cobertura dos recebidos"
                tooltip="Leads recebidos no período que tiveram tentativa ou contato efetivo."
                value={percent(
                  rate(
                    dashboard.data.funnel.worked,
                    dashboard.data.funnel.received
                  )
                )}
                detail={`${number(dashboard.data.funnel.worked)} de ${number(dashboard.data.funnel.received)} Leads`}
              />
              <MetricCard
                title="Taxa de contato"
                tooltip="Leads com contato efetivo ÷ Leads trabalhados no período"
                value={percent(dashboard.data.cards.effectiveContactRate)}
                comparison={dashboard.data.comparisons.effectiveContactRate}
              />
              <MetricCard
                title="Taxa de conversão"
                tooltip="Leads convertidos ÷ Leads com contato efetivo no período"
                value={percent(dashboard.data.cards.conversionRate)}
                comparison={dashboard.data.comparisons.conversionRate}
              />
              <MetricCard
                title="1ª tentativa"
                tooltip="Tempo médio até a primeira tentativa"
                value={duration(dashboard.data.cards.firstAttemptAverageSeconds)}
              />
              <MetricCard
                title="1º contato"
                tooltip="Tempo médio até o primeiro contato efetivo"
                value={duration(
                  dashboard.data.cards.firstEffectiveContactAverageSeconds
                )}
              />
            </div>
            <div className="v2-dashboard-fact-strip" aria-label="Fatos complementares do período">
              <span className="v2-dashboard-fact-context">Fatos da operação no período</span>
              <CountFact
                value={dashboard.data.cards.leadsWorked}
                singular="Lead com atividade no período"
                plural="Leads com atividade no período"
              />
              <CountFact
                value={dashboard.data.cards.leadsWithAttempt}
                singular="Lead com tentativa"
                plural="Leads com tentativa"
              />
              <CountFact
                value={dashboard.data.cards.attempts}
                singular="tentativa realizada"
                plural="tentativas realizadas"
              />
              <CountFact
                value={dashboard.data.cards.effectiveContacts}
                singular="contato efetivo"
                plural="contatos efetivos"
              />
              <CountFact
                value={dashboard.data.cards.conversions}
                singular="conversão"
                plural="conversões"
              />
              <CountFact
                value={dashboard.data.cards.interested}
                singular="interessado"
                plural="interessados"
              />
            </div>
          </section>

          <section className="v2-dashboard-health-shell">
            <Card className="v2-section-card v2-dashboard-health">
              <CardHeader>
                <CardTitle>Pontos de atenção</CardTitle>
                <p className="text-sm text-muted-foreground">
                  O que precisa de ação agora.
                </p>
              </CardHeader>
              <CardContent className="v2-health-list">
                <HealthItem
                  label="Sem trabalho"
                  title="Leads atribuídos sem tentativa ou contato efetivo"
                  value={dashboard.data.health.assignedWithoutWork}
                  detail={`${percent(
                    rate(
                      dashboard.data.health.assignedWithoutWork,
                      dashboard.data.cards.leadsBase
                    )
                  )} da base atual`}
                  priority
                  onClick={() => openHealthDetail("assigned_without_work")}
                />
                <HealthItem
                  label="Sem responsável"
                  value={dashboard.data.health.unassigned}
                  onClick={() => openHealthDetail("unassigned")}
                />
                <HealthItem
                  label="Follow-ups vencidos"
                  value={dashboard.data.health.followUpsOverdue}
                  onClick={() => openHealthDetail("follow_ups_overdue")}
                />
                <HealthItem
                  label="Aguardando resposta"
                  value={dashboard.data.health.awaitingResponse}
                  onClick={() => openHealthDetail("awaiting_response")}
                />
                <HealthItem
                  label="Follow-ups residuais"
                  title="Follow-ups residuais em Leads terminais"
                  value={dashboard.data.health.terminalResidualFollowUps}
                  onClick={() =>
                    openHealthDetail("terminal_residual_follow_ups")
                  }
                />
                {dashboard.data.health.governancePending > 0 && (
                  <HealthItem
                    label="Pendências de governança"
                    value={dashboard.data.health.governancePending}
                    onClick={() => openHealthDetail("governance_pending")}
                  />
                )}
              </CardContent>
            </Card>
          </section>

          <section className="v2-dashboard-journey-shell" aria-labelledby="dashboard-journey-title">
            <Card className="v2-section-card v2-dashboard-journey">
              <CardHeader>
                <CardTitle id="dashboard-journey-title">Jornada da base</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Da entrada ao resultado entre os Leads recebidos no período.
                </p>
              </CardHeader>
              <CardContent className="v2-dashboard-journey-content">
                <JourneyStage label="Recebidos" value={dashboard.data.funnel.received} detail="100% da base" />
                <JourneyArrow />
                <JourneyStage
                  label="Recebidos trabalhados"
                  value={dashboard.data.funnel.worked}
                  detail={`${percent(rate(dashboard.data.funnel.worked, dashboard.data.funnel.received))} dos recebidos`}
                />
                <JourneyArrow />
                <JourneyStage
                  label="Contato efetivo"
                  value={dashboard.data.funnel.contacted}
                  detail={`${percent(rate(dashboard.data.funnel.contacted, dashboard.data.funnel.worked))} dos trabalhados`}
                />
                <JourneyArrow />
                <JourneyStage
                  label="Convertidos"
                  value={dashboard.data.funnel.converted}
                  detail={`${percent(rate(dashboard.data.funnel.converted, dashboard.data.funnel.contacted))} dos contatos`}
                />
              </CardContent>
              <div className="v2-dashboard-journey-note">
                <strong>{number(dashboard.data.funnel.attempted)}</strong> Leads com tentativa · <strong>{number(dashboard.data.cards.attempts)}</strong> tentativas realizadas
              </div>
            </Card>
          </section>

          <section className="v2-dashboard-overview-shell">
            <Card className="v2-section-card v2-dashboard-overview-panel">
              <CardHeader className="v2-dashboard-overview-heading">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Visão operacional</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Atividade registrada no período, por campanha ou PDV.
                    </p>
                  </div>
                  {overviewTab === "campaigns" && (
                    <Link
                      href="/v2/campaigns"
                      className="text-xs font-semibold text-brand-secondary hover:underline"
                    >
                      Ver todas
                    </Link>
                  )}
                </div>
              </CardHeader>
              <div
                className="v2-dashboard-overview-tabs"
                role="tablist"
                aria-label="Visão operacional"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={overviewTab === "campaigns"}
                  className={overviewTab === "campaigns" ? "is-active" : ""}
                  onClick={() => setOverviewTab("campaigns")}
                >
                  Campanhas
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={overviewTab === "pdvs"}
                  className={overviewTab === "pdvs" ? "is-active" : ""}
                  onClick={() => setOverviewTab("pdvs")}
                >
                  PDVs
                </button>
              </div>
              <div className="v2-dashboard-overview-table">
                <Overview
                  rows={
                    overviewTab === "campaigns"
                      ? dashboard.data.campaigns.slice(0, 5)
                      : dashboard.data.pdvs.slice(0, 5)
                  }
                  campaign={overviewTab === "campaigns"}
                />
              </div>
            </Card>
          </section>
          {dashboard.data.health.evidenceCoverage.eligible > 0 ||
          dashboard.data.health.evidenceCoverage.attemptCoverage.eligible > 0 ? (
            <section className="v2-dashboard-quality-shell" aria-labelledby="dashboard-quality-title">
              <Card className="v2-section-card v2-dashboard-quality">
                <CardHeader>
                  <CardTitle id="dashboard-quality-title">Qualidade dos registros</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Cobertura de evidências elegíveis no período. Ausência opcional não é pendência.
                  </p>
                </CardHeader>
                <CardContent className="v2-dashboard-quality-list">
                  <HealthSummaryItem
                    label="Evidências em contatos"
                    title="Cobertura de evidências nas tratativas efetivas"
                    value={percent(dashboard.data.health.evidenceCoverage.coverage)}
                    detail={`${number(dashboard.data.health.evidenceCoverage.withEvidence)} de ${number(dashboard.data.health.evidenceCoverage.eligible)} elegíveis`}
                    onClick={() => openHealthDetail("evidence_eligible")}
                  />
                  <HealthSummaryItem
                    label="Evidências nas tentativas"
                    title="Cobertura de evidências nas tentativas de contato"
                    value={percent(
                      dashboard.data.health.evidenceCoverage.attemptCoverage
                        .coverage
                    )}
                    detail={`${number(dashboard.data.health.evidenceCoverage.attemptCoverage.withEvidence)} de ${number(dashboard.data.health.evidenceCoverage.attemptCoverage.eligible)} elegíveis`}
                    onClick={() => openHealthDetail("attempt_evidence_eligible")}
                  />
                </CardContent>
              </Card>
            </section>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Período:{" "}
            {new Date(dashboard.data.period.start).toLocaleString("pt-BR")} até{" "}
            {new Date(dashboard.data.period.end).toLocaleString("pt-BR")} ·{" "}
            {dashboard.data.period.timeZone}
          </p>
          <Drawer
            open={healthDetail !== null}
            onOpenChange={open => !open && setHealthDetail(null)}
          >
            <DrawerContent className="max-h-[90dvh]">
              <DrawerHeader>
                <DrawerTitle>
                  {healthDetail
                    ? healthDetailLabels[healthDetail]
                    : "Detalhamento"}
                </DrawerTitle>
                <DrawerDescription>
                  Registros que compõem o indicador, no mesmo escopo e filtros
                  do Dashboard.
                </DrawerDescription>
              </DrawerHeader>
              <div className="min-h-0 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {healthDetails.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Carregando detalhamento…
                  </p>
                ) : healthDetails.isError ? (
                  <p className="p-4 text-sm text-destructive">
                    Não foi possível carregar o detalhamento.
                  </p>
                ) : healthDetails.data?.rows.length ? (
                  <div className="space-y-2">
                    {healthDetails.data.rows.map(row => (
                      <article
                        key={row.id}
                        className="rounded-md border p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{row.lead}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.campaign} · {row.pdv} · {row.responsible}
                            </p>
                          </div>
                          <Link
                            href={buildV2Path(`/v2/leads/${row.leadId}`, {
                              from: currentV2Path(),
                            })}
                          >
                            <Button size="sm" variant="outline">
                              Abrir Lead
                            </Button>
                          </Link>
                        </div>
                        {row.detail && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {row.detail}
                          </p>
                        )}
                        {row.occurredAt && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(row.occurredAt).toLocaleString("pt-BR")}
                          </p>
                        )}
                        {row.documentaryStatus && (
                          <Badge
                            className="mt-2"
                            variant={
                              row.documentaryStatus === "Pendente"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {row.documentaryStatus}
                            {row.evidenceCount != null
                              ? ` · ${row.evidenceCount} evidência(s)`
                              : ""}
                          </Badge>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">
                    Nenhum registro neste indicador.
                  </p>
                )}
                {healthDetails.data && healthTotalPages > 1 && (
                  <div className="flex items-center justify-between gap-3 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={healthPage <= 1}
                      onClick={() =>
                        setHealthPage(page => Math.max(1, page - 1))
                      }
                    >
                      Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Página {healthPage} de {healthTotalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={healthPage >= healthTotalPages}
                      onClick={() =>
                        setHealthPage(page =>
                          Math.min(healthTotalPages, page + 1)
                        )
                      }
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </div>
            </DrawerContent>
          </Drawer>
        </>
      ) : null}
    </main>
  );
}

function HealthItem({
  label,
  title,
  value,
  detail,
  priority = false,
  onClick,
}: {
  label: string;
  title?: string;
  value: number;
  detail?: string;
  priority?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`v2-health-item ${priority ? "v2-health-item--priority" : ""} block w-full rounded-md border p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <p className="text-sm">{label}</p>
      <strong>{number(value)}</strong>
      {detail ? <span>{detail}</span> : null}
    </button>
  );
}

function HealthSummaryItem({
  label,
  title,
  value,
  detail,
  onClick,
}: {
  label: string;
  title: string;
  value: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="v2-health-summary-item block w-full rounded-md border text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </button>
  );
}

function JourneyStage({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="v2-dashboard-journey-stage">
      <p>{label}</p>
      <strong>{number(value)}</strong>
      <span>{detail}</span>
    </article>
  );
}

function JourneyArrow() {
  return <span className="v2-dashboard-journey-arrow" aria-hidden="true">→</span>;
}

type OverviewRow = {
  id: number;
  name: string;
  leads: number;
  leadsWorked: number;
  workCoverage: number | null;
  attempts: number;
  leadsWithAttempt: number;
  effectiveContacts: number;
  effectiveContactRate: number | null;
  interested: number;
  conversions: number;
  conversionRate: number | null;
  followUpsOverdue: number;
};

function Overview({
  rows,
  campaign = false,
}: {
  rows: OverviewRow[];
  campaign?: boolean;
}) {
  return (
    <div className="v2-dashboard-overview-content">
      {rows.length ? (
          <>
            <div className="grid gap-3 md:hidden">
              {rows.map(row => (
                <article
                  key={row.id}
                  className="v2-mobile-record rounded-lg border p-3"
                >
                  <div className="flex justify-between gap-3">
                    <strong>
                      {campaign ? (
                        <Link
                          href={buildV2Path(`/v2/campaigns/${row.id}`, {
                            from: currentV2Path(),
                          })}
                          className="hover:underline"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        row.name
                      )}
                    </strong>
                    <Badge
                      variant={
                        row.followUpsOverdue ? "destructive" : "secondary"
                      }
                    >
                      {row.followUpsOverdue
                        ? `${row.followUpsOverdue} vencidos`
                        : "Sem vencidos"}
                    </Badge>
                  </div>
                  <div className="v2-mobile-detail-grid mt-3 text-sm text-muted-foreground">
                    <span>
                      Cobertura{" "}
                      <strong className="text-foreground">
                        {percent(row.workCoverage)}
                      </strong>
                    </span>
                    <span>
                      Com atividade{" "}
                      <strong className="text-foreground">
                        {number(row.leadsWorked)}
                      </strong>
                    </span>
                    <span>
                      Tentativas{" "}
                      <strong className="text-foreground">
                        {number(row.attempts)}
                      </strong>
                    </span>
                    <span>
                      Leads c/ tentativa{" "}
                      <strong className="text-foreground">
                        {number(row.leadsWithAttempt)}
                      </strong>
                    </span>
                    <span>
                      Contatos{" "}
                      <strong className="text-foreground">
                        {number(row.effectiveContacts)}
                      </strong>
                    </span>
                    <span>
                      Interessados{" "}
                      <strong className="text-foreground">
                        {number(row.interested)}
                      </strong>
                    </span>
                    <span>
                      Conversões{" "}
                      <strong className="text-foreground">
                        {number(row.conversions)}
                      </strong>
                    </span>
                  </div>
                </article>
              ))}
            </div>
            <div className="v2-table-scroll hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">{campaign ? "Campanha" : "PDV"}</th>
                    <th className="p-2">Base atual</th>
                    <th className="p-2">Cobertura</th>
                    <th
                      className="p-2"
                      title="Leads distintos com tentativa ou contato efetivo registrado no período."
                    >
                      Com atividade
                    </th>
                    <th className="p-2">Tentativas</th>
                    <th className="p-2">Leads c/ tentativa</th>
                    <th className="p-2">Contatos</th>
                    <th className="p-2">Tx. contato</th>
                    <th className="p-2">Interessados</th>
                    <th className="p-2">Conversões</th>
                    <th className="p-2">Taxa</th>
                    <th className="p-2">Vencidos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-2 font-medium">
                        {campaign ? (
                          <Link
                            href={buildV2Path(`/v2/campaigns/${row.id}`, {
                              from: currentV2Path(),
                            })}
                          >
                            <span className="hover:underline">{row.name}</span>
                          </Link>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className="p-2">{number(row.leads)}</td>
                      <td className="p-2">{percent(row.workCoverage)}</td>
                      <td className="p-2">{number(row.leadsWorked)}</td>
                      <td className="p-2">{number(row.attempts)}</td>
                      <td className="p-2">{number(row.leadsWithAttempt)}</td>
                      <td className="p-2">{number(row.effectiveContacts)}</td>
                      <td className="p-2">
                        {percent(row.effectiveContactRate)}
                      </td>
                      <td className="p-2">{number(row.interested)}</td>
                      <td className="p-2">{number(row.conversions)}</td>
                      <td className="p-2">{percent(row.conversionRate)}</td>
                      <td className="p-2">
                        {row.followUpsOverdue ? (
                          <Badge variant="destructive">
                            {row.followUpsOverdue}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
      ) : (
        <p className="p-5 text-center text-sm text-muted-foreground">
          Sem dados no período e escopo selecionados.
        </p>
      )}
    </div>
  );
}
