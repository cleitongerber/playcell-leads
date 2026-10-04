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
  BellRing,
  CheckCircle2,
  Clock3,
  Inbox,
  Info,
  MessageSquareText,
  PhoneCall,
  Send,
  Timer,
  TrendingUp,
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
  return `${value >= 0 ? "+" : "−"}${formatted} vs. período anterior`;
}

function MetricCard({
  title,
  value,
  comparison,
  href,
  destructive = false,
  icon: Icon,
}: {
  title: string;
  value: string;
  comparison?: number | null;
  href?: string;
  destructive?: boolean;
  icon: LucideIcon;
}) {
  const content = (
    <Card className={`v2-metric-card ${destructive ? "border-danger/60" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">{title}</p>
          <span
            className={
              destructive
                ? "grid size-8 place-items-center rounded-lg bg-danger/10 text-danger"
                : "grid size-8 place-items-center rounded-lg bg-brand-accent/10 text-brand-secondary"
            }
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p className="v2-kpi-value mt-3 text-3xl">{value}</p>
        {comparison !== undefined && (
          <p className="mt-2 text-xs text-muted-foreground">
            {delta(comparison)}
          </p>
        )}
      </CardContent>
    </Card>
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
          <section>
            <p className="v2-dashboard-section-label">Indicadores do período</p>
            <div className="v2-metric-grid grid-cols-2 lg:grid-cols-3 v2-dashboard-primary-metrics">
            <MetricCard
              title="Leads recebidos"
              value={number(dashboard.data.cards.leadsReceived)}
              comparison={dashboard.data.comparisons.leadsReceived}
              icon={Inbox}
            />
            <MetricCard
              title="Leads trabalhados"
              value={number(dashboard.data.cards.leadsWorked)}
              comparison={dashboard.data.comparisons.leadsWorked}
              icon={MessageSquareText}
            />
            <MetricCard
              title="Tentativas"
              value={number(dashboard.data.cards.attempts)}
              comparison={dashboard.data.comparisons.attempts}
              icon={Send}
            />
            <MetricCard
              title="Contatos efetivos"
              value={number(dashboard.data.cards.effectiveContacts)}
              comparison={dashboard.data.comparisons.effectiveContacts}
              icon={PhoneCall}
            />
            <MetricCard
              title="Conversões"
              value={number(dashboard.data.cards.conversions)}
              comparison={dashboard.data.comparisons.conversions}
              icon={CheckCircle2}
            />
            <MetricCard
              title="Follow-ups vencidos"
              value={number(dashboard.data.cards.followUpsOverdue)}
              destructive
              href={followUpPath("overdue")}
              icon={BellRing}
            />
            </div>
          </section>

          <section className="v2-metric-grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 v2-dashboard-secondary-metrics">
            <MetricCard
              title="Taxa de contato efetivo"
              value={percent(dashboard.data.cards.effectiveContactRate)}
              comparison={dashboard.data.comparisons.effectiveContactRate}
              icon={TrendingUp}
            />
            <MetricCard
              title="Taxa de conversão"
              value={percent(dashboard.data.cards.conversionRate)}
              comparison={dashboard.data.comparisons.conversionRate}
              icon={TrendingUp}
            />
            <MetricCard
              title="Interessados"
              value={number(dashboard.data.cards.interested)}
              icon={CheckCircle2}
            />
            <MetricCard
              title="Tempo até 1ª tentativa"
              value={duration(dashboard.data.cards.firstAttemptAverageSeconds)}
              icon={Timer}
            />
            <MetricCard
              title="Tempo até 1º contato"
              value={duration(
                dashboard.data.cards.firstEffectiveContactAverageSeconds
              )}
              icon={Clock3}
            />
          </section>

          <section className="v2-dashboard-primary-layout">
            <Card className="v2-section-card v2-dashboard-funnel">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Funil da coorte do período
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Como interpretar o funil da coorte"
                        className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Info className="size-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-center">
                      Os indicadores acima mostram atividades realizadas no
                      período. Este funil acompanha somente a evolução dos
                      leads recebidos dentro do período selecionado.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Evolução dos leads recebidos no período selecionado.
                </p>
              </CardHeader>
              <CardContent className="v2-dashboard-funnel-content">
                {[
                  ["Recebidos", dashboard.data.funnel.received],
                  ["Trabalhados", dashboard.data.funnel.worked],
                  ["Com tentativa", dashboard.data.funnel.attempted],
                  ["Com contato efetivo", dashboard.data.funnel.contacted],
                  ["Interessados", dashboard.data.funnel.interested],
                  ["Convertidos", dashboard.data.funnel.converted],
                ].map(([label, raw]) => {
                  const count = Number(raw);
                  const width = dashboard.data.funnel.received
                    ? Math.min(
                        100,
                        (count / dashboard.data.funnel.received) * 100
                      )
                    : 0;
                  return (
                    <div
                      key={String(label)}
                      className="v2-dashboard-funnel-stage"
                    >
                      <span className="text-sm text-muted-foreground">
                        {label}
                      </span>
                      <div
                        role="img"
                        aria-label={`${label}: ${number(count)}`}
                        style={{ width: `${Math.max(width, count ? 8 : 0)}%` }}
                      />
                      <strong className="text-sm">{number(count)}</strong>
                      <span className="v2-dashboard-funnel-rate">
                        {percent(width / 100)}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="v2-section-card v2-dashboard-health">
              <CardHeader>
                <CardTitle>Saúde da operação</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Principais indicadores de pendência no seu escopo.
                </p>
              </CardHeader>
              <CardContent className="v2-health-list">
                <HealthItem
                  label="Sem responsável"
                  value={dashboard.data.health.unassigned}
                  onClick={() => openHealthDetail("unassigned")}
                />
                <HealthItem
                  label="Atribuídos sem trabalho"
                  value={dashboard.data.health.assignedWithoutWork}
                  onClick={() => openHealthDetail("assigned_without_work")}
                />
                <HealthItem
                  label="Pendências documentais"
                  value={dashboard.data.health.governancePending}
                  onClick={() => openHealthDetail("governance_pending")}
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
                <div className="v2-health-coverage">
                  <div className="v2-health-summary">
                    <div>
                      <p className="text-sm font-medium">
                        Cobertura de evidências
                      </p>
                    </div>
                    <strong className="text-lg">
                      {percent(dashboard.data.health.evidenceCoverage.coverage)}
                    </strong>
                  </div>
                  <div className="v2-health-inline-metrics">
                    <HealthMetricButton
                      label="Elegíveis"
                      value={dashboard.data.health.evidenceCoverage.eligible}
                      onClick={() => openHealthDetail("evidence_eligible")}
                    />
                    <HealthMetricButton
                      label="Com evidência"
                      value={
                        dashboard.data.health.evidenceCoverage.withEvidence
                      }
                      onClick={() => openHealthDetail("evidence_with")}
                    />
                    <HealthMetricButton
                      label="Sem evidência"
                      value={
                        dashboard.data.health.evidenceCoverage.withoutEvidence
                      }
                      onClick={() => openHealthDetail("evidence_without")}
                    />
                    <HealthMetricButton
                      label="Obrigatórias pendentes"
                      value={
                        dashboard.data.health.evidenceCoverage.requiredPending
                      }
                      onClick={() =>
                        openHealthDetail("evidence_required_pending")
                      }
                    />
                  </div>
                </div>
                <div className="v2-health-attempt-coverage">
                  <div className="v2-health-summary">
                    <div>
                      <p className="text-sm font-medium">
                        Tentativas de contato
                      </p>
                    </div>
                    <strong className="text-lg">
                      {percent(
                        dashboard.data.health.evidenceCoverage.attemptCoverage
                          .coverage
                      )}
                    </strong>
                  </div>
                  <div className="v2-health-inline-metrics">
                    <HealthMetricButton
                      label="Elegíveis"
                      value={
                        dashboard.data.health.evidenceCoverage.attemptCoverage
                          .eligible
                      }
                      onClick={() =>
                        openHealthDetail("attempt_evidence_eligible")
                      }
                    />
                    <HealthMetricButton
                      label="Com evidência"
                      value={
                        dashboard.data.health.evidenceCoverage.attemptCoverage
                          .withEvidence
                      }
                      onClick={() => openHealthDetail("attempt_evidence_with")}
                    />
                    <HealthMetricButton
                      label="Sem evidência"
                      value={
                        dashboard.data.health.evidenceCoverage.attemptCoverage
                          .withoutEvidence
                      }
                      onClick={() =>
                        openHealthDetail("attempt_evidence_without")
                      }
                    />
                    <HealthMetricButton
                      label="Obrigatórias pendentes"
                      value={
                        dashboard.data.health.evidenceCoverage.attemptCoverage
                          .requiredPending
                      }
                      onClick={() =>
                        openHealthDetail("attempt_evidence_required_pending")
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="v2-dashboard-overview-shell">
            <Card className="v2-section-card v2-dashboard-overview-panel">
              <CardHeader className="v2-dashboard-overview-heading">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Visão operacional</CardTitle>
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
                  title={overviewTab === "campaigns" ? "Campanhas" : "PDVs"}
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
  onClick,
}: {
  label: string;
  title?: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className="v2-health-item block w-full rounded-md border p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-sm">{label}</p>
      <strong>{number(value)}</strong>
    </button>
  );
}

function HealthMetricButton({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left hover:underline"
    >
      <span>{label}</span>
      <strong className="block text-foreground">{number(value)}</strong>
    </button>
  );
}

type OverviewRow = {
  id: number;
  name: string;
  leads: number;
  attempts: number;
  effectiveContacts: number;
  interested: number;
  conversions: number;
  conversionRate: number | null;
  followUpsOverdue: number;
};

function Overview({
  title,
  rows,
  campaign = false,
}: {
  title: string;
  rows: OverviewRow[];
  campaign?: boolean;
}) {
  return (
    <Card className="v2-section-card v2-dashboard-overview">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
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
                      Tentativas{" "}
                      <strong className="text-foreground">
                        {number(row.attempts)}
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
                    <th className="p-2">{title.slice(0, -1)}</th>
                    <th className="p-2">Base</th>
                    <th className="p-2">Tentativas</th>
                    <th className="p-2">Contatos</th>
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
                      <td className="p-2">{number(row.attempts)}</td>
                      <td className="p-2">{number(row.effectiveContacts)}</td>
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
      </CardContent>
    </Card>
  );
}
