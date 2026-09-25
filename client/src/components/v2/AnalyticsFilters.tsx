import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { v2trpc } from "@/lib/v2trpc";
import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

export type AnalyticsUiFilters = {
  preset: "today" | "yesterday" | "last_7_days" | "this_week" | "this_month" | "custom";
  fromDate?: string;
  toDate?: string;
  campaignId?: number;
  pdvId?: number;
  sellerMembershipId?: number;
};

export const defaultAnalyticsFilters: AnalyticsUiFilters = { preset: "this_month" };
const periodLabels: Record<AnalyticsUiFilters["preset"], string> = {
  today: "Hoje", yesterday: "Ontem", last_7_days: "Últimos 7 dias", this_week: "Esta semana", this_month: "Este mês", custom: "Período personalizado",
};
function idFromSelect(value: string) { return value === "all" ? undefined : Number(value); }

function FilterControls({ value, patch, campaigns, pdvs, sellers, canFilterSeller, onClear, timeZone, idPrefix }: {
  value: AnalyticsUiFilters;
  patch: (next: Partial<AnalyticsUiFilters>) => void;
  campaigns: Array<{ id: number; name: string }>;
  pdvs: Array<{ id: number; name: string }>;
  sellers: Array<{ id: number; name: string }>;
  canFilterSeller: boolean;
  onClear: () => void;
  timeZone?: string;
  idPrefix: string;
}) {
  return <>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-period`}>Período</Label><Select value={value.preset} onValueChange={preset => patch({ preset: preset as AnalyticsUiFilters["preset"], ...(preset === "custom" ? {} : { fromDate: undefined, toDate: undefined }) })}><SelectTrigger id={`${idPrefix}-period`}><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(periodLabels) as AnalyticsUiFilters["preset"][]).map(preset => <SelectItem key={preset} value={preset}>{periodLabels[preset]}</SelectItem>)}</SelectContent></Select></div>
    {value.preset === "custom" && <div className="grid grid-cols-2 gap-2 sm:col-span-2"><div className="space-y-1.5"><Label htmlFor={`${idPrefix}-from`}>Início</Label><Input id={`${idPrefix}-from`} type="date" value={value.fromDate ?? ""} onChange={event => patch({ fromDate: event.target.value || undefined })} /></div><div className="space-y-1.5"><Label htmlFor={`${idPrefix}-to`}>Fim</Label><Input id={`${idPrefix}-to`} type="date" value={value.toDate ?? ""} onChange={event => patch({ toDate: event.target.value || undefined })} /></div></div>}
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-campaign`}>Campanha</Label><Select value={value.campaignId ? String(value.campaignId) : "all"} onValueChange={campaignId => patch({ campaignId: idFromSelect(campaignId) })}><SelectTrigger id={`${idPrefix}-campaign`}><SelectValue placeholder="Todas as campanhas" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as campanhas</SelectItem>{campaigns.map(campaign => <SelectItem key={campaign.id} value={String(campaign.id)}>{campaign.name}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-pdv`}>PDV</Label><Select value={value.pdvId ? String(value.pdvId) : "all"} onValueChange={pdvId => patch({ pdvId: idFromSelect(pdvId) })}><SelectTrigger id={`${idPrefix}-pdv`}><SelectValue placeholder="Todos os PDVs" /></SelectTrigger><SelectContent><SelectItem value="all">Todos os PDVs</SelectItem>{pdvs.map(pdv => <SelectItem key={pdv.id} value={String(pdv.id)}>{pdv.name}</SelectItem>)}</SelectContent></Select></div>
    {canFilterSeller && <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-seller`}>Vendedor</Label><Select value={value.sellerMembershipId ? String(value.sellerMembershipId) : "all"} onValueChange={sellerMembershipId => patch({ sellerMembershipId: idFromSelect(sellerMembershipId) })}><SelectTrigger id={`${idPrefix}-seller`}><SelectValue placeholder="Todos os vendedores" /></SelectTrigger><SelectContent><SelectItem value="all">Todos os vendedores</SelectItem>{sellers.map(seller => <SelectItem key={seller.id} value={String(seller.id)}>{seller.name}</SelectItem>)}</SelectContent></Select></div>}
    <div className="flex items-end gap-2 text-xs text-muted-foreground sm:col-span-2 lg:col-span-4"><span className="flex-1">Datas calculadas no servidor em {timeZone ?? "…"}.</span><Button type="button" size="sm" variant="ghost" onClick={onClear}>Limpar</Button></div>
  </>;
}

export function AnalyticsFilters({ value, onChange, includeSeller = true }: { value: AnalyticsUiFilters; onChange: (next: AnalyticsUiFilters) => void; includeSeller?: boolean }) {
  const filters = v2trpc.analytics.filters.useQuery();
  const access = v2trpc.access.context.useQuery();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const canFilterSeller = includeSeller && access.data?.role !== "seller";
  const patch = (next: Partial<AnalyticsUiFilters>) => onChange({ ...value, ...next });
  const activeCount = useMemo(() => [value.campaignId, value.pdvId, value.sellerMembershipId, value.preset === "custom" && value.fromDate, value.preset === "custom" && value.toDate].filter(Boolean).length, [value]);
  const controlProps = { value, patch, campaigns: filters.data?.campaigns ?? [], pdvs: filters.data?.pdvs ?? [], sellers: filters.data?.sellers ?? [], canFilterSeller, onClear: () => onChange(defaultAnalyticsFilters), timeZone: filters.data?.timeZone };
  return <Card><CardContent className="p-4">
    <div className="flex items-center justify-between gap-3 md:hidden"><div><p className="font-medium">Filtros</p><p className="text-xs text-muted-foreground">{activeCount ? `${activeCount} filtro(s) ativo(s)` : "Período padrão"}</p></div><Drawer open={drawerOpen} onOpenChange={setDrawerOpen}><DrawerTrigger asChild><Button type="button" variant="outline"><SlidersHorizontal className="mr-2 size-4" /> Ajustar</Button></DrawerTrigger><DrawerContent className="max-h-[90dvh] overflow-y-auto"><DrawerHeader><DrawerTitle>Filtros analíticos</DrawerTitle><DrawerDescription>Escolha o universo autorizado para os indicadores.</DrawerDescription></DrawerHeader><div className="grid gap-4 p-4"><FilterControls {...controlProps} idPrefix="mobile-analytics" /></div></DrawerContent></Drawer></div>
    <div className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-4"><FilterControls {...controlProps} idPrefix="desktop-analytics" /></div>
  </CardContent></Card>;
}
