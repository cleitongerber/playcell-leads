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
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

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
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Gestão
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Relatórios</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Análise histórica e exportação CSV com o mesmo escopo autorizado da
            consulta.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/v2/dashboard">
            <Button variant="outline">Dashboard</Button>
          </Link>
          <Link href="/v2/productivity">
            <Button variant="outline">Produtividade</Button>
          </Link>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Select
            value={type}
            onValueChange={value => {
              setType(value as ReportType);
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:max-w-xs">
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
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Consultando relatório no banco V2…
          </CardContent>
        </Card>
      ) : report.isError ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-destructive">
            Não foi possível carregar este relatório no seu escopo.
          </CardContent>
        </Card>
      ) : report.data ? (
        <Card>
          <CardHeader>
            <CardTitle>{reportLabels[type]}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {report.data.total} resultado(s) · {report.data.period.label} ·{" "}
              {report.data.period.timeZone}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {report.data.rows.length ? (
              <table className="w-full min-w-max text-sm">
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
