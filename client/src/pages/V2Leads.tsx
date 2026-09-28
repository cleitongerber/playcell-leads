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
import { Label } from "@/components/ui/label";
import { v2trpc } from "@/lib/v2trpc";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { FollowUpCancellationDialog } from "@/components/v2/FollowUpCancellationDialog";
import { followUpStatusLabel } from "@/lib/followUpPresentation";
import { useV2Session } from "@/components/v2/V2AppShell";
import {
  buildV2Path,
  currentV2Path,
  safeV2ReturnPath,
} from "@/lib/operationalNavigation";
import { presentTimelineEvent } from "@/lib/timelinePresentation";
import {
  DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
  buildTelephoneUrl,
  buildWhatsAppUrl,
  renderWhatsAppInitialMessage,
} from "@shared/whatsappContact";
import { MessageCircle, PhoneCall } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";

type View = "available" | "mine" | "all";
type AssignmentFilter = "assigned" | "unassigned";
type FirstContactFilter = "missing" | "recorded";

type ExternalContactChannel = "whatsapp" | "phone";

const externalContactStorageKey = (leadId: number) =>
  `v2-external-contact-action:${leadId}`;

function preferredShortcutChannel(
  action: ExternalContactChannel,
  allowedChannels: string[] | null | undefined
) {
  const candidates =
    action === "whatsapp"
      ? ["whatsapp", "whats app"]
      : ["ligação", "ligacao", "telefone", "phone"];
  const configured = allowedChannels?.find(channel =>
    candidates.includes(channel.trim().toLowerCase())
  );
  return configured ?? (action === "whatsapp" ? "whatsapp" : "ligação");
}

function isShortcutChannelAllowed(
  action: ExternalContactChannel,
  allowedChannels: string[] | null | undefined
) {
  if (!allowedChannels?.length) return true;
  const candidates =
    action === "whatsapp"
      ? ["whatsapp", "whats app"]
      : ["ligação", "ligacao", "telefone", "phone"];
  return allowedChannels.some(channel =>
    candidates.includes(channel.trim().toLowerCase())
  );
}

function evidenceRequiredForCurrentChannel(
  rule:
    | {
        evidenceRequired: boolean;
        evidenceRequiredChannels?: string[] | null;
      }
    | null
    | undefined,
  channel: string
) {
  if (!rule) return false;
  if (rule.evidenceRequired) return true;
  return Boolean(
    rule.evidenceRequiredChannels?.some(
      item => item.trim().toLowerCase() === channel.trim().toLowerCase()
    )
  );
}

