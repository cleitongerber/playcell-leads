import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { v2trpc } from "@/lib/v2trpc";

export type AnalyticsUiFilters = {
  preset:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "this_week"
    | "this_month"
    | "custom";
  fromDate?: string;
  toDate?: string;
  campaignId?: number;
  pdvId?: number;
  sellerMembershipId?: number;
};

export const defaultAnalyticsFilters: AnalyticsUiFilters = {
  preset: "this_month",
};

const periodLabels: Record<AnalyticsUiFilters["preset"], string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7_days: "Últimos 7 dias",
  this_week: "Esta semana",
  this_month: "Este mês",
  custom: "Período personalizado",
};

function idFromSelect(value: string) {
  return value === "all" ? undefined : Number(value);
}

export function AnalyticsFilters({
  value,
  onChange,
  includeSeller = true,
}: {
  value: AnalyticsUiFilters;
  onChange: (next: AnalyticsUiFilters) => void;
  includeSeller?: boolean;
}) {
  const filters = v2trpc.analytics.filters.useQuery();
  const access = v2trpc.access.context.useQuery();
  const canFilterSeller = includeSeller && access.data?.role !== "seller";
  const patch = (next: Partial<AnalyticsUiFilters>) =>
    onChange({ ...value, ...next });

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 lg:grid-cols-4">
        <Select
          value={value.preset}
          onValueChange={preset =>
            patch({
              preset: preset as AnalyticsUiFilters["preset"],
              ...(preset === "custom"
                ? {}
                : { fromDate: undefined, toDate: undefined }),
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(periodLabels) as AnalyticsUiFilters["preset"][]).map(
              preset => (
                <SelectItem key={preset} value={preset}>
                  {periodLabels[preset]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        {value.preset === "custom" && (
          <div className="grid grid-cols-2 gap-2 lg:col-span-2">
            <Input
              aria-label="Início do período"
              type="date"
              value={value.fromDate ?? ""}
              onChange={event =>
                patch({ fromDate: event.target.value || undefined })
              }
            />
            <Input
              aria-label="Fim do período"
              type="date"
              value={value.toDate ?? ""}
              onChange={event =>
                patch({ toDate: event.target.value || undefined })
              }
            />
          </div>
        )}
        <Select
          value={value.campaignId ? String(value.campaignId) : "all"}
          onValueChange={campaignId =>
            patch({ campaignId: idFromSelect(campaignId) })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Todas as campanhas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as campanhas</SelectItem>
            {filters.data?.campaigns.map(campaign => (
              <SelectItem key={campaign.id} value={String(campaign.id)}>
                {campaign.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={value.pdvId ? String(value.pdvId) : "all"}
          onValueChange={pdvId => patch({ pdvId: idFromSelect(pdvId) })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todos os PDVs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os PDVs</SelectItem>
            {filters.data?.pdvs.map(pdv => (
              <SelectItem key={pdv.id} value={String(pdv.id)}>
                {pdv.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canFilterSeller && (
          <Select
            value={
              value.sellerMembershipId
                ? String(value.sellerMembershipId)
                : "all"
            }
            onValueChange={sellerMembershipId =>
              patch({ sellerMembershipId: idFromSelect(sellerMembershipId) })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos os vendedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {filters.data?.sellers.map(seller => (
                <SelectItem key={seller.id} value={String(seller.id)}>
                  {seller.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Datas calculadas no servidor em {filters.data?.timeZone ?? "…"}.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(defaultAnalyticsFilters)}
          >
            Limpar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
