import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { DataTable, PageToolbar } from "@/components/v2/V2Layout";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { buildV2Path, currentV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

type View = "available" | "mine" | "all" | "assigned";
type AssignmentFilter = "assigned" | "unassigned";
type WorkFilter = "missing" | "recorded";
type OperationalFilter = "all" | "action" | "unworked" | "returns" | "closed";
type OperationalPriority =
  | "overdue"
  | "today"
  | "unworked"
  | "attempting"
  | "in_progress"
  | "upcoming"
  | "terminal";
type CampaignFilterStatus = "active" | "frozen" | "closed" | "archived" | "all";
type LeadViewOption = View;

type OperationalState = {
  priority: OperationalPriority;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastAttemptChannel: string | null;
  lastAttemptResult: string | null;
  hasEffectiveContact: boolean;
  lastEffectiveContactAt: Date | null;
  nextFollowUpAt: Date | null;
  pendingFollowUpCount: number;
  isTerminal: boolean;
  conversionAt: Date | null;
};

type LeadListState = {
  view: View;
  page: number;
  search: string;
  campaignId?: number;
  campaignStatus: CampaignFilterStatus;
  pdvId?: number;
  statusId?: number;
  assignedMembershipId?: number;
  assignment?: AssignmentFilter;
  firstContact?: WorkFilter;
  operationalFilter: OperationalFilter;
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
  const requestedOperationalFilter = params.get("operationalFilter");
  const requestedCampaignStatus = params.get("campaignStatus");
  const campaignId = positiveInteger(params.get("campaignId"));
  return {
    view:
      requestedView === "available" ||
      requestedView === "mine" ||
      requestedView === "all" ||
      requestedView === "assigned"
        ? requestedView
        : "available",
    page: positiveInteger(params.get("page")) ?? 1,
    search: params.get("search") ?? "",
    campaignId,
    // Contextual links to one campaign retain access to its historical data;
    // regular entry to Leads starts with actionable campaigns only.
    campaignStatus:
      requestedCampaignStatus === "active" ||
      requestedCampaignStatus === "frozen" ||
      requestedCampaignStatus === "closed" ||
      requestedCampaignStatus === "archived" ||
      requestedCampaignStatus === "all"
        ? requestedCampaignStatus
        : campaignId
          ? "all"
          : "active",
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
    operationalFilter:
      requestedOperationalFilter === "action" ||
      requestedOperationalFilter === "unworked" ||
      requestedOperationalFilter === "returns" ||
      requestedOperationalFilter === "closed"
        ? requestedOperationalFilter
        : "all",
  };
}

const operationalFilterLabels: Record<OperationalFilter, string> = {
  all: "Todos",
  action: "Para agir",
  unworked: "Sem atendimento",
  returns: "Retornos",
  closed: "Encerrados",
};

const campaignFilterLabels: Record<CampaignFilterStatus, string> = {
  active: "Ativas",
  frozen: "Congeladas",
  closed: "Fechadas",
  archived: "Arquivadas",
  all: "Todas",
};

const campaignStatusLabels = {
  draft: "Rascunho",
  active: "Ativa",
  closed: "Fechada",
  archived: "Arquivada",
} as const;

function campaignMatchesFilter(
  campaign: { status: keyof typeof campaignStatusLabels; isFrozen: boolean },
  filter: CampaignFilterStatus
) {
  if (filter === "active") return campaign.status === "active" && !campaign.isFrozen;
  if (filter === "frozen") return campaign.status === "active" && campaign.isFrozen;
  if (filter === "closed") return campaign.status === "closed";
  if (filter === "archived") return campaign.status === "archived";
  return campaign.status !== "draft";
}

function campaignAvailabilityLabel(
  status: keyof typeof campaignStatusLabels,
  isFrozen: boolean
) {
  const label = campaignStatusLabels[status];
  return isFrozen ? `${label} · congelada` : label;
}

function pendingReturnsLabel(count: number) {
  return `${count} retorno${count === 1 ? "" : "s"} pendente${count === 1 ? "" : "s"}`;
}

function formatOperationalDate(value: Date | null, timezone: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone ?? undefined,
  }).format(new Date(value));
}

