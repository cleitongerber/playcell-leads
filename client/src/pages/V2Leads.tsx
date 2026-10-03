import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { DataTable, PageToolbar } from "@/components/v2/V2Layout";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { buildV2Path, currentV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

type View = "available" | "mine" | "all";
type AssignmentFilter = "assigned" | "unassigned";
type WorkFilter = "missing" | "recorded";

type LeadListState = {
  view: View;
  page: number;
  search: string;
  campaignId?: number;
  pdvId?: number;
  statusId?: number;
  assignedMembershipId?: number;
  assignment?: AssignmentFilter;
  firstContact?: WorkFilter;
};

function positiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readLeadListState(): LeadListState {
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  const requestedAssignment = params.get("assignment");
  const requestedWork = params.get("firstContact");
  return {
    view:
      requestedView === "available" ||
      requestedView === "mine" ||
      requestedView === "all"
        ? requestedView
        : "available",
    page: positiveInteger(params.get("page")) ?? 1,
    search: params.get("search") ?? "",
    campaignId: positiveInteger(params.get("campaignId")),
    pdvId: positiveInteger(params.get("pdvId")),
    statusId: positiveInteger(params.get("statusId")),
    assignedMembershipId: positiveInteger(params.get("assignedMembershipId")),
    assignment:
      requestedAssignment === "assigned" || requestedAssignment === "unassigned"
        ? requestedAssignment
        : undefined,
    // Kept as a stable URL key; its meaning is now attempt or tratativa.
    firstContact:
      requestedWork === "missing" || requestedWork === "recorded"
        ? requestedWork
        : undefined,
  };
}

export default function V2Leads() {
  const [, navigate] = useLocation();
  const [listState, setListState] = useState<LeadListState>(readLeadListState);
  const {
    view,
    page,
    search,
    campaignId,
    pdvId,
    statusId,
    assignedMembershipId,
    assignment,
    firstContact,
  } = listState;
  const updateListState = (patch: Partial<LeadListState>) =>
    setListState(current => ({ ...current, ...patch }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = buildV2Path("/v2/leads", {
      view: view === "available" ? undefined : view,
      page: page > 1 ? page : undefined,
      search: search || undefined,
      campaignId,
      pdvId,
      statusId,
      assignedMembershipId,
      assignment,
      firstContact,
    });
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current)
      window.history.replaceState(window.history.state, "", target);
  }, [
    assignedMembershipId,
    assignment,
    campaignId,
    firstContact,
    page,
    pdvId,
    search,
    statusId,
    view,
  ]);

  const list = v2trpc.leads.list.useQuery({
    view,
    page,
    pageSize: 25,
    campaignId,
    pdvId,
    statusId,
    assignedMembershipId,
    assignment,
    firstContact,
    search: search || undefined,
  });
  const access = v2trpc.access.context.useQuery();
  const followUpAlerts = v2trpc.followUps.alerts.useQuery();

  return (
    <main className="v2-page v2-leads-page space-y-6">
      <V2PageHeader
        eyebrow="Operação"
        title="Leads"
        description="Fila, carteira e trabalho operacional no contexto autorizado."
        actions={
          (followUpAlerts.data?.overdue ?? 0) +
            (followUpAlerts.data?.today ?? 0) >
          0 ? (
            <Link href="/v2/follow-ups?view=overdue">
              <Badge className="cursor-pointer" variant="destructive">
                {(followUpAlerts.data?.overdue ?? 0) +
                  (followUpAlerts.data?.today ?? 0)}{" "}
                follow-up(s) pendente(s)
              </Badge>
            </Link>
          ) : undefined
        }
      />

      <PageToolbar className="v2-leads-toolbar">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label>Visão</Label>
            <div className="v2-tab-list" aria-label="Visão de Leads">
              {(
                [
                  ["available", "Fila disponível"],
                  ["mine", "Minha carteira"],
                  ...(access.data?.role !== "seller"
                    ? [["all", "Todos no escopo"]]
                    : []),
                ] as Array<[View, string]>
              ).map(([option, label]) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={view === option ? "is-active" : undefined}
                  aria-pressed={view === option}
                  onClick={() => updateListState({ view: option, page: 1 })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="leads-search">Busca</Label>
            <Input
              id="leads-search"
              className="max-w-md"
              placeholder="Buscar nome ou telefone"
              value={search}
              onChange={event =>
                updateListState({ search: event.target.value, page: 1 })
              }
            />
          </div>
      </PageToolbar>

      {(campaignId ||
        pdvId ||
        statusId ||
        assignedMembershipId ||
        assignment ||
        firstContact) && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="text-muted-foreground">Contexto aplicado:</span>
            {campaignId && (
              <Badge variant="outline">Campanha selecionada</Badge>
            )}
            {pdvId && <Badge variant="outline">PDV selecionado</Badge>}
            {statusId && <Badge variant="outline">Situação selecionada</Badge>}
            {assignedMembershipId && (
              <Badge variant="outline">Vendedor selecionado</Badge>
            )}
            {assignment === "assigned" && (
              <Badge variant="outline">Com responsável</Badge>
            )}
            {assignment === "unassigned" && (
              <Badge variant="outline">Sem responsável</Badge>
            )}
            {firstContact === "missing" && (
              <Badge variant="outline">Sem trabalho operacional</Badge>
            )}
            {firstContact === "recorded" && (
              <Badge variant="outline">Com trabalho operacional</Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                updateListState({
                  campaignId: undefined,
                  pdvId: undefined,
                  statusId: undefined,
                  assignedMembershipId: undefined,
                  assignment: undefined,
                  firstContact: undefined,
                  page: 1,
                })
              }
            >
              Limpar contexto
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="v2-section-card v2-leads-results">
        <CardHeader>
          <CardTitle>
            {view === "available"
              ? "Leads disponíveis"
              : view === "mine"
                ? "Minha carteira"
                : "Leads no escopo"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {list.isLoading ? (
            <V2LoadingState label="Carregando leads" />
          ) : list.isError ? (
            <V2ErrorState
              message="Não foi possível carregar os leads."
              onRetry={() => list.refetch()}
            />
          ) : list.data?.items.length ? (
            <>
              <DataTable className="hidden md:block">
                <table>
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Telefone</th>
                      <th>Campanha</th>
                      <th>PDV</th>
                      <th>Situação</th>
                      <th>Responsável</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map(lead => (
                      <tr key={lead.id}>
                        <td className="font-medium">{lead.name || "Lead sem nome"}</td>
                        <td>{lead.phone || "—"}</td>
                        <td>{lead.campaignName || "—"}</td>
                        <td>{lead.pdvName || "—"}</td>
                        <td><Badge variant="outline">{lead.statusLabel}</Badge></td>
                        <td>{lead.assignedMembershipId ? "Atribuído" : "Disponível"}</td>
                        <td className="text-right">
                          <Button size="sm" variant="outline" onClick={() => navigate(buildV2Path(`/v2/leads/${lead.id}`, { from: currentV2Path() }))}>
                            Abrir
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTable>
              <div className="grid gap-2 md:hidden">
              {list.data.items.map(lead => (
              <button
                key={lead.id}
                className="v2-lead-list-item flex w-full flex-col justify-between gap-3 rounded-lg border p-4 text-left hover:bg-muted/40"
                onClick={() =>
                  navigate(
                    buildV2Path(`/v2/leads/${lead.id}`, {
                      from: currentV2Path(),
                    })
                  )
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{lead.name || "Lead sem nome"}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{lead.phone || "Sem telefone"}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                  <Badge variant="outline">{lead.statusLabel}</Badge>
                  {lead.assignedMembershipId ? (
                    <Badge variant="secondary">Atribuído</Badge>
                  ) : (
                    <Badge>Disponível</Badge>
                  )}
                  </div>
                </div>
                <div className="flex items-end justify-between gap-3 text-sm text-muted-foreground">
                  <span className="min-w-0 truncate">{lead.campaignName || "Sem campanha"} · {lead.pdvName || "Sem PDV"}</span>
                  <span className="shrink-0 font-medium text-primary">Abrir</span>
                </div>
              </button>
              ))}
              </div>
            </>
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {view === "available"
                ? "Nenhum lead disponível neste contexto."
                : "Nenhum lead encontrado neste contexto."}
            </p>
          )}
          <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
            <span>{list.data?.total ?? 0} resultado(s)</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => updateListState({ page: page - 1 })}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !list.data || page * list.data.pageSize >= list.data.total
                }
                onClick={() => updateListState({ page: page + 1 })}
              >
                Próxima
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
