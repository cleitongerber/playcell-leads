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
import { v2trpc } from "@/lib/v2trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

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
  seller: "Vendedor",
};

function asDateTimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function V2FollowUps() {
  const requestedView =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("view");
  const initialView: FollowUpView =
    requestedView === "overdue" ||
    requestedView === "today" ||
    requestedView === "upcoming" ||
    requestedView === "completed"
      ? requestedView
      : "overdue";
  const [view, setView] = useState<FollowUpView>(initialView);
  const [page, setPage] = useState(1);
  const [pdvId, setPdvId] = useState("");
  const [ownerMembershipId, setOwnerMembershipId] = useState("");
  const [reschedule, setReschedule] = useState<Record<number, string>>({});
  const access = v2trpc.access.context.useQuery();
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
    ownerMembershipId: ownerMembershipId
      ? Number(ownerMembershipId)
      : undefined,
  });
  const refresh = () => {
    utils.followUps.alerts.invalidate();
    utils.followUps.list.invalidate();
    utils.leads.get.invalidate();
  };
  const complete = v2trpc.followUps.complete.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const cancel = v2trpc.followUps.cancel.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const rescheduleFollowUp = v2trpc.followUps.reschedule.useMutation({
    onSuccess: () => {
      setReschedule({});
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Operação
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Follow-ups</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Agenda do parceiro em {alerts.data?.timezone ?? "…"}. Vencimento é
            calculado no servidor, não no navegador.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/v2/leads">
            <Button variant="outline">Leads</Button>
          </Link>
          <Link href="/v2/dashboard">
            <Button variant="outline">Dashboard</Button>
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card className={alerts.data?.overdue ? "border-destructive" : ""}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Vencidos</p>
            <p className="text-2xl font-semibold">
              {alerts.data?.overdue ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Para hoje</p>
            <p className="text-2xl font-semibold">{alerts.data?.today ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
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

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(viewLabels) as FollowUpView[]).map(option => (
              <Button
                key={option}
                size="sm"
                variant={view === option ? "default" : "outline"}
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
              <Select
                value={pdvId || "all"}
                onValueChange={value => {
                  setPdvId(value === "all" ? "" : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="flex-1">
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
              <Select
                value={ownerMembershipId || "all"}
                onValueChange={value => {
                  setOwnerMembershipId(value === "all" ? "" : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="flex-1">
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{viewLabels[view]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.data?.items.map(item => {
            const proposedAt =
              reschedule[item.id] ?? asDateTimeLocal(item.dueAt);
            const isPending = item.status === "pending";
            return (
              <article key={item.id} className="rounded-lg border p-4">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <Link href={`/v2/leads/${item.leadId}`}>
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
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        item.derivedStatus === "overdue"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {followUpStatusLabel(item.status, item.derivedStatus)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {new Date(item.dueAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>
                {isPending && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      size="sm"
                      onClick={() => complete.mutate({ id: item.id })}
                    >
                      Concluir
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancel.mutate({ id: item.id })}
                    >
                      Cancelar
                    </Button>
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
                      Reagendar
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
          {!list.data?.items.length && (
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
    </main>
  );
}
