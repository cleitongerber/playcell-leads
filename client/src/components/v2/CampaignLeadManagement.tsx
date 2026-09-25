import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { v2trpc } from "@/lib/v2trpc";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type Operation = "assign" | "reassign" | "return_to_queue" | "balanced";

type Filters = {
  pdvId?: number;
  statusId?: number;
  sourceId?: number;
  assignedMembershipId?: number;
  assignment: "all" | "assigned" | "unassigned";
  receivedFrom?: Date;
  receivedTo?: Date;
  search?: string;
  customFieldKey?: string;
  customFieldValue?: string;
};

function createRequestKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `distribution-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function beginningOfDay(value: string) {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

function endOfDay(value: string) {
  return value ? new Date(`${value}T23:59:59.999`) : undefined;
}

function dateInputValue(value?: Date) {
  return value ? value.toISOString().slice(0, 10) : "";
}

const operationLabel: Record<Operation, string> = {
  assign: "Distribuir",
  reassign: "Redistribuir",
  return_to_queue: "Devolver à fila",
  balanced: "Distribuição equilibrada",
};

export function CampaignLeadManagement({
  campaign,
}: {
  campaign: {
    id: number;
    name: string;
    status: "draft" | "active" | "closed" | "archived";
    isFrozen: boolean;
  };
}) {
  const utils = v2trpc.useUtils();
  const [filters, setFilters] = useState<Filters>({ assignment: "all" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState(createRequestKey);
  const isOperational = campaign.status === "active" && !campaign.isFrozen;
  const queryInput = {
    campaignId: campaign.id,
    page,
    pageSize: 25,
    ...filters,
  };
  const management = v2trpc.leads.managementList.useQuery(queryInput);
  const options = v2trpc.leads.managementFilters.useQuery({
    campaignId: campaign.id,
  });
  const customFields = v2trpc.imports.customFields.useQuery();

  const resetSelection = () => {
    setSelected(new Set());
    setAllFiltered(false);
  };
  const updateFilters = (patch: Partial<Filters>) => {
    setFilters(current => ({ ...current, ...patch }));
    setPage(1);
    resetSelection();
  };
  const pageIds = management.data?.items.map(item => item.id) ?? [];
  const pageFullySelected =
    pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const selectedCount = allFiltered
    ? management.data?.total ?? 0
    : selected.size;
  const selectedPdvIds = useMemo(
    () =>
      Array.from(
        new Set(
          (management.data?.items ?? [])
            .filter(item => selected.has(item.id))
            .map(item => item.pdvId)
        )
      ),
    [management.data?.items, selected]
  );
  const eligibleSellers = useMemo(() => {
    const sellers = options.data?.sellers ?? [];
    if (allFiltered || !selectedPdvIds.length) return sellers;
    return sellers.filter(seller =>
      selectedPdvIds.every(pdvId => seller.pdvIds.includes(pdvId))
    );
  }, [allFiltered, options.data?.sellers, selectedPdvIds]);
  const selectedPdvNames = useMemo(() => {
    if (allFiltered) {
      return filters.pdvId
        ? options.data?.pdvs.find(pdv => pdv.id === filters.pdvId)?.name ?? "PDV filtrado"
        : "PDVs do resultado filtrado";
    }
    return selectedPdvIds.length
      ? selectedPdvIds
          .map(id => options.data?.pdvs.find(pdv => pdv.id === id)?.name)
          .filter(Boolean)
          .join(", ")
      : "Nenhum PDV";
  }, [allFiltered, filters.pdvId, options.data?.pdvs, selectedPdvIds]);
  const distribute = v2trpc.leads.distribute.useMutation({
    onSuccess: result => {
      const summary = `${result.success} concluído(s), ${result.skipped} ignorado(s), ${result.failed} falha(s).`;
      if (result.pending) toast.info("Esta operação já está sendo processada.");
      else if (result.success) toast.success(summary);
      else toast.warning(summary);
      setOperation(null);
      setMembershipId("");
      setReason("");
      setRequestKey(createRequestKey());
      resetSelection();
      utils.leads.managementList.invalidate({ campaignId: campaign.id });
      utils.leads.managementFilters.invalidate({ campaignId: campaign.id });
      utils.leads.list.invalidate();
      utils.leads.get.invalidate();
      utils.followUps.list.invalidate();
      utils.followUps.alerts.invalidate();
      utils.campaigns.get.invalidate({ id: campaign.id });
    },
    onError: error => toast.error(error.message),
  });

  const openOperation = (next: Operation) => {
    if (!selectedCount) {
      toast.error("Selecione ao menos um lead para continuar.");
      return;
    }
    if (!isOperational) {
      toast.error("A campanha não permite alterações operacionais neste momento.");
      return;
    }
    setOperation(next);
  };
  const execute = () => {
    if (!operation) return;
    if ((operation === "assign" || operation === "reassign") && !membershipId) {
      toast.error("Escolha um vendedor elegível.");
      return;
    }
    distribute.mutate({
      type: operation,
      membershipId:
        operation === "assign" || operation === "reassign"
          ? Number(membershipId)
          : undefined,
      reason: reason.trim() || null,
      requestKey,
      selection: allFiltered
        ? {
            mode: "filtered",
            filters: {
              campaignId: campaign.id,
              ...filters,
            },
          }
        : {
            mode: "ids",
            campaignId: campaign.id,
            leadIds: Array.from(selected),
          },
    });
  };
  const togglePage = (checked: boolean) => {
    setAllFiltered(false);
    setSelected(current => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const toggleLead = (id: number, checked: boolean) => {
    setAllFiltered(false);
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <CardTitle>Gestão da base de leads</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Filtros, paginação e distribuição são processados no servidor.
            </p>
          </div>
          {!isOperational && (
            <Badge variant="destructive">
              {campaign.isFrozen
                ? "Campanha congelada"
                : "Campanha sem operação ativa"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            className="lg:col-span-2"
            placeholder="Buscar nome, telefone ou e-mail"
            value={filters.search ?? ""}
            onChange={event => updateFilters({ search: event.target.value || undefined })}
          />
          <Select
            value={filters.assignment}
            onValueChange={value =>
              updateFilters({ assignment: value as Filters["assignment"] })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Responsabilidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os leads</SelectItem>
              <SelectItem value="unassigned">Sem responsável</SelectItem>
              <SelectItem value="assigned">Com responsável</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.pdvId ? String(filters.pdvId) : "all"}
            onValueChange={value =>
              updateFilters({ pdvId: value === "all" ? undefined : Number(value) })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos os PDVs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os PDVs</SelectItem>
              {options.data?.pdvs.map(pdv => (
                <SelectItem key={pdv.id} value={String(pdv.id)}>
                  {pdv.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.statusId ? String(filters.statusId) : "all"}
            onValueChange={value =>
              updateFilters({
                statusId: value === "all" ? undefined : Number(value),
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {options.data?.statuses.map(status => (
                <SelectItem key={status.id} value={String(status.id)}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.sourceId ? String(filters.sourceId) : "all"}
            onValueChange={value =>
              updateFilters({
                sourceId: value === "all" ? undefined : Number(value),
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Todas as origens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {options.data?.sources.map(source => (
                <SelectItem key={source.id} value={String(source.id)}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={
              filters.assignedMembershipId
                ? String(filters.assignedMembershipId)
                : "all"
            }
            onValueChange={value =>
              updateFilters({
                assignedMembershipId:
                  value === "all" ? undefined : Number(value),
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos os vendedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {options.data?.sellers.map(seller => (
                <SelectItem key={seller.membershipId} value={String(seller.membershipId)}>
                  {seller.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label="Entrada a partir de"
            value={dateInputValue(filters.receivedFrom)}
            onChange={event =>
              updateFilters({ receivedFrom: beginningOfDay(event.target.value) })
            }
          />
          <Input
            type="date"
            aria-label="Entrada até"
            value={dateInputValue(filters.receivedTo)}
            onChange={event =>
              updateFilters({ receivedTo: endOfDay(event.target.value) })
            }
          />
          <Select
            value={filters.customFieldKey ?? "none"}
            onValueChange={value =>
              updateFilters({
                customFieldKey: value === "none" ? undefined : value,
                customFieldValue:
                  value === "none" ? undefined : filters.customFieldValue,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Campo personalizado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem campo adicional</SelectItem>
              {customFields.data?.map(field => (
                <SelectItem key={field.key} value={field.key}>
                  {field.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            disabled={!filters.customFieldKey}
            placeholder="Valor do campo"
            value={filters.customFieldValue ?? ""}
            onChange={event =>
              updateFilters({
                customFieldValue: event.target.value || undefined,
              })
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Total", management.data?.summary.total ?? 0],
            ["Sem responsável", management.data?.summary.available ?? 0],
            ["Distribuídos", management.data?.summary.assigned ?? 0],
            ["Em tratamento", management.data?.summary.inTreatment ?? 0],
            ["Concluídos", management.data?.summary.completed ?? 0],
          ].map(([label, total]) => (
            <div key={String(label)} className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{total}</p>
            </div>
          ))}
        </div>

        {!!management.data?.summary.bySeller.length && (
          <div className="rounded-lg border p-3">
            <p className="mb-3 text-sm font-medium">Visão por vendedor</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {management.data.summary.bySeller.map(seller => (
                <div key={seller.membershipId} className="rounded-md bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{seller.name}</p>
                  <p className="mt-1 text-muted-foreground">
                    Carteira ativa: {seller.activeLeadCount} · Campanha: {seller.totalInCampaign}
                  </p>
                  <p className="text-muted-foreground">
                    Vencidos: {seller.overdueFollowUps} · Hoje: {seller.todayFollowUps} · Concluídos: {seller.completedInCampaign}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {management.data &&
          (management.data.summary.byPdv.length > 0 ||
            management.data.summary.byStatus.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Por PDV</p>
                <div className="flex flex-wrap gap-2">
                  {management.data.summary.byPdv.map(item => (
                    <Badge key={item.pdvId} variant="outline">
                      {item.label}: {item.total}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Por status</p>
                <div className="flex flex-wrap gap-2">
                  {management.data.summary.byStatus.map(item => (
                    <Badge key={item.statusId} variant="outline">
                      {item.label}: {item.total}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={pageFullySelected}
                onCheckedChange={checked => togglePage(checked === true)}
              />
              Selecionar página
            </label>
            {management.data && management.data.total > pageIds.length && (
              <Button
                size="sm"
                variant={allFiltered ? "default" : "outline"}
                onClick={() => {
                  setAllFiltered(!allFiltered);
                  setSelected(new Set());
                }}
              >
                {allFiltered
                  ? `Todos os ${management.data.total} filtrados selecionados`
                  : `Selecionar todos os ${management.data.total} filtrados`}
              </Button>
            )}
            {selectedCount > 0 && <Badge>{selectedCount} selecionado(s)</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => openOperation("assign")}>
              Distribuir
            </Button>
            <Button size="sm" variant="outline" onClick={() => openOperation("reassign")}>
              Redistribuir
            </Button>
            <Button size="sm" variant="outline" onClick={() => openOperation("return_to_queue")}>
              Devolver à fila
            </Button>
            <Button size="sm" onClick={() => openOperation("balanced")}>
              Distribuição equilibrada
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-12 p-3">Sel.</th>
                <th className="p-3">Lead</th>
                <th className="p-3">PDV</th>
                <th className="p-3">Status</th>
                <th className="p-3">Responsável</th>
                <th className="p-3">Próximo follow-up</th>
                <th className="p-3">Última atividade</th>
              </tr>
            </thead>
            <tbody>
              {management.isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Carregando base…</td></tr>
              ) : management.data?.items.length ? (
                management.data.items.map(lead => (
                  <tr key={lead.id} className="border-t align-top">
                    <td className="p-3">
                      <Checkbox
                        checked={allFiltered || selected.has(lead.id)}
                        onCheckedChange={checked => toggleLead(lead.id, checked === true)}
                        disabled={allFiltered}
                        aria-label={`Selecionar ${lead.name || "lead"}`}
                      />
                    </td>
                    <td className="p-3">
                      <Link href={`/v2/leads/${lead.id}`}>
                        <span className="font-medium hover:underline">{lead.name || "Lead sem nome"}</span>
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">{lead.phone || "Sem telefone"} · {lead.sourceLabel || "Sem origem"}</p>
                    </td>
                    <td className="p-3">{lead.pdvName}</td>
                    <td className="p-3"><Badge variant="outline">{lead.statusLabel}</Badge></td>
                    <td className="p-3">{lead.ownerName || "Sem responsável"}</td>
                    <td className="p-3">{lead.nextFollowUpAt?.toLocaleString("pt-BR") || "—"}</td>
                    <td className="p-3">{lead.lastActivityAt?.toLocaleString("pt-BR") || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Nenhum lead encontrado com estes filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{management.data?.total ?? 0} resultado(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => { setPage(page - 1); resetSelection(); }}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={!management.data || page * management.data.pageSize >= management.data.total} onClick={() => { setPage(page + 1); resetSelection(); }}>Próxima</Button>
          </div>
        </div>
      </CardContent>

      <Dialog open={operation !== null} onOpenChange={open => !open && setOperation(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{operation ? operationLabel[operation] : "Distribuição"}</DialogTitle>
            <DialogDescription>
              {selectedCount} lead(s) da campanha {campaign.name} serão processados no servidor. PDVs: {selectedPdvNames}.
            </DialogDescription>
          </DialogHeader>
          {operation !== "return_to_queue" && operation !== "balanced" && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Vendedor de destino</p>
              <Select value={membershipId} onValueChange={setMembershipId}>
                <SelectTrigger><SelectValue placeholder="Selecione um vendedor" /></SelectTrigger>
                <SelectContent>
                  {eligibleSellers.map(seller => (
                    <SelectItem key={seller.membershipId} value={String(seller.membershipId)}>
                      {seller.name} · carteira ativa: {seller.activeLeadCount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!eligibleSellers.length && (
                <p className="text-xs text-destructive">Nenhum vendedor elegível cobre os PDVs selecionados.</p>
              )}
            </div>
          )}
          {operation === "balanced" && (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              A distribuição usa apenas vendedores ativos com acesso ao PDV de cada lead. Ela prioriza a menor carteira ativa atual e desempata pelo identificador do vendedor.
            </p>
          )}
          {operation === "return_to_queue" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              Leads com follow-up pendente ou pendência de governança serão mantidos na carteira atual e aparecerão como ignorados no resultado.
            </p>
          )}
          <Textarea
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Motivo/origem da alteração (opcional)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOperation(null)}>Cancelar</Button>
            <Button disabled={distribute.isPending || (!membershipId && (operation === "assign" || operation === "reassign"))} onClick={execute}>
              {distribute.isPending ? "Processando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
