import {
  AnalyticsFilters,
  defaultAnalyticsFilters,
  type AnalyticsUiFilters,
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
  | "treatments"
  | "follow_ups"
  | "imports"
  | "distributions";

const reportLabels: Record<ReportType, string> = {
  leads: "Leads",
  treatments: "Tratativas",
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
  const [filters, setFilters] = useState<AnalyticsUiFilters>(
    defaultAnalyticsFilters
  );
  const [type, setType] = useState<ReportType>("leads");
  const [page, setPage] = useState(1);
  const access = v2trpc.access.context.useQuery();
  const canQuery =
    filters.preset !== "custom" || Boolean(filters.fromDate && filters.toDate);
  const input = { ...filters, type, page, pageSize: 25 };
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
  };

  return (
    <main className="v2-page space-y-6">
      <V2PageHeader eyebrow="V2 / Gestão" title="Relatórios" description="Análise histórica e exportação CSV com o mesmo escopo autorizado da consulta." />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
          <label className="text-sm font-medium" htmlFor="report-type">Tipo de relatório</label>
          <Select
            value={type}
            onValueChange={value => {
              setType(value as ReportType);
              setPage(1);
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
          <Button
            className="sm:ml-auto"
            disabled={!canQuery || exportCsv.isPending || !report.data?.total}
            onClick={() => exportCsv.mutate({ ...filters, type })}
          >
            Exportar CSV
          </Button>
        </CardContent>
      </Card>
      <AnalyticsFilters value={filters} onChange={updateFilters} />

      {!canQuery ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Informe as duas datas do período personalizado.
          </CardContent>
        </Card>
      ) : report.isLoading ? (
        <V2LoadingState label="Consultando relatório no banco V2" />
      ) : report.isError ? (
        <V2ErrorState message="Não foi possível carregar este relatório no seu escopo." onRetry={() => report.refetch()} />
      ) : report.data ? (
        <Card>
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
                {report.data.rows.map((row, index) => (
                  <div key={index} className="v2-mobile-record rounded-lg border p-3">
                    {report.data.columns.map(column => <div key={column.key} className="flex items-start justify-between gap-3 border-b py-1.5 last:border-0"><span className="text-xs text-muted-foreground">{column.label}</span><span className="max-w-[65%] text-right text-sm" title={display(row[column.key])}>{display(row[column.key])}</span></div>)}
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    {report.data.columns.map(column => (
                      <th className="whitespace-nowrap p-2" key={column.key}>
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
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * report.data.pageSize >= report.data.total}
                  onClick={() => setPage(page + 1)}
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