function operationalPresentation(
  operational: OperationalState | null,
  timezone: string | null
) {
  if (!operational) return null;
  const followUpAt = formatOperationalDate(
    operational.nextFollowUpAt,
    timezone
  );
  const lastAttemptAt = formatOperationalDate(
    operational.lastAttemptAt,
    timezone
  );
  const lastContactAt = formatOperationalDate(
    operational.lastEffectiveContactAt,
    timezone
  );
  switch (operational.priority) {
    case "overdue":
      return {
        label: "Retorno vencido",
        detail: followUpAt ? `Previsto em ${followUpAt}` : null,
        variant: "destructive" as const,
      };
    case "today":
      return {
        label: "Retorno hoje",
        detail: followUpAt ? `Hoje, ${followUpAt.split(", ").at(-1)}` : null,
        variant: "secondary" as const,
      };
    case "unworked":
      return {
        label: "Sem atendimento",
        detail: null,
        variant: "secondary" as const,
      };
    case "attempting":
      return {
        label: `${operational.attemptCount} tentativa${operational.attemptCount === 1 ? "" : "s"}`,
        detail: lastAttemptAt ? `Última em ${lastAttemptAt}` : null,
        variant: "outline" as const,
      };
    case "in_progress":
      return {
        label: "Em atendimento",
        detail: lastContactAt ? `Último contato em ${lastContactAt}` : null,
        variant: "secondary" as const,
      };
    case "upcoming":
      return {
        label: "Retorno agendado",
        detail: followUpAt ?? null,
        variant: "outline" as const,
      };
    default:
      return {
        label: "Encerrado",
        detail: operational.conversionAt
          ? `Conversão em ${formatOperationalDate(operational.conversionAt, timezone)}`
          : null,
        variant: "outline" as const,
      };
  }
}

function responsibilityLabel(lead: {
  assignedMembershipId: number | null;
  assigneeName: string | null;
}) {
  if (lead.assignedMembershipId == null) return "Disponível";
  return lead.assigneeName ?? "Responsável indisponível";
}

