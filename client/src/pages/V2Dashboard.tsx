import {
  AnalyticsFilters,
  useAnalyticsUrlFilters,
} from "@/components/v2/AnalyticsFilters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { buildV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Inbox,
  MessageSquareText,
  PhoneCall,
  Send,
  Timer,
  TrendingUp,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";

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
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const dashboard = v2trpc.analytics.dashboard.useQuery(filters, {
    enabled: canQuery,
  });
  const leadPath = (
    view: "available" | "mine" | "all",
    extra: Record<string, string | number | undefined> = {}
  ) =>
    buildV2Path("/v2/leads", {
      view,
      campaignId: filters.campaignId,
      pdvId: filters.pdvId,
      ...extra,
    });
  const followUpPath = (view: "overdue" | "today") =>
    buildV2Path("/v2/follow-ups", {
      view,
      campaignId: filters.campaignId,
      pdvId: filters.pdvId,
      ownerMembershipId: filters.sellerMembershipId,
    });

  return (
    <main className="v2-page space-y-6">
      <V2PageHeader
        eyebrow="Gestão"
        title="Dashboard operacional"
        description="Fatos operacionais no período selecionado e pendências atuais no seu escopo."
      />
      <AnalyticsFilters value={filters} onChange={setFilters} />
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
          <section className="v2-metric-grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
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
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Funil do período</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Coorte de Leads recebidos no período, acompanhada até o fim
                  dele.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
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
                    <div key={String(label)}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{label}</span>
                        <strong>{number(count)}</strong>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded bg-primary"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Saúde da operação</CardTitle>
              </CardHeader>
              <CardContent className="v2-health-list space-y-3">
                <Link
                  href={leadPath("available")}
                  className="v2-health-item block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Sem responsável</p>
                  <strong>{number(dashboard.data.health.unassigned)}</strong>
                </Link>
                <Link
                  href={leadPath("all", {
                    assignment: "assigned",
                    firstContact: "missing",
                    assignedMembershipId: filters.sellerMembershipId,
                  })}
                  className="v2-health-item block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Atribuídos sem trabalho</p>
                  <strong>
                    {number(dashboard.data.health.assignedWithoutWork)}
                  </strong>
                </Link>
                <Link
                  href={followUpPath("overdue")}
                  className="v2-health-item block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Follow-ups vencidos</p>
                  <strong>
                    {number(dashboard.data.health.followUpsOverdue)}
                  </strong>
                </Link>
                <div className="v2-health-item rounded-md border p-3">
                  <p className="text-sm">Pendências documentais</p>
                  <strong>
                    {number(dashboard.data.health.governancePending)}
                  </strong>
                </div>
                <div className="v2-health-item rounded-md border p-3">
                  <p className="text-sm">Aguardando resposta</p>
                  <strong>
                    {number(dashboard.data.health.awaitingResponse)}
                  </strong>
                </div>
                <div className="v2-health-item rounded-md border p-3">
                  <p className="text-sm">
                    Follow-ups residuais em Leads terminais
                  </p>
                  <strong>
                    {number(dashboard.data.health.terminalResidualFollowUps)}
                  </strong>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="v2-metric-grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
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

          <Overview
            title="Campanhas"
            rows={dashboard.data.campaigns}
            campaign
          />
          <Overview title="PDVs" rows={dashboard.data.pdvs} />
          <p className="text-xs text-muted-foreground">
            Período:{" "}
            {new Date(dashboard.data.period.start).toLocaleString("pt-BR")} até{" "}
            {new Date(dashboard.data.period.end).toLocaleString("pt-BR")} ·{" "}
            {dashboard.data.period.timeZone}
          </p>
        </>
      ) : null}
    </main>
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
    <Card>
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
                          href={`/v2/campaigns/${row.id}`}
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
                          <Link href={`/v2/campaigns/${row.id}`}>
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
