import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { followUpStatusLabel } from "@/lib/followUpPresentation";
import { buildV2Path, currentV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import { FollowUpCancellationDialog } from "@/components/v2/FollowUpCancellationDialog";
import {
  FollowUpCompletionDialog,
  type FollowUpCompletionChoice,
} from "@/components/v2/FollowUpCompletionDialog";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { DataTable, PageToolbar } from "@/components/v2/V2Layout";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

type FollowUpView = "overdue" | "today" | "upcoming" | "completed";

const viewLabels: Record<FollowUpView, string> = {
  overdue: "Vencidos",
  today: "Hoje",
  upcoming: "Próximos",
  completed: "Histórico",
};

const membershipRoleLabels: Record<string, string> = {
  partner_admin: "Administrador",
  manager: "Gestor",
  management: "Gestão",
  seller: "Vendedor",
};

function asDateTimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function queryId(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
}

function queryPage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default function V2FollowUps() {
  const initialParams =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const requestedView = initialParams.get("view");
  const initialView: FollowUpView =
    requestedView === "overdue" ||
    requestedView === "today" ||
    requestedView === "upcoming" ||
    requestedView === "completed"
      ? requestedView
      : "overdue";
  const [view, setView] = useState<FollowUpView>(initialView);
  const [page, setPage] = useState(() => queryPage(initialParams.get("page")));
  const [pdvId, setPdvId] = useState(() => queryId(initialParams.get("pdvId")));
  const [ownerMembershipId, setOwnerMembershipId] = useState(() =>
    queryId(initialParams.get("ownerMembershipId"))
  );
  const [campaignId, setCampaignId] = useState(() =>
    queryId(initialParams.get("campaignId"))
  );
  const [reschedule, setReschedule] = useState<Record<number, string>>({});
  const [rescheduleOpen, setRescheduleOpen] = useState<number[]>([]);
  const [cancelTarget, setCancelTarget] = useState<{
    id: number;
    leadName: string;
  } | null>(null);
  const [completeTarget, setCompleteTarget] = useState<{
    id: number;
    leadId: number;
    leadName: string;
  } | null>(null);
  const [, setLocation] = useLocation();
  const access = v2trpc.access.context.useQuery();
  const isReadOnly = access.data?.role === "management";
  const canFilterTeam = Boolean(access.data && access.data.role !== "seller");
  const filterOptions = v2trpc.followUps.filters.useQuery(undefined, {
    enabled: canFilterTeam,
  });
  const utils = v2trpc.useUtils();
  const alerts = v2trpc.followUps.alerts.useQuery();
  const list = v2trpc.followUps.list.useQuery({
    view,
    page,
    pageSize: 25,
    pdvId: pdvId ? Number(pdvId) : undefined,
    campaignId: campaignId ? Number(campaignId) : undefined,
    ownerMembershipId: ownerMembershipId
      ? Number(ownerMembershipId)
      : undefined,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = buildV2Path("/v2/follow-ups", {
      view: view === "overdue" ? undefined : view,
      page: page > 1 ? page : undefined,
      pdvId: pdvId || undefined,
      campaignId: campaignId || undefined,
      ownerMembershipId: ownerMembershipId || undefined,
    });
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current)
      window.history.replaceState(window.history.state, "", target);
  }, [campaignId, ownerMembershipId, page, pdvId, view]);
  const refresh = () => {
    utils.followUps.alerts.invalidate();
    utils.followUps.list.invalidate();
    utils.leads.get.invalidate();
  };
  const complete = v2trpc.followUps.complete.useMutation({
    onSuccess: () => {
      setCompleteTarget(null);
      refresh();
      toast.success("Follow-up concluído.");
    },
    onError: error => toast.error(error.message),
  });
  const cancel = v2trpc.followUps.cancel.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Follow-up cancelado.");
    },
    onError: error => toast.error(error.message),
  });
  const continueCompletionOnLead = (
    choice: Exclude<FollowUpCompletionChoice, "without_contact">
  ) => {
    if (!completeTarget) return;
    setLocation(
      buildV2Path(`/v2/leads/${completeTarget.leadId}`, {
        from: currentV2Path(),
        completeFollowUpId: completeTarget.id,
        completionAction: choice,
      })
    );
  };
  const rescheduleFollowUp = v2trpc.followUps.reschedule.useMutation({
    onSuccess: () => {
      setReschedule({});
      setRescheduleOpen([]);
      refresh();
      toast.success("Follow-up reagendado.");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <main className="v2-page v2-followups-page space-y-6">
      <V2PageHeader
        eyebrow="Operação"
        title="Follow-ups"
        description={`Agenda do parceiro em ${alerts.data?.timezone ?? "…"}. Vencimento é calculado no servidor, não no navegador.`}
      />

      <section className="v2-metric-grid v2-followups-metrics sm:grid-cols-3">
        <Card
          className={`v2-metric-card ${alerts.data?.overdue ? "border-destructive" : ""}`}
        >
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Vencidos</p>
            <p className="text-2xl font-semibold">
              {alerts.data?.overdue ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="v2-metric-card">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Para hoje</p>
            <p className="text-2xl font-semibold">{alerts.data?.today ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="v2-metric-card">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Próxima pendência</p>
            <p className="text-sm font-medium">
              {alerts.data?.nextDueAt
                ? new Date(alerts.data.nextDueAt).toLocaleString("pt-BR")
                : "Nenhuma"}
            </p>
          </CardContent>
        </Card>
      </section>

      <PageToolbar className="v2-followups-toolbar">
          <div className="v2-tab-list" aria-label="Situação de follow-ups">
            {(Object.keys(viewLabels) as FollowUpView[]).map(option => (
              <Button
                key={option}
                size="sm"
                variant="ghost"
                className={view === option ? "is-active" : undefined}
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                  setPage(1);
                }}
              >
                {viewLabels[option]}
              </Button>
            ))}
          </div>
          {canFilterTeam && (
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1 space-y-1.5">
                <label className="text-sm font-medium" htmlFor="followup-pdv">
                  PDV
                </label>
                <Select
                  value={pdvId || "all"}
                  onValueChange={value => {
                    setPdvId(value === "all" ? "" : value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="followup-pdv" className="flex-1">
                    <SelectValue placeholder="Todos os PDVs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os PDVs</SelectItem>
                    {filterOptions.data?.pdvs.map(pdv => (
                      <SelectItem key={pdv.id} value={String(pdv.id)}>
                        {pdv.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <label className="text-sm font-medium" htmlFor="followup-owner">
                  Responsável
                </label>
                <Select
                  value={ownerMembershipId || "all"}
                  onValueChange={value => {
                    setOwnerMembershipId(value === "all" ? "" : value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="followup-owner" className="flex-1">
                    <SelectValue placeholder="Todos os responsáveis" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os responsáveis</SelectItem>
                    {filterOptions.data?.owners.map(owner => (
                      <SelectItem key={owner.id} value={String(owner.id)}>
                        {owner.name} ·{" "}
                        {membershipRoleLabels[owner.role] ?? "Usuário"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
      </PageToolbar>
      {campaignId && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="text-muted-foreground">Contexto aplicado:</span>
            <Badge variant="outline">Campanha selecionada</Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCampaignId("");
                setPage(1);
              }}
            >
              Limpar contexto
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="v2-section-card v2-followups-results">
        <CardHeader>
          <CardTitle>{viewLabels[view]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.data?.items.length ? (
            <>
              <DataTable className="hidden md:block">
                <table>
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Campanha / PDV</th>
                      <th>Data e hora</th>
                      <th>Status</th>
                      <th>Responsável</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.flatMap(item => {
                      const isPending = item.status === "pending";
                      const proposedAt = reschedule[item.id] ?? asDateTimeLocal(item.dueAt);
                      const isRescheduleOpen = rescheduleOpen.includes(item.id);
                      return [
                        <tr key={item.id}>
                          <td><Link href={buildV2Path(`/v2/leads/${item.leadId}`, { from: currentV2Path() })}><span className="font-medium hover:underline">{item.leadName || "Lead sem nome"}</span></Link></td>
                          <td>{item.campaignName} · {item.pdvName}</td>
                          <td>{new Date(item.dueAt).toLocaleString("pt-BR")}</td>
                          <td><Badge variant={item.derivedStatus === "overdue" ? "destructive" : "outline"}>{followUpStatusLabel(item.status, item.derivedStatus)}</Badge></td>
                          <td>{item.ownerName}</td>
                          <td className="text-right">
                            {isPending && !isReadOnly ? <div className="flex justify-end gap-2">
                              <Button size="sm" onClick={() => setCompleteTarget({ id: item.id, leadId: item.leadId, leadName: item.leadName || "este Lead" })}>Concluir</Button>
                              <Button size="sm" variant="outline" onClick={() => setRescheduleOpen(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>Reagendar</Button>
                              <Button size="sm" variant="ghost" onClick={() => setCancelTarget({ id: item.id, leadName: item.leadName || "este Lead" })}>Cancelar</Button>
                            </div> : "—"}
                          </td>
                        </tr>,
                        ...(isRescheduleOpen ? [<tr key={`reschedule-${item.id}`}><td colSpan={6} className="bg-muted/20">
                          <div className="flex items-center gap-2">
                            <Input className="max-w-xs" type="datetime-local" value={proposedAt} onChange={event => setReschedule(current => ({ ...current, [item.id]: event.target.value }))} />
                            <Button size="sm" variant="secondary" disabled={rescheduleFollowUp.isPending || !proposedAt} onClick={() => rescheduleFollowUp.mutate({ id: item.id, dueAt: new Date(proposedAt) })}>Confirmar reagendamento</Button>
                          </div>
                        </td></tr>] : []),
                      ];
                    })}
                  </tbody>
                </table>
              </DataTable>
              <div className="grid gap-2 md:hidden">
          {list.data.items.map(item => {
            const proposedAt =
              reschedule[item.id] ?? asDateTimeLocal(item.dueAt);
            const isPending = item.status === "pending";
            const isRescheduleOpen = rescheduleOpen.includes(item.id);
            const rescheduleId = `follow-up-reschedule-${item.id}`;
            return (
              <article
                key={item.id}
                className={`v2-follow-up-record rounded-lg border p-4 ${item.derivedStatus === "overdue" ? "is-overdue" : ""}`}
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <Link
                      href={buildV2Path(`/v2/leads/${item.leadId}`, {
                        from: currentV2Path(),
                      })}
                    >
                      <span className="cursor-pointer font-medium hover:underline">
                        {item.leadName || "Lead sem nome"}
                      </span>
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {item.campaignName} · {item.pdvName} ·{" "}
                      {item.leadPhone || "Sem telefone"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Responsável: {item.ownerName}
                    </p>
                    {item.note && <p className="mt-2 text-sm">{item.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        item.derivedStatus === "overdue"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {followUpStatusLabel(item.status, item.derivedStatus)}
                    </Badge>
                    <time className="v2-follow-up-due text-sm text-muted-foreground" dateTime={new Date(item.dueAt).toISOString()}>
                      {new Date(item.dueAt).toLocaleString("pt-BR")}
                    </time>
                  </div>
                </div>
                {isPending && !isReadOnly && (
                  <div className="mt-3 space-y-2">
                    <div className="v2-follow-up-actions">
                      <Button
                        size="sm"
                        className="v2-follow-up-complete"
                        disabled={complete.isPending}
                        onClick={() =>
                          setCompleteTarget({
                            id: item.id,
                            leadId: item.leadId,
                            leadName: item.leadName || "este Lead",
                          })
                        }
                      >
                        {complete.isPending ? "Concluindo…" : "Concluir"}
                      </Button>
                      <div className="v2-follow-up-secondary-actions">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-expanded={isRescheduleOpen}
                          aria-controls={rescheduleId}
                          onClick={() =>
                            setRescheduleOpen(current =>
                              current.includes(item.id)
                                ? current.filter(id => id !== item.id)
                                : [...current, item.id]
                            )
                          }
                        >
                          {isRescheduleOpen
                            ? "Fechar reagendamento"
                            : "Reagendar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={cancel.isPending}
                          onClick={() =>
                            setCancelTarget({
                              id: item.id,
                              leadName: item.leadName || "este Lead",
                            })
                          }
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                    {isRescheduleOpen && (
                      <div
                        id={rescheduleId}
                        className="v2-follow-up-reschedule"
                      >
                        <Input
                          className="sm:max-w-xs"
                          type="datetime-local"
                          value={proposedAt}
                          onChange={event =>
                            setReschedule(current => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={rescheduleFollowUp.isPending || !proposedAt}
                          onClick={() =>
                            rescheduleFollowUp.mutate({
                              id: item.id,
                              dueAt: new Date(proposedAt),
                            })
                          }
                        >
                          Confirmar reagendamento
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
              </div>
            </>
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhum follow-up nesta lista.
            </p>
          )}
          <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
            <span>{list.data?.total ?? 0} resultado(s)</span>
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
                disabled={
                  !list.data || page * list.data.pageSize >= list.data.total
                }
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <FollowUpCancellationDialog
        open={Boolean(cancelTarget)}
        onOpenChange={open => !open && setCancelTarget(null)}
        leadName={cancelTarget?.leadName ?? "este Lead"}
        pending={cancel.isPending}
        onConfirm={reason => {
          if (cancelTarget) cancel.mutate({ id: cancelTarget.id, reason });
        }}
      />
      <FollowUpCompletionDialog
        open={completeTarget !== null}
        onOpenChange={open => !open && setCompleteTarget(null)}
        leadName={completeTarget?.leadName ?? "este Lead"}
        pending={complete.isPending}
        onChooseOperationalAction={continueCompletionOnLead}
        onCompleteWithoutContact={reason => {
          if (completeTarget)
            complete.mutate({ id: completeTarget.id, reason });
        }}
      />
    </main>
  );
}