export default function V2Leads() {
  const [, navigate] = useLocation();
  const [listState, setListState] = useState<LeadListState>(readLeadListState);
  const {
    view,
    page,
    search,
    campaignId,
    campaignStatus,
    pdvId,
    statusId,
    assignedMembershipId,
    assignment,
    firstContact,
    operationalFilter,
  } = listState;
  const [portfolioFiltersOpen, setPortfolioFiltersOpen] = useState(false);
  const [managementFiltersOpen, setManagementFiltersOpen] = useState(false);
  const [portfolioDrawerBoundary, setPortfolioDrawerBoundary] =
    useState<HTMLDivElement | null>(null);
  const [pendingOperationalFilter, setPendingOperationalFilter] =
    useState<OperationalFilter>(operationalFilter);
  const shouldApplyRoleDefault = useRef(
    typeof window !== "undefined" &&
      !new URLSearchParams(window.location.search).has("view")
  );
  const updateListState = (patch: Partial<LeadListState>) =>
    setListState(current => ({ ...current, ...patch }));

  const updateOperationalFilter = (next: OperationalFilter) =>
    updateListState({ operationalFilter: next, page: 1 });
  const campaigns = v2trpc.campaigns.list.useQuery({ includeArchived: true });
  const access = v2trpc.access.context.useQuery();
  const configuration = v2trpc.leads.configuration.useQuery();
  const isManagementView =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin" ||
    access.data?.role === "manager";
  const managementFilters = v2trpc.leads.listFilters.useQuery(undefined, {
    enabled: isManagementView,
  });
  const activeView: LeadViewOption = view;
  const resultsTitle =
    activeView === "available"
      ? "Leads disponíveis"
      : activeView === "mine"
        ? "Minha carteira"
        : activeView === "assigned"
          ? "Leads atribuídos"
          : "Leads no escopo";
  const eligibleSellers = useMemo(
    () =>
      (managementFilters.data?.sellers ?? []).filter(
        seller => !pdvId || seller.pdvIds.includes(pdvId)
      ),
    [managementFilters.data?.sellers, pdvId]
  );
  const eligibleCampaigns = useMemo(
    () =>
      (campaigns.data ?? []).filter(campaign =>
        campaignMatchesFilter(campaign, campaignStatus)
      ),
    [campaignStatus, campaigns.data]
  );

  useEffect(() => {
    if (view === "mine" || operationalFilter === "all") return;
    updateListState({ operationalFilter: "all" });
  }, [operationalFilter, view]);

  useEffect(() => {
    if (!campaignId || campaigns.isLoading) return;
    if (!eligibleCampaigns.some(campaign => campaign.id === campaignId)) {
      updateListState({ campaignId: undefined, page: 1 });
    }
  }, [campaignId, campaigns.isLoading, eligibleCampaigns]);

  useEffect(() => {
    if (!access.data || !shouldApplyRoleDefault.current) return;
    shouldApplyRoleDefault.current = false;
    if (isManagementView) {
      updateListState({ view: "all", assignment: undefined, page: 1 });
    }
  }, [access.data, isManagementView]);

  useEffect(() => {
    if (!assignedMembershipId || !managementFilters.data) return;
    if (!eligibleSellers.some(seller => seller.id === assignedMembershipId)) {
      updateListState({ assignedMembershipId: undefined, page: 1 });
    }
  }, [assignedMembershipId, eligibleSellers, managementFilters.data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = buildV2Path("/v2/leads", {
      view: view === "available" ? undefined : view,
      page: page > 1 ? page : undefined,
      search: search || undefined,
      campaignId,
      campaignStatus: campaignStatus === "active" ? undefined : campaignStatus,
      pdvId,
      statusId,
      assignedMembershipId,
      assignment,
      firstContact,
      operationalFilter:
        view === "mine" && operationalFilter !== "all"
          ? operationalFilter
          : undefined,
    });
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current)
      window.history.replaceState(window.history.state, "", target);
  }, [
    assignedMembershipId,
    assignment,
    campaignId,
    campaignStatus,
    firstContact,
    operationalFilter,
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
    campaignStatus,
    pdvId,
    statusId,
    assignedMembershipId,
    assignment,
    firstContact,
    operationalFilter: view === "mine" ? operationalFilter : undefined,
    search: search || undefined,
  });
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
                {pendingReturnsLabel(
                  (followUpAlerts.data?.overdue ?? 0) +
                    (followUpAlerts.data?.today ?? 0)
                )}
              </Badge>
            </Link>
          ) : undefined
        }
      />

      <PageToolbar className="v2-leads-toolbar">
        <div className="w-full min-w-0 space-y-1.5 md:flex-1">
          <Label>Visão</Label>
          <div className="v2-tab-list" aria-label="Visão de Leads">
            {((
              isManagementView
                ? [
                    ["all", "Todos no escopo"],
                    ["available", "Fila disponível"],
                    ["assigned", "Atribuídos"],
                  ]
                : [
                    ["available", "Fila disponível"],
                    ["mine", "Minha carteira"],
                  ]
            ) as Array<[LeadViewOption, string]>).map(([option, label]) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant="ghost"
                className={activeView === option ? "is-active" : undefined}
                aria-pressed={activeView === option}
                onClick={() => {
                  if (option === "assigned") {
                    updateListState({
                      view: "assigned",
                      assignment: undefined,
                      page: 1,
                      operationalFilter: "all",
                    });
                    return;
                  }
                  updateListState({
                    view: option,
                    assignment: undefined,
                    page: 1,
                    operationalFilter:
                      option === "mine" ? operationalFilter : "all",
                  });
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="w-full min-w-0 space-y-1.5 md:max-w-44">
          <Label htmlFor="leads-campaign-status">Status da campanha</Label>
          <Select
            value={campaignStatus}
            onValueChange={value =>
              updateListState({
                campaignStatus: value as CampaignFilterStatus,
                campaignId: undefined,
                page: 1,
              })
            }
          >
            <SelectTrigger id="leads-campaign-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(campaignFilterLabels) as CampaignFilterStatus[]).map(option => (
                <SelectItem key={option} value={option}>{campaignFilterLabels[option]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full min-w-0 space-y-1.5 md:max-w-64">
          <Label htmlFor="leads-campaign">Campanha</Label>
          <Select
            value={campaignId ? String(campaignId) : "all"}
            onValueChange={value =>
              updateListState({
                campaignId: value === "all" ? undefined : Number(value),
                page: 1,
              })
            }
          >
            <SelectTrigger id="leads-campaign"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as campanhas</SelectItem>
              {eligibleCampaigns.map(campaign => (
                <SelectItem key={campaign.id} value={String(campaign.id)}>{campaign.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full min-w-0 space-y-1.5 md:flex-1">
          <Label htmlFor="leads-search">Busca</Label>
          <Input
            id="leads-search"
            className="w-full max-w-none md:max-w-md"
            placeholder="Buscar nome ou telefone"
            value={search}
            onChange={event =>
              updateListState({ search: event.target.value, page: 1 })
            }
          />
        </div>
        <div className="w-full min-w-0 space-y-1.5 md:max-w-52">
          <Label htmlFor="leads-status">Situação comercial</Label>
          <Select
            value={statusId ? String(statusId) : "all"}
            onValueChange={value =>
              updateListState({
                statusId: value === "all" ? undefined : Number(value),
                page: 1,
              })
            }
          >
            <SelectTrigger id="leads-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(configuration.data?.statuses ?? []).map(status => (
                <SelectItem key={status.id} value={String(status.id)}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isManagementView && (
          <>
            <div className="w-full min-w-0 md:hidden">
              <Drawer
                open={managementFiltersOpen}
                onOpenChange={setManagementFiltersOpen}
              >
                <DrawerTrigger asChild>
                  <Button type="button" variant="outline" className="w-full">
                    <SlidersHorizontal className="mr-2 size-4" /> Filtros da gestão
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="max-h-[90dvh] overflow-y-auto">
                  <DrawerHeader>
                    <DrawerTitle>Filtros da gestão</DrawerTitle>
                    <DrawerDescription>
                      Refine os Leads dentro do escopo autorizado.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="grid gap-4 px-4">
                    <div className="grid gap-2">
                      <Label htmlFor="leads-pdv-mobile">PDV</Label>
                      <Select
                        value={pdvId ? String(pdvId) : "all"}
                        onValueChange={value =>
                          updateListState({
                            pdvId: value === "all" ? undefined : Number(value),
                            assignedMembershipId: undefined,
                            page: 1,
                          })
                        }
                      >
                        <SelectTrigger id="leads-pdv-mobile"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os PDVs</SelectItem>
                          {(managementFilters.data?.pdvs ?? []).map(pdv => (
                            <SelectItem key={pdv.id} value={String(pdv.id)}>{pdv.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="leads-assignee-mobile">Responsável</Label>
                      <Select
                        value={assignedMembershipId ? String(assignedMembershipId) : assignment ?? "all"}
                        onValueChange={value =>
                          updateListState({
                            assignedMembershipId:
                              value === "all" || value === "unassigned" ? undefined : Number(value),
                            assignment: value === "unassigned" ? "unassigned" : undefined,
                            view:
                              value === "all" || value === "unassigned" ? "all" : view,
                            page: 1,
                          })
                        }
                      >
                        <SelectTrigger id="leads-assignee-mobile"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os responsáveis</SelectItem>
                          <SelectItem value="unassigned">Sem responsável</SelectItem>
                          {eligibleSellers.map(seller => (
                            <SelectItem key={seller.id} value={String(seller.id)}>{seller.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DrawerFooter>
                    <Button type="button" onClick={() => setManagementFiltersOpen(false)}>
                      Aplicar
                    </Button>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </div>
            <div className="hidden min-w-0 space-y-1.5 md:block md:max-w-52">
              <Label htmlFor="leads-pdv">PDV</Label>
              <Select
                value={pdvId ? String(pdvId) : "all"}
                onValueChange={value =>
                  updateListState({
                    pdvId: value === "all" ? undefined : Number(value),
                    assignedMembershipId: undefined,
                    page: 1,
                  })
                }
              >
                <SelectTrigger id="leads-pdv"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os PDVs</SelectItem>
                  {(managementFilters.data?.pdvs ?? []).map(pdv => (
                    <SelectItem key={pdv.id} value={String(pdv.id)}>{pdv.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="hidden min-w-0 space-y-1.5 md:block md:max-w-52">
              <Label htmlFor="leads-assignee">Responsável</Label>
              <Select
                value={assignedMembershipId ? String(assignedMembershipId) : assignment ?? "all"}
                onValueChange={value =>
                  updateListState({
                    assignedMembershipId:
                      value === "all" || value === "unassigned" ? undefined : Number(value),
                    assignment: value === "unassigned" ? "unassigned" : undefined,
                    view:
                      value === "all" || value === "unassigned" ? "all" : view,
                    page: 1,
                  })
                }
              >
                <SelectTrigger id="leads-assignee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os responsáveis</SelectItem>
                  <SelectItem value="unassigned">Sem responsável</SelectItem>
                  {eligibleSellers.map(seller => (
                    <SelectItem key={seller.id} value={String(seller.id)}>{seller.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        {view === "mine" && (
          <>
            <div className="w-full min-w-0 md:hidden">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Filtros</p>
                  <p className="text-xs text-muted-foreground">
                    Prioridade: {operationalFilterLabels[operationalFilter]}
                  </p>
                </div>
                <Drawer
                  open={portfolioFiltersOpen}
                  onOpenChange={setPortfolioFiltersOpen}
                >
                  <DrawerTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setPendingOperationalFilter(operationalFilter)
                      }
                    >
                      <SlidersHorizontal className="mr-2 size-4" /> Ajustar
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent
                    ref={setPortfolioDrawerBoundary}
                    className="max-h-[90dvh] overflow-y-auto"
                  >
                    <DrawerHeader>
                      <DrawerTitle>Filtros da carteira</DrawerTitle>
                      <DrawerDescription>
                        Refine a prioridade dos Leads da sua carteira.
                      </DrawerDescription>
                    </DrawerHeader>
                    <div className="grid gap-2 px-4">
                      <Label htmlFor="portfolio-operational-filter">
                        Prioridade operacional
                      </Label>
                      <Select
                        value={pendingOperationalFilter}
                        onValueChange={value =>
                          setPendingOperationalFilter(
                            value as OperationalFilter
                          )
                        }
                      >
                        <SelectTrigger id="portfolio-operational-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          side="bottom"
                          align="start"
                          sideOffset={4}
                          collisionBoundary={
                            portfolioDrawerBoundary ?? undefined
                          }
                          collisionPadding={12}
                          className="z-[60]"
                        >
                          {(
                            Object.keys(
                              operationalFilterLabels
                            ) as OperationalFilter[]
                          ).map(option => (
                            <SelectItem key={option} value={option}>
                              {operationalFilterLabels[option]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <DrawerFooter className="flex-row justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setPendingOperationalFilter("all");
                          updateOperationalFilter("all");
                          setPortfolioFiltersOpen(false);
                        }}
                      >
                        Limpar
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          updateOperationalFilter(pendingOperationalFilter);
                          setPortfolioFiltersOpen(false);
                        }}
                      >
                        Aplicar
                      </Button>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              </div>
            </div>
            <div className="hidden min-w-0 flex-1 space-y-1.5 md:block">
              <Label>Prioridade operacional</Label>
              <div
                className="v2-tab-list"
                aria-label="Prioridade operacional da carteira"
              >
                {(
                  Object.keys(operationalFilterLabels) as OperationalFilter[]
                ).map(option => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={
                      operationalFilter === option ? "is-active" : undefined
                    }
                    aria-pressed={operationalFilter === option}
                    onClick={() => updateOperationalFilter(option)}
                  >
                    {operationalFilterLabels[option]}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
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
              <Badge variant="outline">{campaignFilterLabels[campaignStatus]}{": campanha selecionada"}</Badge>
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
                  campaignStatus: "active",
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
          <CardTitle>{resultsTitle}</CardTitle>
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
                      <th>Status da campanha</th>
                      <th>PDV</th>
                      <th>Situação comercial</th>
                      <th>{view === "mine" ? "Operação" : "Responsável"}</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map(lead => (
                      <tr key={lead.id}>
                        <td className="font-medium">
                          {lead.name || "Lead sem nome"}
                        </td>
                        <td>{lead.phone || "—"}</td>
                        <td>{lead.campaignName || "—"}</td>
                        <td>
                          <Badge variant="outline">
                            {lead.campaignFrozen
                              ? campaignAvailabilityLabel(lead.campaignStatus, true)
                              : campaignAvailabilityLabel(lead.campaignStatus, false)}
                          </Badge>
                        </td>
                        <td>{lead.pdvName || "—"}</td>
                        <td>
                          {(() => {
                            const presentation = operationalPresentation(
                              lead.operational,
                              list.data?.timezone ?? null
                            );
                            return (
                              <div className="space-y-1">
                                <Badge variant="outline">{lead.statusLabel}</Badge>
                                {view !== "mine" && presentation && (
                                  <div>
                                    <Badge variant={presentation.variant}>
                                      {presentation.label}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td>
                          {view === "mine"
                            ? (() => {
                                const presentation = operationalPresentation(
                                  lead.operational,
                                  list.data?.timezone ?? null
                                );
                                return presentation ? (
                                  <div className="space-y-1">
                                    <Badge variant={presentation.variant}>
                                      {presentation.label}
                                    </Badge>
                                    {presentation.detail && (
                                      <p className="text-xs text-muted-foreground">
                                        {presentation.detail}
                                      </p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      Responsável: {responsibilityLabel(lead)}
                                    </p>
                                  </div>
                                ) : (
                                  "—"
                                );
                              })()
                            : (
                                <div className="space-y-1">
                                  <span>{responsibilityLabel(lead)}</span>
                                  {(lead.campaignStatus !== "active" ||
                                    lead.campaignFrozen) && (
                                    <p className="text-xs text-muted-foreground">
                                      Consulta
                                    </p>
                                  )}
                                </div>
                              )}
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigate(
                                buildV2Path(`/v2/leads/${lead.id}`, {
                                  from: currentV2Path(),
                                })
                              )
                            }
                          >
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
                    {(() => {
                      const presentation = operationalPresentation(
                        lead.operational,
                        list.data?.timezone ?? null
                      );
                      return (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">
                                {lead.name || "Lead sem nome"}
                              </p>
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {lead.phone || "Sem telefone"}
                              </p>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Badge variant="outline">
                                {lead.statusLabel}
                              </Badge>
                              {presentation ? (
                                <Badge variant={presentation.variant}>
                                  {presentation.label}
                                </Badge>
                              ) : (
                                <Badge>Disponível</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-end justify-between gap-3 text-sm text-muted-foreground">
                            <span className="min-w-0 truncate">
                              {lead.campaignName || "Sem campanha"} ·{" "}
                              {lead.pdvName || "Sem PDV"}
                              {lead.campaignStatus !== "active" || lead.campaignFrozen
                                ? ` · ${campaignAvailabilityLabel(lead.campaignStatus, lead.campaignFrozen)}`
                                : ""}
                              {view === "mine" && presentation?.detail
                                ? ` · ${presentation.detail}`
                                : ""}
                            </span>
                            <span className="shrink-0 font-medium text-primary">
                              Abrir
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Responsável: {responsibilityLabel(lead)}
                          </p>
                        </>
                      );
                    })()}
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
