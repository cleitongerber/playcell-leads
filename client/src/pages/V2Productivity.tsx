import {
  AnalyticsFilters,
  useAnalyticsUrlFilters,
} from "@/components/v2/AnalyticsFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type SellerRow = {
  membershipId: number;
  name: string;
  pdvNames: string[];
  leadsInPortfolio: number;
  leadsAssignedInPeriod: number;
  leadsWorked: number;
  attempts: number;
  leadsWithAttempt: number;
  effectiveContacts: number;
  leadsWithEffectiveContact: number;
  interested: number;
  conversions: number;
  followUpsCreated: number;
  followUpsCompleted: number;
  followUpsOverdue: number;
  followUpsPending: number;
  followUpsFromAttempts: number;
  followUpsFromTreatments: number;
  followUpsIndependent: number;
  firstAttemptAverageSeconds: number | null;
  firstEffectiveContactAverageSeconds: number | null;
  leadsWithoutWork: number;
  governanceComplete: number;
  governancePending: number;
  lastActivityAt: Date | null;
  effectiveContactRate: number | null;
  followUpCompletionRate: number | null;
};

function SellerCard({
  row,
  expanded,
  onToggle,
  onSelect,
}: {
  row: SellerRow;
  expanded: boolean;
  onToggle: () => void;
  onSelect?: () => void;
}) {
  const detailsId = `productivity-seller-${row.membershipId}`;
  return (
    <article className="v2-mobile-record rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          className="min-w-0 text-left"
          onClick={onSelect}
          disabled={!onSelect}
        >
          <p className="font-semibold">{row.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.pdvNames.join(", ")}
          </p>
        </button>
        {row.followUpsOverdue ? (
          <Badge variant="destructive">{row.followUpsOverdue} vencido(s)</Badge>
        ) : null}
      </div>
      <div className="v2-mobile-detail-grid mt-3 text-sm text-muted-foreground">
        <span>
          Carteira{" "}
          <strong className="text-foreground">
            {number(row.leadsInPortfolio)}
          </strong>
        </span>
        <span>
          Trabalhados{" "}
          <strong className="text-foreground">{number(row.leadsWorked)}</strong>
        </span>
        <span>
          Contatos{" "}
          <strong className="text-foreground">
            {number(row.effectiveContacts)}
          </strong>
        </span>
        <span>
          Conversões{" "}
          <strong className="text-foreground">{number(row.conversions)}</strong>
        </span>
        <span>
          Taxa contato{" "}
          <strong className="text-foreground">
            {percent(row.effectiveContactRate)}
          </strong>
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="v2-mobile-disclosure-trigger mt-2 w-full justify-between px-2"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        {expanded ? "Ocultar detalhes" : "Ver detalhes"}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </Button>
      {expanded && (
        <div
          id={detailsId}
          className="v2-mobile-detail-grid border-t pt-3 text-sm text-muted-foreground"
        >
          <span>
            Tentativas{" "}
            <strong className="text-foreground">{number(row.attempts)}</strong>
          </span>
          <span>
            Com tentativa{" "}
            <strong className="text-foreground">
              {number(row.leadsWithAttempt)}
            </strong>
          </span>
          <span>
            Interessados{" "}
            <strong className="text-foreground">
              {number(row.interested)}
            </strong>
          </span>
          <span>
            FU criados{" "}
            <strong className="text-foreground">
              {number(row.followUpsCreated)}
            </strong>
          </span>
          <span>
            FU concluídos{" "}
            <strong className="text-foreground">
              {number(row.followUpsCompleted)}
            </strong>
          </span>
          <span>
            Taxa FU{" "}
            <strong className="text-foreground">
              {percent(row.followUpCompletionRate)}
            </strong>
          </span>
          <span>
            1ª tentativa{" "}
            <strong className="text-foreground">
              {duration(row.firstAttemptAverageSeconds)}
            </strong>
          </span>
          <span>
            1º contato{" "}
            <strong className="text-foreground">
              {duration(row.firstEffectiveContactAverageSeconds)}
            </strong>
          </span>
          <span>
            Governança{" "}
            <strong className="text-foreground">
              {row.governanceComplete} completa(s) · {row.governancePending}{" "}
              pendente(s)
            </strong>
          </span>
        </div>
      )}
    </article>
  );
}

