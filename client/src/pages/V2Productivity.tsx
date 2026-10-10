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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { buildV2Path, currentV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Link } from "wouter";
import { useMemo, useState, type ReactNode } from "react";

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
function ratio(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(
        value
      );
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

function compactPdvNames(names: string[]) {
  const concise = names.map(name => {
    const lastSegment = name.split(/\s+[—-]\s+/).at(-1) ?? name;
    return lastSegment.replace(/^PDV\s+/i, "");
  });
  return concise.length > 1 ? `${concise[0]} +${concise.length - 1}` : concise[0] ?? "—";
}

type SellerRow = {
  membershipId: number;
  name: string;
  pdvNames: string[];
  leadsInPortfolio: number;
  leadsWorked: number;
  attempts: number;
  leadsWithAttempt: number;
  effectiveContacts: number;
  leadsWithEffectiveContact: number;
  conversions: number;
  leadsConverted: number;
  followUpsOverdue: number;
  firstAttemptAverageSeconds: number | null;
  firstEffectiveContactAverageSeconds: number | null;
  effectiveContactRate: number | null;
  conversionRate: number | null;
  workCoverage: number | null;
  attemptsPerLead: number | null;
};
type RankingMetric =
  | "workCoverage"
  | "leadsWorked"
  | "leadsWithAttempt"
  | "attempts"
  | "attemptsPerLead"
  | "effectiveContacts"
  | "effectiveContactRate"
  | "conversions"
  | "conversionRate"
  | "firstAttemptAverageSeconds"
  | "firstEffectiveContactAverageSeconds"
  | "followUpsOverdue";
type DailyMetric =
  | "leadsWorked"
  | "leadsWithAttempt"
  | "attempts"
  | "effectiveContacts"
  | "conversions"
  | "followUpsCompleted";

const rankingOptions: Array<{ value: RankingMetric; label: string }> = [
  { value: "workCoverage", label: "Cobertura de trabalho" },
  { value: "leadsWorked", label: "Leads trabalhados" },
  { value: "leadsWithAttempt", label: "Leads com tentativa" },
  { value: "attempts", label: "Tentativas" },
  { value: "attemptsPerLead", label: "Tentativas médias por Lead" },
  { value: "effectiveContacts", label: "Contatos efetivos" },
  { value: "effectiveContactRate", label: "Taxa de contato" },
  { value: "conversions", label: "Conversões" },
  { value: "conversionRate", label: "Taxa de conversão" },
  { value: "firstAttemptAverageSeconds", label: "Tempo até 1ª tentativa" },
  {
    value: "firstEffectiveContactAverageSeconds",
    label: "Tempo até 1º contato",
  },
  { value: "followUpsOverdue", label: "Follow-ups vencidos" },
];
const dailyOptions: Array<{ value: DailyMetric; label: string }> = [
  { value: "leadsWorked", label: "Leads trabalhados" },
  { value: "leadsWithAttempt", label: "Leads com tentativa" },
  { value: "attempts", label: "Tentativas" },
  { value: "effectiveContacts", label: "Contatos efetivos" },
  { value: "conversions", label: "Conversões" },
  { value: "followUpsCompleted", label: "Follow-ups concluídos" },
];
const metricValue = (row: SellerRow, metric: RankingMetric) =>
  Number(row[metric] ?? 0);
function metricLabel(row: SellerRow, metric: RankingMetric) {
  const value = row[metric] as number | null;
  if (
    ["workCoverage", "effectiveContactRate", "conversionRate"].includes(metric)
  )
    return percent(value);
  if (metric === "attemptsPerLead") return ratio(value);
  if (
    [
      "firstAttemptAverageSeconds",
      "firstEffectiveContactAverageSeconds",
    ].includes(metric)
  )
    return duration(value);
  return number(value);
}

export default function V2Productivity() {
  const [filters, setFilters] = useAnalyticsUrlFilters();
  const [rankingMetric, setRankingMetric] =
    useState<RankingMetric>("workCoverage");
  const [dailyMetric, setDailyMetric] = useState<DailyMetric>("leadsWorked");
  const [selectedSellerId, setSelectedSellerId] = useState<number | null>(null);
  const [sort, setSort] = useState<{
    key: RankingMetric;
    direction: "asc" | "desc";
  }>({ key: "workCoverage", direction: "asc" });
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const productivity = v2trpc.analytics.productivity.useQuery(filters, {
    enabled: canQuery,
  });
  const sellers = (productivity.data?.sellers ?? []) as SellerRow[];
  const selectedSeller = sellers.find(
    seller => seller.membershipId === selectedSellerId
  );
  const rankedSellers = useMemo(
    () =>
      [...sellers].sort(
        (left, right) =>
          metricValue(right, rankingMetric) - metricValue(left, rankingMetric)
      ),
    [sellers, rankingMetric]
  );
  const sortedSellers = useMemo(
    () =>
      [...sellers].sort((left, right) => {
        const order =
          metricValue(left, sort.key) - metricValue(right, sort.key);
        return sort.direction === "asc" ? order : -order;
      }),
    [sellers, sort]
  );
  const chooseSummaryMetric = (metric: RankingMetric) => {
    setRankingMetric(metric);
    setSort({
      key: metric,
      direction:
        metric.includes("Seconds") || metric === "followUpsOverdue"
          ? "desc"
          : "asc",
    });
  };
  const changeSort = (key: RankingMetric) =>
    setSort(current => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));

  return (
    <main className="v2-page v2-productivity-page space-y-6">
      <V2PageHeader
        eyebrow="Gestão"
        title="Produtividade"
        description="Esforço, contato efetivo, disciplina de follow-up e resultado por vendedor."
      />
      <AnalyticsFilters
        className="v2-productivity-filters"
        value={filters}
        onChange={setFilters}
      />
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
          <section aria-labelledby="productivity-summary-title">
            <SectionHeading
              eyebrow="Resumo da execução"
              title="Como a equipe executou"
              detail={`${number(productivity.data.totals.sellers)} vendedor(es) no escopo`}
              id="productivity-summary-title"
            />
            <div className="v2-productivity-summary-grid">
              <Summary
                title="Leads trabalhados"
                value={number(productivity.data.totals.worked)}
                onClick={() => chooseSummaryMetric("leadsWorked")}
              />
              <Summary
                title="Tentativas"
                value={number(productivity.data.totals.attempts)}
                onClick={() => chooseSummaryMetric("attempts")}
              />
              <Summary
                title="Taxa de contato"
                value={percent(
                  productivity.data.totals.effectiveContactRate ??
                    (productivity.data.totals.worked
                      ? (productivity.data.totals.leadsWithEffectiveContact ??
                          0) / productivity.data.totals.worked
                      : null)
                )}
                onClick={() => chooseSummaryMetric("effectiveContactRate")}
              />
              <Summary
                title="Taxa de conversão"
                value={percent(productivity.data.totals.conversionRate)}
                onClick={() => chooseSummaryMetric("conversionRate")}
              />
              <Summary
                title="1ª tentativa"
                value={duration(
                  productivity.data.totals.firstAttemptAverageSeconds
                )}
                onClick={() =>
                  chooseSummaryMetric("firstAttemptAverageSeconds")
                }
              />
              <Summary
                title="Follow-ups vencidos"
                value={number(productivity.data.totals.followUpsOverdue)}
                destructive
                onClick={() => chooseSummaryMetric("followUpsOverdue")}
              />
            </div>
          </section>
          <section className="v2-productivity-analysis-grid">
            <Card className="v2-section-card v2-productivity-ranking">
              <CardHeader>
                <CardHeading
                  title="Desempenho por vendedor"
                  description="Quem está puxando o indicador para cima ou para baixo."
                  select={
                    <MetricSelect
                      value={rankingMetric}
                      onChange={setRankingMetric}
                      options={rankingOptions}
                      label="Indicador de desempenho"
                    />
                  }
                />
              </CardHeader>
              <CardContent>
                <SellerRanking
                  rows={rankedSellers}
                  metric={rankingMetric}
                  onSelect={row => setSelectedSellerId(row.membershipId)}
                />
              </CardContent>
            </Card>
            <Card className="v2-section-card v2-productivity-evolution">
              <CardHeader>
                <CardHeading
                  title="Evolução da produtividade"
                  description="Constância da execução ao longo do período."
                  select={
                    <MetricSelect
                      value={dailyMetric}
                      onChange={value => setDailyMetric(value as DailyMetric)}
                      options={dailyOptions}
                      label="Indicador de evolução"
                    />
                  }
                />
              </CardHeader>
              <CardContent>
                <DailyBars
                  rows={productivity.data.daily ?? []}
                  metric={dailyMetric}
                />
              </CardContent>
            </Card>
          </section>
          <Card className="v2-section-card v2-productivity-results">
            <CardHeader>
              <CardHeading
                title="Equipe no período"
                description="Ordene para localizar baixa cobertura, demora de resposta ou pendências por vendedor."
                select={
                  <span className="text-xs text-muted-foreground">
                    Clique em um vendedor para diagnosticar.
                  </span>
                }
              />
            </CardHeader>
            <CardContent>
              {sortedSellers.length ? (
                <>
                  <div className="grid gap-3 md:hidden">
                    {sortedSellers.map(row => (
                      <SellerMobileRow
                        key={row.membershipId}
                        row={row}
                        onSelect={() => setSelectedSellerId(row.membershipId)}
                      />
                    ))}
                  </div>
                  <div className="v2-table-scroll hidden md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th>Vendedor</th>
                          <th>PDV</th>
                          <th>Carteira</th>
                          <SortableHead
                            label="Cobertura"
                            active={sort.key === "workCoverage"}
                            direction={sort.direction}
                            onClick={() => changeSort("workCoverage")}
                          />
                          <SortableHead
                            label="Trabalhados"
                            active={sort.key === "leadsWorked"}
                            direction={sort.direction}
                            onClick={() => changeSort("leadsWorked")}
                          />
                          <SortableHead
                            label="Com tentativa"
                            active={sort.key === "leadsWithAttempt"}
                            direction={sort.direction}
                            onClick={() => changeSort("leadsWithAttempt")}
                          />
                          <SortableHead
                            label="Tentativas"
                            active={sort.key === "attempts"}
                            direction={sort.direction}
                            onClick={() => changeSort("attempts")}
                          />
                          <SortableHead
                            label="Tent./Lead"
                            active={sort.key === "attemptsPerLead"}
                            direction={sort.direction}
                            onClick={() => changeSort("attemptsPerLead")}
                          />
                          <SortableHead
                            label="Tx. contato"
                            active={sort.key === "effectiveContactRate"}
                            direction={sort.direction}
                            onClick={() => changeSort("effectiveContactRate")}
                          />
                          <SortableHead
                            label="Conversões"
                            active={sort.key === "conversions"}
                            direction={sort.direction}
                            onClick={() => changeSort("conversions")}
                          />
                          <SortableHead
                            label="Tx. conversão"
                            active={sort.key === "conversionRate"}
                            direction={sort.direction}
                            onClick={() => changeSort("conversionRate")}
                          />
                          <SortableHead
                            label="1ª tentativa"
                            active={sort.key === "firstAttemptAverageSeconds"}
                            direction={sort.direction}
                            onClick={() =>
                              changeSort("firstAttemptAverageSeconds")
                            }
                          />
                          <SortableHead
                            label="1º contato"
                            active={
                              sort.key === "firstEffectiveContactAverageSeconds"
                            }
                            direction={sort.direction}
                            onClick={() =>
                              changeSort("firstEffectiveContactAverageSeconds")
                            }
                          />
                          <SortableHead
                            label="FU vencidos"
                            active={sort.key === "followUpsOverdue"}
                            direction={sort.direction}
                            onClick={() => changeSort("followUpsOverdue")}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSellers.map(row => (
                          <SellerTableRow
                            key={row.membershipId}
                            row={row}
                            onSelect={() =>
                              setSelectedSellerId(row.membershipId)
                            }
                          />
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
          <SellerDrawer
            seller={selectedSeller}
            filters={filters}
            onClose={() => setSelectedSellerId(null)}
            onViewEvolution={() => {
              if (!selectedSeller) return;
              setFilters({
                ...filters,
                sellerMembershipId: selectedSeller.membershipId,
              });
              setSelectedSellerId(null);
            }}
          />
        </>
      ) : null}
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  detail,
  id,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  id?: string;
}) {
  return (
    <div className="v2-productivity-section-heading">
      <div>
        <p className="v2-dashboard-section-label">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <p>{detail}</p>
    </div>
  );
}
function CardHeading({
  title,
  description,
  select,
}: {
  title: string;
  description: string;
  select: ReactNode;
}) {
  return (
    <div className="v2-productivity-card-heading">
      <div>
        <CardTitle>{title}</CardTitle>
        <p>{description}</p>
      </div>
      {select}
    </div>
  );
}
function MetricSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  const selectedLabel = options.find(option => option.value === value)?.label;
  return (
    <Select value={value} onValueChange={value => onChange(value as T)}>
      <SelectTrigger
        className="v2-productivity-select"
        aria-label={label}
        title={selectedLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Summary({
  title,
  value,
  destructive = false,
  onClick,
}: {
  title: string;
  value: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`v2-productivity-summary ${destructive ? "is-destructive" : ""}`}
      onClick={onClick}
    >
      <span>{title}</span>
      <strong>{value}</strong>
      <small>Ver por vendedor</small>
    </button>
  );
}
function SellerRanking({
  rows,
  metric,
  onSelect,
}: {
  rows: SellerRow[];
  metric: RankingMetric;
  onSelect: (row: SellerRow) => void;
}) {
  const maximum = Math.max(1, ...rows.map(row => metricValue(row, metric)));
  return (
    <div className="v2-productivity-bars">
      {rows.length ? (
        rows.map(row => {
          const value = metricValue(row, metric);
          return (
            <button
              type="button"
              key={row.membershipId}
              className="v2-productivity-bar-row"
              onClick={() => onSelect(row)}
            >
              <span title={row.name}>{row.name}</span>
              <i>
                <b
                  style={{
                    width: `${value ? Math.max(6, (value / maximum) * 100) : 0}%`,
                  }}
                />
              </i>
              <strong>{metricLabel(row, metric)}</strong>
            </button>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum vendedor no escopo.
        </p>
      )}
    </div>
  );
}
function DailyBars({
  rows,
  metric,
}: {
  rows: Array<Record<DailyMetric | "date", number | string>>;
  metric: DailyMetric;
}) {
  const maximum = Math.max(1, ...rows.map(row => Number(row[metric] ?? 0)));
  const metricName = dailyOptions.find(option => option.value === metric)?.label ?? "Indicador";
  return (
    <div
      className="v2-productivity-daily"
      aria-label={`Evolução diária: ${dailyOptions.find(option => option.value === metric)?.label}`}
    >
      {rows.map(row => {
        const value = Number(row[metric] ?? 0);
        return (
          <div
            key={String(row.date)}
            title={`${row.date}: ${metricName} — ${number(value)}`}
          >
            <div className="v2-productivity-daily-bar">
              {value > 0 && <b>{number(value)}</b>}
              <i
                style={{
                  height: `${Math.max(value ? 8 : 0, (value / maximum) * 100)}%`,
                }}
              />
            </div>
            <span>{String(row.date).slice(-2)}</span>
          </div>
        );
      })}
    </div>
  );
}
function SellerMobileRow({
  row,
  onSelect,
}: {
  row: SellerRow;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="v2-productivity-mobile-row"
      onClick={onSelect}
    >
      <div>
        <strong>{row.name}</strong>
        <span title={row.pdvNames.join(", ")}>{compactPdvNames(row.pdvNames)}</span>
      </div>
      <div>
        <span>Cobertura</span>
        <strong>{percent(row.workCoverage)}</strong>
      </div>
      <div>
        <span>Tx. contato</span>
        <strong>{percent(row.effectiveContactRate)}</strong>
      </div>
      <div>
        <span>Vencidos</span>
        <strong>{number(row.followUpsOverdue)}</strong>
      </div>
    </button>
  );
}
function SellerTableRow({
  row,
  onSelect,
}: {
  row: SellerRow;
  onSelect: () => void;
}) {
  return (
    <tr>
      <td>
        <button type="button" onClick={onSelect}>
          {row.name}
        </button>
      </td>
      <td title={row.pdvNames.join(", ")}>{compactPdvNames(row.pdvNames)}</td>
      <td>{number(row.leadsInPortfolio)}</td>
      <td>{percent(row.workCoverage)}</td>
      <td>{number(row.leadsWorked)}</td>
      <td>{number(row.leadsWithAttempt)}</td>
      <td>{number(row.attempts)}</td>
      <td>{ratio(row.attemptsPerLead)}</td>
      <td>{percent(row.effectiveContactRate)}</td>
      <td>{number(row.conversions)}</td>
      <td>{percent(row.conversionRate)}</td>
      <td>{duration(row.firstAttemptAverageSeconds)}</td>
      <td>{duration(row.firstEffectiveContactAverageSeconds)}</td>
      <td>
        {row.followUpsOverdue ? (
          <Badge variant="destructive">{row.followUpsOverdue}</Badge>
        ) : (
          "0"
        )}
      </td>
    </tr>
  );
}
function SortableHead({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction?: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th>
      <button type="button" onClick={onClick}>
        {label}
        {active ? (
          direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3" />
        )}
      </button>
    </th>
  );
}
function SellerDrawer({
  seller,
  filters,
  onClose,
  onViewEvolution,
}: {
  seller?: SellerRow;
  filters: { campaignId?: number; pdvId?: number };
  onClose: () => void;
  onViewEvolution: () => void;
}) {
  return (
    <Drawer open={Boolean(seller)} onOpenChange={open => !open && onClose()}>
      <DrawerContent className="max-h-[90dvh]">
        <DrawerHeader>
          <DrawerTitle>{seller?.name ?? "Vendedor"}</DrawerTitle>
          <DrawerDescription>
            Diagnóstico individual no mesmo período e escopo.
          </DrawerDescription>
        </DrawerHeader>
        {seller && (
          <div className="v2-productivity-drawer-content">
            <DrawerMetricGroup title="Alcance">
              <Detail label="Carteira" value={number(seller.leadsInPortfolio)} />
              <Detail label="Cobertura" value={percent(seller.workCoverage)} />
              <Detail label="Trabalhados" value={number(seller.leadsWorked)} />
            </DrawerMetricGroup>
            <DrawerMetricGroup title="Esforço">
              <Detail label="Leads com tentativa" value={number(seller.leadsWithAttempt)} />
              <Detail label="Tentativas" value={number(seller.attempts)} />
              <Detail label="Tent. / Lead" value={ratio(seller.attemptsPerLead)} />
            </DrawerMetricGroup>
            <DrawerMetricGroup title="Eficiência">
              <Detail label="Contatos efetivos" value={number(seller.effectiveContacts)} />
              <Detail label="Tx. contato" value={percent(seller.effectiveContactRate)} />
              <Detail label="Conversões" value={number(seller.conversions)} />
              <Detail label="Tx. conversão" value={percent(seller.conversionRate)} />
            </DrawerMetricGroup>
            <DrawerMetricGroup title="Velocidade">
              <Detail label="1ª tentativa" value={duration(seller.firstAttemptAverageSeconds)} />
              <Detail label="1º contato" value={duration(seller.firstEffectiveContactAverageSeconds)} />
            </DrawerMetricGroup>
            <DrawerMetricGroup title="Disciplina">
              <Detail label="Follow-ups vencidos" value={number(seller.followUpsOverdue)} />
            </DrawerMetricGroup>
            <div className="v2-productivity-drawer-actions">
              <Button type="button" onClick={onViewEvolution}>
                Ver evolução individual
              </Button>
              <Link
                href={buildV2Path("/v2/leads", {
                  assignedMembershipId: seller.membershipId,
                  campaignId: filters.campaignId,
                  pdvId: filters.pdvId,
                  from: currentV2Path(),
                })}
              >
                <Button variant="outline">Ver Leads</Button>
              </Link>
              <Link
                href={buildV2Path("/v2/follow-ups", {
                  ownerMembershipId: seller.membershipId,
                  campaignId: filters.campaignId,
                  pdvId: filters.pdvId,
                  from: currentV2Path(),
                })}
              >
                <Button variant="outline">Ver Follow-ups</Button>
              </Link>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
function DrawerMetricGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="v2-productivity-drawer-group">
      <h3>{title}</h3>
      <div className="v2-productivity-drawer-grid">{children}</div>
    </section>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
