import {
  AnalyticsFilters,
  type AnalyticsUiFilters,
  useAnalyticsUrlFilters,
} from "@/components/v2/AnalyticsFilters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { v2trpc } from "@/lib/v2trpc";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { useState } from "react";
import { toast } from "sonner";

type ReportType =
  | "leads"
  | "attempts"
  | "treatments"
  | "conversions"
  | "follow_ups"
  | "imports"
  | "distributions";

const reportLabels: Record<ReportType, string> = {
  leads: "Leads",
  attempts: "Tentativas",
  treatments: "Tratativas efetivas",
  conversions: "Conversões",
  follow_ups: "Follow-ups",
  imports: "Importações",
  distributions: "Distribuições",
};

function display(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return new Date(value).toLocaleString("pt-BR");
  return String(value);
}

export default function V2Reports() {
  const [filters, setFilters] = useAnalyticsUrlFilters();
  const [type, setType] = useState<ReportType>("leads");
  const [evidenceFilter, setEvidenceFilter] = useState<
    "all" | "with_evidence" | "without_evidence" | "required_pending"
  >("all");
  const [followUpSituation, setFollowUpSituation] = useState<
    | "all"
    | "overdue"
    | "today"
    | "upcoming"
    | "pending"
    | "completed"
    | "cancelled"
  >("all");
  const [followUpDateField, setFollowUpDateField] = useState<
    "dueAt" | "createdAt"
  >("dueAt");
  const [page, setPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<number[]>([]);
  const access = v2trpc.access.context.useQuery();
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const input = {
    ...filters,
    type,
    page,
    pageSize: 25,
    evidenceFilter: evidenceFilter === "all" ? undefined : evidenceFilter,
    followUpSituation:
      followUpSituation === "all" ? undefined : followUpSituation,
    followUpDateField: type === "follow_ups" ? followUpDateField : undefined,
  };
  const report = v2trpc.analytics.reports.list.useQuery(input, {
    enabled: canQuery,
  });
  const exportCsv = v2trpc.analytics.reports.export.useMutation({
    onSuccess: result => {
      const href = URL.createObjectURL(
        new Blob([result.content], { type: "text/csv;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(href);
      toast.success(`${result.total} linha(s) exportada(s).`);
    },
    onError: error => toast.error(error.message),
  });
  const updateFilters = (next: AnalyticsUiFilters) => {
    setFilters(next);
    setPage(1);
    setExpandedRows([]);
  };

  return (
    <main className="v2-page space-y-6">
      <V2PageHeader
        eyebrow="Gestão"
        title="Relatórios"
        description="Análise histórica e exportação CSV com o mesmo escopo autorizado da consulta."
      />

      <Card className="v2-filter-panel">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <label className="text-sm font-medium" htmlFor="report-type">
              Tipo de relatório
            </label>
            <Select
              value={type}
              onValueChange={value => {
                setType(value as ReportType);
                setPage(1);
                setExpandedRows([]);
                setEvidenceFilter("all");
                setFollowUpSituation("all");
              }}
            >
              <SelectTrigger id="report-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(reportLabels) as ReportType[])
                  .filter(
                    item =>
                      access.data?.role !== "seller" ||
                      (item !== "imports" && item !== "distributions")
                  )
                  .map(item => (
                    <SelectItem key={item} value={item}>
                      {reportLabels[item]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {(type === "leads" ||
            type === "attempts" ||
            type === "treatments") && (
            <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
              <label
                className="text-sm font-medium"
                htmlFor="report-evidence-filter"
              >
                Evidências
              </label>
              <Select
                value={evidenceFilter}
                onValueChange={value => {
                  setEvidenceFilter(value as typeof evidenceFilter);
                  setPage(1);
                }}
              >
                <SelectTrigger id="report-evidence-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="with_evidence">Com evidência</SelectItem>
                  <SelectItem value="without_evidence">
                    Sem evidência
                  </SelectItem>
                  <SelectItem value="required_pending">
                    Pendência obrigatória
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "follow_ups" && (
            <>
              <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
                <label
                  className="text-sm font-medium"
                  htmlFor="report-follow-up-situation"
                >
                  Situação operacional
                </label>
                <Select
                  value={followUpSituation}
                  onValueChange={value => {
                    setFollowUpSituation(value as typeof followUpSituation);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="report-follow-up-situation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="overdue">Vencidos</SelectItem>
                    <SelectItem value="today">Hoje</SelectItem>
                    <SelectItem value="upcoming">A vencer</SelectItem>
                    <SelectItem value="pending">Pendentes</SelectItem>
                    <SelectItem value="completed">Concluídos</SelectItem>
                    <SelectItem value="cancelled">Cancelados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
                <label
                  className="text-sm font-medium"
                  htmlFor="report-follow-up-date"
                >
                  Período por
                </label>
                <Select
                  value={followUpDateField}
                  onValueChange={value => {
                    setFollowUpDateField(value as typeof followUpDateField);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="report-follow-up-date">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dueAt">
                      Data prevista de retorno
                    </SelectItem>
                    <SelectItem value="createdAt">Data de criação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <Button
            className="sm:ml-auto"
            disabled={!canQuery || exportCsv.isPending || !report.data?.total}
            onClick={() =>
              exportCsv.mutate({
                ...filters,
                type,
                evidenceFilter:
                  evidenceFilter === "all" ? undefined : evidenceFilter,
                followUpSituation:
                  followUpSituation === "all" ? undefined : followUpSituation,
                followUpDateField:
                  type === "follow_ups" ? followUpDateField : undefined,
              })
            }
          >
            Exportar CSV
          </Button>
        </CardContent>
      </Card>
      <AnalyticsFilters value={filters} onChange={updateFilters} />

      {!canQuery ? (
        <Card className="v2-section-card">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas do período personalizado.
          </CardContent>
        </Card>
      ) : report.isLoading ? (
        <V2LoadingState label="Consultando relatório no banco" />
      ) : report.isError ? (
        <V2ErrorState
          message="Não foi possível carregar este relatório no seu escopo."
          onRetry={() => report.refetch()}
        />
      ) : report.data ? (
        <Card className="v2-section-card">
          <CardHeader>
            <CardTitle>{reportLabels[type]}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {report.data.total} resultado(s) · {report.data.period.label} ·{" "}
              {report.data.period.timeZone}
            </p>
          </CardHeader>
          <CardContent>
            {report.data.rows.length ? (
              <>
                <div className="grid gap-3 md:hidden">
                  {report.data.rows.map((row, index) => {
                    const primaryColumns = report.data.columns.slice(0, 4);
                    const detailColumns = report.data.columns.slice(4);
                    const expanded = expandedRows.includes(index);
                    const detailsId = `report-row-${page}-${index}-details`;
                    const toggleRow = () =>
                      setExpandedRows(current =>
                        current.includes(index)
                          ? current.filter(rowIndex => rowIndex !== index)
                          : [...current, index]
                      );
                    return (
                      <article
                        key={index}
                        className="v2-mobile-record rounded-lg border p-3"
                      >
                        {primaryColumns.map(column => (
                          <div
                            key={column.key}
                            className="v2-report-mobile-field"
                          >
                            <span className="v2-report-mobile-field-label">
                              {column.label}
                            </span>
                            <span
                              className="v2-report-mobile-field-value"
                              title={display(row[column.key])}
                            >
                              {display(row[column.key])}
                            </span>
                          </div>
                        ))}
                        {detailColumns.length > 0 && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              className="v2-mobile-disclosure-trigger w-full justify-between px-2"
                              aria-expanded={expanded}
                              aria-controls={detailsId}
                              onClick={toggleRow}
                            >
                              {expanded
                                ? "Ocultar detalhes"
                                : `Ver mais ${detailColumns.length} campo(s)`}
                              <span aria-hidden="true">
                                {expanded ? "−" : "+"}
                              </span>
                            </Button>
                            {expanded && (
                              <div id={detailsId} className="border-t pt-2">
                                {detailColumns.map(column => (
                                  <div
                                    key={column.key}
                                    className="v2-report-mobile-field"
                                  >
                                    <span className="v2-report-mobile-field-label">
                                      {column.label}
                                    </span>
                                    <span
                                      className="v2-report-mobile-field-value"
                                      title={display(row[column.key])}
                                    >
                                      {display(row[column.key])}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
                <div className="v2-table-scroll hidden md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr>
                        {report.data.columns.map(column => (
                          <th
                            className="whitespace-nowrap p-2"
                            key={column.key}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.rows.map((row, index) => (
                        <tr key={index} className="border-b last:border-0">
                          {report.data.columns.map(column => (
                            <td
                              className="max-w-xs whitespace-nowrap p-2"
                              key={column.key}
                              title={display(row[column.key])}
                            >
                              {display(row[column.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhum registro para os filtros aplicados.
              </p>
            )}
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>Página {page}</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => {
                    setExpandedRows([]);
                    setPage(page - 1);
                  }}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * report.data.pageSize >= report.data.total}
                  onClick={() => {
                    setExpandedRows([]);
                    setPage(page + 1);
                  }}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