export default function V2Productivity() {
  const [filters, setFilters] = useAnalyticsUrlFilters();
  const [expandedSellerIds, setExpandedSellerIds] = useState<number[]>([]);
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const productivity = v2trpc.analytics.productivity.useQuery(filters, {
    enabled: canQuery,
  });
  const access = v2trpc.access.context.useQuery();
  return (
    <main className="v2-page space-y-6">
      <V2PageHeader
        eyebrow="Gestão"
        title="Produtividade"
        description="Esforço, contato efetivo, disciplina de follow-up e resultado por vendedor."
      />
      <AnalyticsFilters value={filters} onChange={setFilters} />
      {!canQuery ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas para consultar o período personalizado.
          </CardContent>
        </Card>
      ) : productivity.isLoading ? (
        <V2LoadingState label="Calculando produtividade" />
      ) : productivity.isError ? (
        <V2ErrorState
          message="Não foi possível carregar a produtividade no seu escopo."
          onRetry={() => productivity.refetch()}
        />
      ) : productivity.data ? (
        <>
          <section className="v2-metric-grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            <Summary
              title="Vendedores visíveis"
              value={number(productivity.data.totals.sellers)}
            />
            <Summary
              title="Leads trabalhados"
              value={number(productivity.data.totals.worked)}
            />
            <Summary
              title="Tentativas"
              value={number(productivity.data.totals.attempts)}
            />
            <Summary
              title="Contatos efetivos"
              value={number(productivity.data.totals.effectiveContacts)}
            />
            <Summary
              title="Conversões"
              value={number(productivity.data.totals.conversions)}
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
                Trabalho é tentativa ou tratativa efetiva. A taxa de contato
                efetivo é Leads com contato efetivo ÷ Leads trabalhados.
              </p>
            </CardHeader>
            <CardContent>
              {productivity.data.sellers.length ? (
                <>
                  <div className="grid gap-3 md:hidden">
                    {productivity.data.sellers.map(row => (
                      <SellerCard
                        key={row.membershipId}
                        row={row}
                        expanded={expandedSellerIds.includes(row.membershipId)}
                        onToggle={() =>
                          setExpandedSellerIds(current =>
                            current.includes(row.membershipId)
                              ? current.filter(id => id !== row.membershipId)
                              : [...current, row.membershipId]
                          )
                        }
                        onSelect={
                          access.data?.role !== "seller"
                            ? () =>
                                setFilters({
                                  ...filters,
                                  sellerMembershipId: row.membershipId,
                                })
                            : undefined
                        }
                      />
                    ))}
                  </div>
                  <div className="v2-table-scroll hidden md:block">
                    <table className="w-full text-sm">
                      <thead className="border-b text-left text-muted-foreground">
                        <tr>
                          <th className="p-2">Vendedor</th>
                          <th className="p-2">PDVs</th>
                          <th className="p-2">Carteira</th>
                          <th className="p-2">Trabalhados</th>
                          <th className="p-2">Tentativas</th>
                          <th className="p-2">Contatos efetivos</th>
                          <th className="p-2">Taxa contato</th>
                          <th className="p-2">Interessados</th>
                          <th className="p-2">Conversões</th>
                          <th className="p-2">FU criados</th>
                          <th className="p-2">FU concluídos</th>
                          <th className="p-2">FU vencidos</th>
                          <th className="p-2">1ª tentativa</th>
                          <th className="p-2">1º contato</th>
                          <th className="p-2">Governança</th>
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
                                className="text-left hover:underline disabled:no-underline"
                                disabled={access.data?.role === "seller"}
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
                            <td className="p-2">
                              {number(row.leadsInPortfolio)}
                            </td>
                            <td className="p-2">{number(row.leadsWorked)}</td>
                            <td className="p-2">{number(row.attempts)}</td>
                            <td className="p-2">
                              {number(row.effectiveContacts)}
                            </td>
                            <td className="p-2">
                              {percent(row.effectiveContactRate)}
                            </td>
                            <td className="p-2">{number(row.interested)}</td>
                            <td className="p-2">{number(row.conversions)}</td>
                            <td className="p-2">
                              {number(row.followUpsCreated)}
                            </td>
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
                              {duration(row.firstAttemptAverageSeconds)}
                            </td>
                            <td className="p-2">
                              {duration(
                                row.firstEffectiveContactAverageSeconds
                              )}
                            </td>
                            <td className="p-2">
                              {row.governanceComplete} completa(s) ·{" "}
                              {row.governancePending} pendente(s)
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
    <Card className={`v2-metric-card ${destructive ? "border-danger/60" : ""}`}>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="v2-kpi-value mt-3 text-3xl">{value}</p>
      </CardContent>
    </Card>
  );
}
