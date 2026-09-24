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
import { Textarea } from "@/components/ui/textarea";
import { v2trpc } from "@/lib/v2trpc";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";

type View = "available" | "mine" | "all";

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",", 2)[1] : "";
      if (!base64) {
        reject(new Error("Não foi possível ler o arquivo"));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function EvidenceUploader({
  leadId,
  timelineEventId,
  onUploaded,
}: {
  leadId: number;
  timelineEventId: number;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const upload = v2trpc.evidences.upload.useMutation({
    onSuccess: () => {
      setFile(null);
      onUploaded();
      toast.success("Evidência anexada à tratativa");
    },
    onError: error => toast.error(error.message),
  });
  const send = async () => {
    if (!file) return;
    try {
      upload.mutate({
        leadId,
        timelineEventId,
        fileName: file.name,
        mimeType: file.type,
        base64: await readFileAsBase64(file),
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível ler o arquivo"
      );
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-center">
      <Input
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
        onChange={event => setFile(event.target.files?.[0] ?? null)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!file || upload.isPending}
        onClick={send}
      >
        Anexar evidência
      </Button>
    </div>
  );
}

export default function V2Leads() {
  const [, navigate] = useLocation();
  const initialCampaign =
    typeof window === "undefined"
      ? undefined
      : Number(new URLSearchParams(window.location.search).get("campaignId")) ||
        undefined;
  const [view, setView] = useState<View>("available");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const list = v2trpc.leads.list.useQuery({
    view,
    page,
    pageSize: 25,
    campaignId: initialCampaign,
    search: search || undefined,
  });
  const access = v2trpc.access.context.useQuery();
  const followUpAlerts = v2trpc.followUps.alerts.useQuery();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Operação
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Leads</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Fila disponível e carteira do vendedor usam paginação diretamente no
            banco.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/v2/follow-ups">
            <Button variant="outline">
              Follow-ups
              {(followUpAlerts.data?.overdue ?? 0) +
                (followUpAlerts.data?.today ?? 0) >
                0 && (
                <Badge className="ml-2" variant="destructive">
                  {(followUpAlerts.data?.overdue ?? 0) +
                    (followUpAlerts.data?.today ?? 0)}
                </Badge>
              )}
            </Button>
          </Link>
          <Link href="/v2/campaigns">
            <Button variant="outline">Campanhas</Button>
          </Link>
        </div>
      </header>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Select
            value={view}
            onValueChange={value => {
              setView(value as View);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Fila disponível</SelectItem>
              <SelectItem value="mine">Minha carteira</SelectItem>
              {access.data?.role !== "seller" && (
                <SelectItem value="all">Todos no escopo</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Input
            className="max-w-md"
            placeholder="Buscar nome ou telefone"
            value={search}
            onChange={event => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
      <Card>
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
          {list.data?.items.map(lead => (
            <button
              key={lead.id}
              className="flex w-full flex-col justify-between gap-2 rounded-lg border p-4 text-left hover:bg-muted/40 sm:flex-row sm:items-center"
              onClick={() => navigate(`/v2/leads/${lead.id}`)}
            >
              <div>
                <p className="font-medium">{lead.name || "Lead sem nome"}</p>
                <p className="text-sm text-muted-foreground">
                  {lead.phone || "Sem telefone"} · {lead.campaignName} ·{" "}
                  {lead.pdvName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{lead.statusLabel}</Badge>
                {lead.assignedMembershipId ? (
                  <Badge variant="secondary">Atribuído</Badge>
                ) : (
                  <Badge>Disponível</Badge>
                )}
              </div>
            </button>
          ))}
          {!list.data?.items.length && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado.
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

export function V2LeadDetail() {
  const [, params] = useRoute("/v2/leads/:id");
  const id = Number(params?.id);
  const detail = v2trpc.leads.get.useQuery(
    { id },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const configuration = v2trpc.leads.configuration.useQuery();
  const access = v2trpc.access.context.useQuery();
  const utils = v2trpc.useUtils();
  const [note, setNote] = useState("");
  const [contact, setContact] = useState({
    channel: "whatsapp",
    outcome: "contacted",
    summary: "",
    statusId: "",
    followUpDueAt: "",
    followUpNote: "",
  });
  const [followUp, setFollowUp] = useState({ dueAt: "", note: "" });
  const refresh = () => {
    utils.leads.get.invalidate({ id });
    utils.leads.list.invalidate();
    utils.followUps.alerts.invalidate();
    utils.followUps.list.invalidate();
  };
  const assume = v2trpc.leads.assume.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const addNote = v2trpc.leads.note.useMutation({
    onSuccess: () => {
      setNote("");
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const addContact = v2trpc.leads.contact.useMutation({
    onSuccess: result => {
      setContact({
        channel: "whatsapp",
        outcome: "contacted",
        summary: "",
        statusId: "",
        followUpDueAt: "",
        followUpNote: "",
      });
      refresh();
      if (!result.governance.isComplete) {
        toast.warning(
          "Tratativa registrada como pendente: anexe a evidência solicitada na timeline."
        );
      }
    },
    onError: error => toast.error(error.message),
  });
  const changeStatus = v2trpc.leads.changeStatus.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const createFollowUp = v2trpc.followUps.create.useMutation({
    onSuccess: () => {
      setFollowUp({ dueAt: "", note: "" });
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const completeFollowUp = v2trpc.followUps.complete.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const cancelFollowUp = v2trpc.followUps.cancel.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const downloadEvidence = v2trpc.evidences.download.useMutation({
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: error => toast.error(error.message),
  });
  const removeEvidence = v2trpc.evidences.remove.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const lead = detail.data?.lead;
  if (detail.isLoading)
    return (
      <main className="p-8 text-center text-sm text-muted-foreground">
        Carregando lead…
      </main>
    );
  if (!lead)
    return (
      <main className="p-8 text-center text-sm text-muted-foreground">
        Lead não encontrado ou sem acesso.
      </main>
    );
  const isSeller = access.data?.role === "seller";
  const isOwner = lead.assignedMembershipId === access.data?.membershipId;
  const canWork = !isSeller || isOwner;
  const canManageEvidence =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const governance = detail.data?.effectiveGovernance.rule;
  const hasGovernanceRequirements = Boolean(
    governance?.evidenceRequired ||
      governance?.noteRequired ||
      governance?.followUpRequired
  );
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <Link href="/v2/leads">
        <Button variant="outline">← Leads</Button>
      </Link>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold">
            {lead.name || "Lead sem nome"}
          </h1>
          <Badge>{detail.data?.status?.label}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {lead.phone || "Sem telefone"} · {detail.data?.campaign?.name} ·{" "}
          {detail.data?.pdv?.name} · Responsável:{" "}
          {detail.data?.assignee?.name || "Não atribuído"}
        </p>
      </header>
      {!lead.assignedMembershipId && isSeller && (
        <Button
          onClick={() => assume.mutate({ id })}
          disabled={assume.isPending}
        >
          Assumir lead
        </Button>
      )}
      <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Tratativa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {canWork ? (
              <>
                {hasGovernanceRequirements && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-medium">Exigências desta tratativa</p>
                    <p className="mt-1">
                      {[
                        governance?.noteRequired && "observação",
                        governance?.followUpRequired && "próximo follow-up",
                        governance?.evidenceRequired && "evidência anexada",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      .
                    </p>
                    {governance?.evidenceRequired && (
                      <p className="mt-1 text-xs">
                        A evidência é vinculada ao evento após salvar o contato;
                        até isso a tratativa fica sinalizada como pendente.
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <p className="mb-2 text-sm font-medium">Alterar status</p>
                  <Select
                    value={String(lead.statusId)}
                    onValueChange={value =>
                      changeStatus.mutate({ id, statusId: Number(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {configuration.data?.statuses.map(status => (
                        <SelectItem key={status.id} value={String(status.id)}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <form
                  className="space-y-2"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    addContact.mutate({
                      id,
                      channel: contact.channel,
                      outcome: contact.outcome,
                      summary: contact.summary || null,
                      statusId: contact.statusId
                        ? Number(contact.statusId)
                        : undefined,
                      followUpDueAt: contact.followUpDueAt
                        ? new Date(contact.followUpDueAt)
                        : null,
                      followUpNote: contact.followUpNote || null,
                    });
                  }}
                >
                  <p className="text-sm font-medium">Registrar contato</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={contact.channel}
                      onChange={event =>
                        setContact({ ...contact, channel: event.target.value })
                      }
                      placeholder="Canal"
                    />
                    <Input
                      value={contact.outcome}
                      onChange={event =>
                        setContact({ ...contact, outcome: event.target.value })
                      }
                      placeholder="Resultado"
                    />
                  </div>
                  <Textarea
                    value={contact.summary}
                    onChange={event =>
                      setContact({ ...contact, summary: event.target.value })
                    }
                    placeholder={
                      governance?.noteRequired
                        ? "Resumo do contato (obrigatório)"
                        : "Resumo do contato"
                    }
                    required={governance?.noteRequired}
                  />
                  <Select
                    value={contact.statusId || "unchanged"}
                    onValueChange={value =>
                      setContact({
                        ...contact,
                        statusId: value === "unchanged" ? "" : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Manter status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unchanged">Manter status</SelectItem>
                      {configuration.data?.statuses.map(status => (
                        <SelectItem key={status.id} value={String(status.id)}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      type="datetime-local"
                      value={contact.followUpDueAt}
                      onChange={event =>
                        setContact({
                          ...contact,
                          followUpDueAt: event.target.value,
                        })
                      }
                      required={governance?.followUpRequired}
                      aria-label="Próximo follow-up"
                    />
                    <Input
                      value={contact.followUpNote}
                      onChange={event =>
                        setContact({
                          ...contact,
                          followUpNote: event.target.value,
                        })
                      }
                      placeholder="Motivo do follow-up"
                    />
                  </div>
                  {governance?.followUpRequired && (
                    <p className="text-xs text-muted-foreground">
                      Esta tratativa exige agendar o próximo follow-up.
                    </p>
                  )}
                  <Button disabled={addContact.isPending}>
                    Salvar contato
                  </Button>
                </form>
                <form
                  className="space-y-2"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    addNote.mutate({ id, text: note });
                  }}
                >
                  <p className="text-sm font-medium">Adicionar nota</p>
                  <Textarea
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    placeholder="Observação interna"
                  />
                  <Button
                    variant="outline"
                    disabled={!note.trim() || addNote.isPending}
                  >
                    Salvar nota
                  </Button>
                </form>
                <form
                  className="space-y-2 border-t pt-4"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    if (!followUp.dueAt) return;
                    createFollowUp.mutate({
                      leadId: id,
                      dueAt: new Date(followUp.dueAt),
                      note: followUp.note || null,
                    });
                  }}
                >
                  <p className="text-sm font-medium">Agendar follow-up</p>
                  <Input
                    type="datetime-local"
                    value={followUp.dueAt}
                    onChange={event =>
                      setFollowUp({ ...followUp, dueAt: event.target.value })
                    }
                    required
                  />
                  <Textarea
                    value={followUp.note}
                    onChange={event =>
                      setFollowUp({ ...followUp, note: event.target.value })
                    }
                    placeholder="Motivo ou observação"
                  />
                  <Button
                    disabled={createFollowUp.isPending || !followUp.dueAt}
                  >
                    Criar follow-up
                  </Button>
                </form>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Somente o vendedor responsável pode registrar tratativas neste
                lead.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail.data?.timeline.map(event => {
              const eventEvidences = detail.data.evidences.filter(
                evidence => evidence.timelineEventId === event.id
              );
              const eventGovernance = detail.data.treatmentGovernance.find(
                item => item.timelineEventId === event.id
              );
              const canAttach =
                event.type === "contact" || event.type === "note";
              return (
                <div key={event.id} className="border-l-2 pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{event.type}</p>
                    {eventEvidences.length > 0 && (
                      <Badge variant="secondary">
                        {eventEvidences.length} evidência(s)
                      </Badge>
                    )}
                    {eventGovernance && !eventGovernance.isComplete && (
                      <Badge variant="destructive">
                        Pendência de governança
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {event.occurredAt.toLocaleString("pt-BR")}
                  </p>
                  {Boolean(event.payloadJson) && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {String(JSON.stringify(event.payloadJson))}
                    </p>
                  )}
                  {eventGovernance && !eventGovernance.isComplete && (
                    <p className="mt-2 text-xs text-destructive">
                      {eventGovernance.evidenceSatisfied
                        ? "A tratativa ainda não atende todos os requisitos configurados."
                        : "Evidência anexada pendente para completar esta tratativa."}
                    </p>
                  )}
                  {eventEvidences.map(evidence => (
                    <div
                      key={evidence.id}
                      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"
                    >
                      <span className="font-medium">{evidence.fileName}</span>
                      <Badge variant="outline">{evidence.mimeType}</Badge>
                      <Badge variant="outline">
                        {evidence.deletedAt
                          ? "removida"
                          : evidence.storageStatus}
                      </Badge>
                      {evidence.storageStatus === "available" &&
                        !evidence.deletedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              downloadEvidence.mutate({ id: evidence.id })
                            }
                          >
                            Visualizar com acesso temporário
                          </Button>
                        )}
                      {canManageEvidence && !evidence.deletedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            removeEvidence.mutate({ id: evidence.id })
                          }
                        >
                          Remover
                        </Button>
                      )}
                    </div>
                  ))}
                  {canWork && canAttach && (
                    <EvidenceUploader
                      leadId={id}
                      timelineEventId={event.id}
                      onUploaded={refresh}
                    />
                  )}
                </div>
              );
            })}
            {!detail.data?.timeline.length && (
              <p className="text-sm text-muted-foreground">Sem eventos.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Follow-ups do lead</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Próximo:{" "}
            {lead.nextFollowUpAt
              ? lead.nextFollowUpAt.toLocaleString("pt-BR")
              : "Nenhum"}
          </p>
          {detail.data?.followUps.map(item => (
            <div
              key={item.id}
              className="flex flex-col justify-between gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
            >
              <div>
                <Badge
                  variant={item.status === "pending" ? "outline" : "secondary"}
                >
                  {item.status}
                </Badge>
                <span className="ml-2 text-sm">
                  {item.dueAt.toLocaleString("pt-BR")}
                </span>
                {item.note && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.note}
                  </p>
                )}
              </div>
              {canWork && item.status === "pending" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => completeFollowUp.mutate({ id: item.id })}
                  >
                    Concluir
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => cancelFollowUp.mutate({ id: item.id })}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!detail.data?.followUps.length && (
            <p className="text-sm text-muted-foreground">
              Sem follow-ups registrados.
            </p>
          )}
          <Link href="/v2/follow-ups">
            <Button variant="outline" size="sm">
              Abrir central de follow-ups
            </Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
