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
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}

export default function V2Productivity() {
  const [filters, setFilters] = useState<AnalyticsUiFilters>(
    defaultAnalyticsFilters
  );
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const productivity = v2trpc.analytics.productivity.useQuery(filters, {
    enabled: canQuery,
  });
  const access = v2trpc.access.context.useQuery();

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Gestão
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            Produtividade operacional
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Contatos, disciplina de follow-up e governança são calculados por
            vendedor a partir das entidades reais.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/v2/dashboard">
            <Button variant="outline">Dashboard</Button>
          </Link>
          <Link href="/v2/reports">
            <Button variant="outline">Relatórios</Button>
          </Link>
        </div>
      </header>

      <AnalyticsFilters value={filters} onChange={setFilters} />

      {!canQuery ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas do período personalizado.
          </CardContent>
        </Card>
      ) : productivity.isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Calculando produtividade no banco V2…
          </CardContent>
        </Card>
      ) : productivity.isError ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-destructive">
            Não foi possível carregar a produtividade autorizada.
          </CardContent>
        </Card>
      ) : productivity.data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Summary
              title="Vendedores visíveis"
              value={number(productivity.data.totals.sellers)}
            />
            <Summary
              title="Contatos realizados"
              value={number(productivity.data.totals.contacts)}
            />
            <Summary
              title="Leads tratados"
              value={number(productivity.data.totals.treated)}
            />
            <Summary
              title="Follow-ups vencidos"
              value={number(productivity.data.totals.followUpsOverdue)}
              destructive
            />
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Equipe no período</CardTitle>
              <p className="text-sm text-muted-foreground">
                Clique em um vendedor para restringir a própria visão. Taxa de
                tratamento: Leads com contato no período ÷ Leads atribuídos no
                período.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {productivity.data.sellers.length ? (
                <table className="w-full min-w-[1500px] text-sm">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">Vendedor</th>
                      <th className="p-2">PDVs</th>
                      <th className="p-2">Carteira</th>
                      <th className="p-2">Atribuídos</th>
                      <th className="p-2">Tratados</th>
                      <th className="p-2">Taxa</th>
                      <th className="p-2">Contatos</th>
                      <th className="p-2">Concluídos</th>
                      <th className="p-2">Conversões</th>
                      <th className="p-2">FU criados</th>
                      <th className="p-2">FU concluídos</th>
                      <th className="p-2">FU vencidos</th>
                      <th className="p-2">Taxa FU</th>
                      <th className="p-2">1º contato</th>
                      <th className="p-2">Sem 1º contato</th>
                      <th className="p-2">Governança</th>
                      <th className="p-2">Última atividade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productivity.data.sellers.map(row => (
                      <tr
                        key={row.membershipId}
                        className="border-b last:border-0 align-top"
                      >
                        <td className="p-2 font-medium">
                          <button
                            className="text-left hover:underline"
                            onClick={() =>
                              access.data?.role !== "seller" &&
                              setFilters({
                                ...filters,
                                sellerMembershipId: row.membershipId,
                              })
                            }
                          >
                            {row.name}
                          </button>
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {row.pdvNames.join(", ")}
                        </td>
                        <td className="p-2">{number(row.leadsInPortfolio)}</td>
                        <td className="p-2">
                          {number(row.leadsAssignedInPeriod)}
                        </td>
                        <td className="p-2">{number(row.leadsTreated)}</td>
                        <td className="p-2">{percent(row.treatmentRate)}</td>
                        <td className="p-2">{number(row.contacts)}</td>
                        <td className="p-2">{number(row.leadsCompleted)}</td>
                        <td className="p-2">{number(row.conversions)}</td>
                        <td className="p-2">{number(row.followUpsCreated)}</td>
                        <td className="p-2">
                          {number(row.followUpsCompleted)}
                        </td>
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
                          {percent(row.followUpCompletionRate)}
                        </td>
                        <td className="p-2">
                          {duration(row.firstContactAverageSeconds)}
                        </td>
                        <td className="p-2">
                          {number(row.leadsWithoutFirstContact)}
                        </td>
                        <td className="p-2">
                          {row.governanceComplete} completa(s) ·{" "}
                          {row.governancePending} pendente(s)
                        </td>
                        <td className="p-2">
                          {row.lastActivityAt
                            ? new Date(row.lastActivityAt).toLocaleString(
                                "pt-BR"
                              )
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum vendedor ativo no escopo selecionado.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  );
}

function Summary({
  title,
  value,
  destructive = false,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <Card className={destructive ? "border-destructive/60" : ""}>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