type LeadListState = {
  view: View;
  page: number;
  search: string;
  campaignId?: number;
  pdvId?: number;
  statusId?: number;
  assignedMembershipId?: number;
  assignment?: AssignmentFilter;
  firstContact?: FirstContactFilter;
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
  const view: View =
    requestedView === "available" ||
    requestedView === "mine" ||
    requestedView === "all"
      ? requestedView
      : "available";
  const requestedAssignment = params.get("assignment");
  const requestedFirstContact = params.get("firstContact");
  return {
    view,
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
    firstContact:
      requestedFirstContact === "missing" ||
      requestedFirstContact === "recorded"
        ? requestedFirstContact
        : undefined,
  };
}

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
    <main className="v2-page space-y-6">
      <V2PageHeader
        eyebrow="Operação"
        title="Leads"
        description="Fila disponível e carteira do vendedor usam paginação diretamente no banco."
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
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="leads-view">Visão</Label>
            <Select
              value={view}
              onValueChange={value => {
                updateListState({ view: value as View, page: 1 });
              }}
            >
              <SelectTrigger id="leads-view" className="w-full sm:w-48">
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
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="leads-search">Busca</Label>
            <Input
              id="leads-search"
              className="max-w-md"
              placeholder="Buscar nome ou telefone"
              value={search}
              onChange={event => {
                updateListState({ search: event.target.value, page: 1 });
              }}
            />
          </div>
        </CardContent>
      </Card>
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
            {statusId && <Badge variant="outline">Status selecionado</Badge>}
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
              <Badge variant="outline">Sem primeiro contato</Badge>
            )}
            {firstContact === "recorded" && (
              <Badge variant="outline">Com primeiro contato</Badge>
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
          {list.isLoading ? (
            <V2LoadingState label="Carregando leads" />
          ) : list.isError ? (
            <V2ErrorState
              message="Não foi possível carregar os leads."
              onRetry={() => list.refetch()}
            />
          ) : list.data?.items.length ? (
            list.data.items.map(lead => (
              <button
                key={lead.id}
                className="v2-lead-list-item flex w-full flex-col justify-between gap-2 rounded-lg border p-4 text-left hover:bg-muted/40 sm:flex-row sm:items-center"
                onClick={() =>
                  navigate(
                    buildV2Path(`/v2/leads/${lead.id}`, {
                      from: currentV2Path(),
                    })
                  )
                }
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
            ))
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

export function V2LeadDetail() {
  const [, params] = useRoute("/v2/leads/:id");
  const id = Number(params?.id);
  const session = useV2Session();
  const returnTo = safeV2ReturnPath(
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("from"),
    "/v2/leads"
  );
  const detail = v2trpc.leads.get.useQuery(
    { id },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const configuration = v2trpc.leads.configuration.useQuery();
  const access = v2trpc.access.context.useQuery();
  const whatsappTemplate = v2trpc.partnerSettings.whatsappTemplate.useQuery();
  const utils = v2trpc.useUtils();
  const [note, setNote] = useState("");
  const [contact, setContact] = useState({
    channel: "whatsapp",
    outcome: "",
    summary: "",
    statusId: "",
    followUpDueAt: "",
    followUpNote: "",
  });
  const [followUp, setFollowUp] = useState({ dueAt: "", note: "" });
  const [followUpToCancel, setFollowUpToCancel] = useState<number | null>(null);
  const [externalContactHint, setExternalContactHint] =
    useState<ExternalContactChannel | null>(null);
  const restoredExternalContactForLead = useRef<number | null>(null);
  const refresh = () => {
    utils.leads.get.invalidate({ id });
    utils.leads.list.invalidate();
    utils.followUps.alerts.invalidate();
    utils.followUps.list.invalidate();
  };
  const assume = v2trpc.leads.assume.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Lead assumido. Você já pode registrar a tratativa.");
    },
    onError: error => toast.error(error.message),
  });
  const addNote = v2trpc.leads.note.useMutation({
    onSuccess: () => {
      setNote("");
      refresh();
      toast.success("Nota adicionada à timeline.");
    },
    onError: error => toast.error(error.message),
  });
  const addContact = v2trpc.leads.contact.useMutation({
    onSuccess: result => {
      setContact({
        channel: "whatsapp",
        outcome: "",
        summary: "",
        statusId: "",
        followUpDueAt: "",
        followUpNote: "",
      });
      try {
        sessionStorage.removeItem(externalContactStorageKey(id));
      } catch {
        // A restored shortcut is only UX assistance; storage is optional.
      }
      setExternalContactHint(null);
      refresh();
      if (!result.governance.isComplete) {
        toast.warning(
          "Tratativa registrada como pendente: anexe a evidência solicitada na timeline."
        );
      } else {
        toast.success("Tratativa registrada.");
      }
    },
    onError: error => toast.error(error.message),
  });
  const changeStatus = v2trpc.leads.changeStatus.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Status do lead atualizado.");
    },
    onError: error => toast.error(error.message),
  });
  const createFollowUp = v2trpc.followUps.create.useMutation({
    onSuccess: () => {
      setFollowUp({ dueAt: "", note: "" });
      refresh();
      toast.success("Follow-up agendado.");
    },
    onError: error => toast.error(error.message),
  });
  const completeFollowUp = v2trpc.followUps.complete.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Follow-up concluído.");
    },
    onError: error => toast.error(error.message),
  });
  const cancelFollowUp = v2trpc.followUps.cancel.useMutation({
    onSuccess: () => {
      setFollowUpToCancel(null);
      refresh();
      toast.success("Follow-up cancelado.");
    },
    onError: error => toast.error(error.message),
  });
  const downloadEvidence = v2trpc.evidences.download.useMutation({
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: error => toast.error(error.message),
  });
  const removeEvidence = v2trpc.evidences.remove.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Evidência removida.");
    },
    onError: error => toast.error(error.message),
  });
  const contactGovernance = detail.data?.effectiveGovernance.rule;
  useEffect(() => {
    if (
      detail.isLoading ||
      !Number.isInteger(id) ||
      id < 1 ||
      restoredExternalContactForLead.current === id
    ) {
      return;
    }
    restoredExternalContactForLead.current = id;
    try {
      const raw = sessionStorage.getItem(externalContactStorageKey(id));
      if (!raw) return;
      const persisted = JSON.parse(raw) as {
        action?: ExternalContactChannel;
        at?: number;
      };
      const action = persisted.action;
      if (
        (action !== "whatsapp" && action !== "phone") ||
        !persisted.at ||
        Date.now() - persisted.at > 30 * 60 * 1000
      ) {
        sessionStorage.removeItem(externalContactStorageKey(id));
        return;
      }
      setContact(current => ({
        ...current,
        channel: preferredShortcutChannel(
          action,
          contactGovernance?.allowedChannels
        ),
        outcome: "",
      }));
      setExternalContactHint(action);
    } catch {
      // An unavailable or malformed browser storage value must never affect a
      // Lead or create a commercial event.
    }
  }, [id, detail.isLoading, contactGovernance?.allowedChannels]);
  const lead = detail.data?.lead;
  if (detail.isLoading)
    return (
      <main className="v2-page">
        <V2LoadingState label="Carregando lead" />
      </main>
    );
  if (!lead)
    return (
      <main className="v2-page">
        <V2ErrorState message="Lead não encontrado ou sem acesso." />
      </main>
    );
  const isSeller = access.data?.role === "seller";
  const isOwner = lead.assignedMembershipId === access.data?.membershipId;
  // A system Super Admin can supervise every tenant, but is not itself an
  // operational actor in a partner. Contact records require a membership so
  // that their author remains auditable.
  const hasOperationalMembership = Boolean(access.data?.membershipId);
  const canWork = hasOperationalMembership && (!isSeller || isOwner);
  const canManageEvidence =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const governance = contactGovernance;
  const directPhone = lead.phone || lead.normalizedPhone;
  const telephoneUrl = buildTelephoneUrl(directPhone);
  const selectedChannelRequiresEvidence = evidenceRequiredForCurrentChannel(
    governance,
    contact.channel
  );
  const hasGovernanceRequirements = Boolean(
    selectedChannelRequiresEvidence ||
      governance?.noteRequired ||
      governance?.followUpRequired
  );
  const shortcutChannel = (action: ExternalContactChannel) =>
    preferredShortcutChannel(action, governance?.allowedChannels);
  const canRegisterWhatsApp = isShortcutChannelAllowed(
    "whatsapp",
    governance?.allowedChannels
  );
  const canRegisterPhone = isShortcutChannelAllowed(
    "phone",
    governance?.allowedChannels
  );
  const rememberExternalContact = (action: ExternalContactChannel) => {
    setContact(current => ({
      ...current,
      channel: shortcutChannel(action),
      // The user must explicitly declare what happened; opening an app is not
      // a successful contact and should not be silently saved as one.
      outcome: "",
    }));
    setExternalContactHint(action);
    try {
      sessionStorage.setItem(
        externalContactStorageKey(id),
        JSON.stringify({ action, at: Date.now() })
      );
    } catch {
      // Do not make an external contact action depend on web storage.
    }
  };
  const openWhatsApp = () => {
    const message = renderWhatsAppInitialMessage(
      whatsappTemplate.data?.template ??
        DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
      {
        nome: lead.name,
        vendedor: session.name,
        pdv: detail.data?.pdv?.name,
        campanha: detail.data?.campaign?.name,
      }
    );
    const url = buildWhatsAppUrl(directPhone, message);
    if (!url) {
      toast.error("O telefone deste Lead não é válido para abrir o WhatsApp.");
      return;
    }
    rememberExternalContact("whatsapp");
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      window.location.assign(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  const openTelephone = () => {
    const url = buildTelephoneUrl(directPhone);
    if (!url) {
      toast.error(
        "O telefone deste Lead não é válido para realizar uma ligação."
      );
      return;
    }
    rememberExternalContact("phone");
    window.location.assign(url);
  };
  return (
    <main className="v2-page space-y-6">
      <V2PageHeader
        eyebrow="Lead"
        title={lead.name || "Lead sem nome"}
        description={`${lead.phone || "Sem telefone"} · ${detail.data?.campaign?.name} · ${detail.data?.pdv?.name} · Responsável: ${detail.data?.assignee?.name || "Não atribuído"}`}
        actions={
          <>
            <Badge>{detail.data?.status?.label}</Badge>
            {canWork && (
              <Button asChild>
                <a href="#register-treatment">Registrar tratativa</a>
              </Button>
            )}
            <Link href={returnTo}>
              <Button variant="outline">← Leads</Button>
            </Link>
          </>
        }
      />
      {!lead.assignedMembershipId && isSeller && (
        <Button
          onClick={() => assume.mutate({ id })}
          disabled={assume.isPending}
        >
          {assume.isPending ? "Assumindo…" : "Assumir lead"}
        </Button>
      )}
      <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
        <Card className="v2-lead-treatment-card">
          <CardHeader>
            <CardTitle>Tratativa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {access.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Carregando permissões operacionais…
              </p>
            ) : canWork ? (
              <>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">Contato direto</p>
                      <p className="text-sm text-muted-foreground">
                        {lead.phone || "Telefone não informado"}
                      </p>
                    </div>
                    <div className="v2-contact-shortcuts flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          !telephoneUrl ||
                          !canRegisterWhatsApp ||
                          whatsappTemplate.isLoading ||
                          whatsappTemplate.isError
                        }
                        onClick={openWhatsApp}
                      >
                        <MessageCircle className="mr-2 size-4" />
                        {whatsappTemplate.isLoading
                          ? "Preparando mensagem…"
                          : "Abrir WhatsApp"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!telephoneUrl || !canRegisterPhone}
                        onClick={openTelephone}
                      >
                        <PhoneCall className="mr-2 size-4" />
                        Ligar para o Lead
                      </Button>
                    </div>
                  </div>
                  {!telephoneUrl ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Informe um telefone válido com DDD para usar os atalhos de
                      contato.
                    </p>
                  ) : !canRegisterWhatsApp || !canRegisterPhone ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      O atalho fica disponível quando o respectivo canal estiver
                      autorizado pela governança desta campanha.
                    </p>
                  ) : whatsappTemplate.isError ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Não foi possível carregar a mensagem configurada do
                      parceiro. Tente recarregar antes de abrir o WhatsApp.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Abrir o aplicativo não registra um contato. Ao retornar,
                      informe o resultado real da tentativa.
                    </p>
                  )}
                </div>
                {externalContactHint && (
                  <div
                    className="rounded-md border border-brand-secondary/35 bg-brand-accent/10 p-3 text-sm text-foreground"
                    role="status"
                  >
                    {externalContactHint === "whatsapp"
                      ? "WhatsApp preparado. Registre o resultado da tentativa de contato pelo WhatsApp."
                      : "Ligação iniciada. Registre o resultado real da tentativa de ligação."}
                  </div>
                )}
                {hasGovernanceRequirements && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                    <p className="font-medium">Exigências desta tratativa</p>
                    <p className="mt-1">
                      {[
                        governance?.noteRequired && "observação",
                        governance?.followUpRequired && "próximo follow-up",
                        selectedChannelRequiresEvidence && "evidência anexada",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      .
                    </p>
                    {selectedChannelRequiresEvidence && (
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
                    <SelectTrigger disabled={changeStatus.isPending}>
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
                  id="register-treatment"
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
                  <p className="text-sm font-medium">Registrar tratativa</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-channel">Canal</Label>
                      <Input
                        id="contact-channel"
                        value={contact.channel}
                        onChange={event =>
                          setContact({
                            ...contact,
                            channel: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-outcome">Resultado</Label>
                      <Input
                        id="contact-outcome"
                        value={contact.outcome}
                        required
                        onChange={event =>
                          setContact({
                            ...contact,
                            outcome: event.target.value,
                          })
                        }
                        placeholder="Ex.: atendido, sem resposta, retorno solicitado"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-summary">
                      Resumo {governance?.noteRequired && "(obrigatório)"}
                    </Label>
                    <Textarea
                      id="contact-summary"
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
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-status">Status após contato</Label>
                    <Select
                      value={contact.statusId || "unchanged"}
                      onValueChange={value =>
                        setContact({
                          ...contact,
                          statusId: value === "unchanged" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger id="contact-status">
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
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-follow-up">
                        Próximo follow-up{" "}
                        {governance?.followUpRequired && "(obrigatório)"}
                      </Label>
                      <Input
                        id="contact-follow-up"
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
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-follow-up-note">
                        Motivo do follow-up
                      </Label>
                      <Input
                        id="contact-follow-up-note"
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
                  </div>
                  {governance?.followUpRequired && (
                    <p className="text-xs text-muted-foreground">
                      Esta tratativa exige agendar o próximo follow-up.
                    </p>
                  )}
                  <Button disabled={addContact.isPending}>
                    {addContact.isPending ? "Registrando…" : "Salvar tratativa"}
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
                    {addNote.isPending ? "Salvando…" : "Salvar nota"}
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
                  <Label htmlFor="follow-up-due-at">Data e hora</Label>
                  <Input
                    id="follow-up-due-at"
                    type="datetime-local"
                    value={followUp.dueAt}
                    onChange={event =>
                      setFollowUp({ ...followUp, dueAt: event.target.value })
                    }
                    required
                  />
                  <Label htmlFor="follow-up-note">Motivo ou observação</Label>
                  <Textarea
                    id="follow-up-note"
                    value={followUp.note}
                    onChange={event =>
                      setFollowUp({ ...followUp, note: event.target.value })
                    }
                    placeholder="Motivo ou observação"
                  />
                  <Button
                    disabled={createFollowUp.isPending || !followUp.dueAt}
                  >
                    {createFollowUp.isPending
                      ? "Agendando…"
                      : "Criar follow-up"}
                  </Button>
                </form>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {!hasOperationalMembership
                  ? "O Super Admin possui visão administrativa deste parceiro. Para registrar tratativas, entre com um usuário que tenha acesso operacional ativo ao parceiro."
                  : "Somente o vendedor responsável pode registrar tratativas neste lead."}
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
              const presentation = presentTimelineEvent(
                event.type,
                event.payloadJson
              );
              const eventEvidences = detail.data.evidences.filter(
                evidence => evidence.timelineEventId === event.id
              );
              const uploadedEvidences = eventEvidences.filter(
                evidence =>
                  !evidence.deletedAt && evidence.storageStatus === "available"
              );
              const eventGovernance = detail.data.treatmentGovernance.find(
                item => item.timelineEventId === event.id
              );
              const canAttach =
                event.type === "contact" || event.type === "note";
              return (
                <div
                  key={event.id}
                  className="border-l-2 border-brand-accent pl-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{presentation.title}</p>
                    {uploadedEvidences.length > 0 && (
                      <Badge variant="secondary">
                        {uploadedEvidences.length} evidência(s)
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
                  {presentation.description && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {presentation.description}
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
                          : evidence.storageStatus === "available"
                            ? "disponível"
                            : evidence.storageStatus === "failed"
                              ? "falha no envio"
                              : "enviando"}
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
                          disabled={removeEvidence.isPending}
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
                  {followUpStatusLabel(item.status)}
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
                    disabled={completeFollowUp.isPending}
                    onClick={() => completeFollowUp.mutate({ id: item.id })}
                  >
                    {completeFollowUp.isPending ? "Concluindo…" : "Concluir"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cancelFollowUp.isPending}
                    onClick={() => setFollowUpToCancel(item.id)}
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
      <FollowUpCancellationDialog
        open={followUpToCancel !== null}
        onOpenChange={open => !open && setFollowUpToCancel(null)}
        leadName={lead.name || "este Lead"}
        pending={cancelFollowUp.isPending}
        onConfirm={() => {
          if (followUpToCancel !== null) {
            cancelFollowUp.mutate({ id: followUpToCancel });
          }
        }}
      />
    </main>
  );
}
