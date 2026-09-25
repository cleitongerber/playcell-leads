import {
  AnalyticsFilters,
  defaultAnalyticsFilters,
  type AnalyticsUiFilters,
} from "@/components/v2/AnalyticsFilters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { v2trpc } from "@/lib/v2trpc";
import { useState } from "react";

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
    <main className="v2-page space-y-6">
      <V2PageHeader eyebrow="V2 / Gestão" title="Produtividade operacional" description="Contatos, disciplina de follow-up e governança são calculados por vendedor a partir das entidades reais." />

      <AnalyticsFilters value={filters} onChange={setFilters} />

      {!canQuery ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas do período personalizado.
          </CardContent>
        </Card>
      ) : productivity.isLoading ? (
        <V2LoadingState label="Calculando produtividade no banco V2" />
      ) : productivity.isError ? (
        <V2ErrorState message="Não foi possível carregar a produtividade autorizada." onRetry={() => productivity.refetch()} />
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
            <CardContent>
              {productivity.data.sellers.length ? (
                <>
                <div className="grid gap-3 md:hidden">
                  {productivity.data.sellers.map(row => (
                    <div key={row.membershipId} className="v2-mobile-record rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <button className="text-left font-medium hover:underline" onClick={() => access.data?.role !== "seller" && setFilters({ ...filters, sellerMembershipId: row.membershipId })}>{row.name}</button>
                        {row.followUpsOverdue ? <Badge variant="destructive">{row.followUpsOverdue} FU vencidos</Badge> : <Badge variant="secondary">Sem FU vencido</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{row.pdvNames.join(", ") || "Sem PDV"}</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
                        <span>Carteira <strong className="text-foreground">{number(row.leadsInPortfolio)}</strong></span><span>Atribuídos <strong className="text-foreground">{number(row.leadsAssignedInPeriod)}</strong></span>
                        <span>Tratados <strong className="text-foreground">{number(row.leadsTreated)}</strong></span><span>Taxa <strong className="text-foreground">{percent(row.treatmentRate)}</strong></span>
                        <span>Contatos <strong className="text-foreground">{number(row.contacts)}</strong></span><span>Conversões <strong className="text-foreground">{number(row.conversions)}</strong></span>
                        <span>FU concluídos <strong className="text-foreground">{number(row.followUpsCompleted)}</strong></span><span>Taxa FU <strong className="text-foreground">{percent(row.followUpCompletionRate)}</strong></span>
                        <span>1º contato <strong className="text-foreground">{duration(row.firstContactAverageSeconds)}</strong></span><span>Sem 1º contato <strong className="text-foreground">{number(row.leadsWithoutFirstContact)}</strong></span>
                      </div>
                      <p className="text-xs text-muted-foreground">Governança: {row.governanceComplete} completa(s) · {row.governancePending} pendente(s) · Última atividade: {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString("pt-BR") : "—"}</p>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
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
                </div>
                </>
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
