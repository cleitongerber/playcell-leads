import {
  AnalyticsFilters,
  defaultAnalyticsFilters,
  type AnalyticsUiFilters,
} from "@/components/v2/AnalyticsFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { v2trpc } from "@/lib/v2trpc";
import { useState } from "react";
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
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
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
}: {
  title: string;
  value: string;
  comparison?: number | null;
  href?: string;
  destructive?: boolean;
}) {
  const content = (
    <Card className={destructive ? "border-destructive/60" : ""}>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
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
  const [filters, setFilters] = useState<AnalyticsUiFilters>(
    defaultAnalyticsFilters
  );
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const dashboard = v2trpc.analytics.dashboard.useQuery(filters, {
    enabled: canQuery,
  });

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Gestão
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Dashboard operacional</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Leitura atual da operação. Estoques são posições de agora; fluxos
            respeitam o período selecionado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/v2/productivity">
            <Button variant="outline">Produtividade</Button>
          </Link>
          <Link href="/v2/reports">
            <Button variant="outline">Relatórios</Button>
          </Link>
          <Link href="/v2/admin">
            <Button variant="outline">Administração</Button>
          </Link>
        </div>
      </header>

      <AnalyticsFilters value={filters} onChange={setFilters} />

      {!canQuery ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas para consultar o período personalizado.
          </CardContent>
        </Card>
      ) : dashboard.isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Calculando indicadores no banco V2…
          </CardContent>
        </Card>
      ) : dashboard.isError ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-destructive">
            Não foi possível carregar os indicadores autorizados.
          </CardContent>
        </Card>
      ) : dashboard.data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              title="Leads recebidos"
              value={number(dashboard.data.cards.leadsReceived)}
              comparison={dashboard.data.comparisons.leadsReceived}
            />
            <MetricCard
              title="Leads disponíveis"
              value={number(dashboard.data.cards.leadsAvailable)}
              href="/v2/leads?view=available"
            />
            <MetricCard
              title="Leads em carteira"
              value={number(dashboard.data.cards.leadsInPortfolio)}
              href="/v2/leads?view=mine"
            />
            <MetricCard
              title="Leads tratados"
              value={number(dashboard.data.cards.leadsTreated)}
              comparison={dashboard.data.comparisons.leadsTreated}
            />
            <MetricCard
              title="Leads concluídos"
              value={number(dashboard.data.cards.leadsCompleted)}
              comparison={dashboard.data.comparisons.leadsCompleted}
            />
            <MetricCard
              title="Taxa de conversão"
              value={percent(dashboard.data.cards.conversionRate)}
              comparison={dashboard.data.comparisons.conversionRate}
            />
            <MetricCard
              title="Follow-ups vencidos"
              value={number(dashboard.data.cards.followUpsOverdue)}
              destructive
              href="/v2/follow-ups?view=overdue"
            />
            <MetricCard
              title="Follow-ups para hoje"
              value={number(dashboard.data.cards.followUpsToday)}
              href="/v2/follow-ups?view=today"
            />
            <MetricCard
              title="Tempo médio até 1º contato"
              value={duration(dashboard.data.cards.firstContactAverageSeconds)}
            />
            <MetricCard
              title="Sem primeiro contato"
              value={number(dashboard.data.cards.leadsWithoutFirstContact)}
              href="/v2/leads?view=all"
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Funil do período</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Coorte de Leads recebidos até o fim de{" "}
                  {dashboard.data.period.label.toLowerCase()}.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  ["Recebidos", dashboard.data.funnel.received],
                  ["Atribuídos", dashboard.data.funnel.assigned],
                  ["Tratados", dashboard.data.funnel.treated],
                  ["Concluídos", dashboard.data.funnel.completed],
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
              <CardContent className="space-y-3">
                <Link
                  href="/v2/leads?view=available"
                  className="block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Sem responsável</p>
                  <strong>{number(dashboard.data.health.unassigned)}</strong>
                </Link>
                <Link
                  href="/v2/leads?view=all"
                  className="block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Atribuídos sem primeiro contato</p>
                  <strong>
                    {number(dashboard.data.health.assignedWithoutFirstContact)}
                  </strong>
                </Link>
                <Link
                  href="/v2/follow-ups?view=overdue"
                  className="block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Follow-ups vencidos</p>
                  <strong>
                    {number(dashboard.data.health.followUpsOverdue)}
                  </strong>
                </Link>
                <Link
                  href="/v2/leads?view=all"
                  className="block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">
                    Sem atividade há{" "}
                    {Math.max(
                      1,
                      Math.ceil(dashboard.data.health.staleLeadMinutes / 1440)
                    )}{" "}
                    dia(s)
                  </p>
                  <strong>{number(dashboard.data.health.staleLeads)}</strong>
                </Link>
                <Link
                  href="/v2/governance"
                  className="block rounded-md border p-3 hover:bg-muted/40"
                >
                  <p className="text-sm">Pendências de governança</p>
                  <strong>
                    {number(dashboard.data.health.governancePending)}
                  </strong>
                </Link>
              </CardContent>
            </Card>
          </section>

          <OverviewTable
            title="Campanhas"
            rows={dashboard.data.campaigns}
            campaign
          />
          <OverviewTable title="PDVs" rows={dashboard.data.pdvs} />
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

function OverviewTable({
  title,
  rows,
  campaign = false,
}: {
  title: string;
  rows: Array<{
    id: number;
    name: string;
    leads: number;
    treated: number;
    completed: number;
    conversions: number;
    conversionRate: number | null;
    followUpsOverdue: number;
    firstContactAverageSeconds: number | null;
  }>;
  campaign?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length ? (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">{title.slice(0, -1)}</th>
                <th className="p-2">Leads</th>
                <th className="p-2">Tratados</th>
                <th className="p-2">Concluídos</th>
                <th className="p-2">Conversões</th>
                <th className="p-2">Taxa</th>
                <th className="p-2">Vencidos</th>
                <th className="p-2">1º contato</th>
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
                  <td className="p-2">{number(row.treated)}</td>
                  <td className="p-2">{number(row.completed)}</td>
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
                  <td className="p-2">
                    {duration(row.firstContactAverageSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-5 text-center text-sm text-muted-foreground">
            Sem dados no período e escopo selecionados.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
