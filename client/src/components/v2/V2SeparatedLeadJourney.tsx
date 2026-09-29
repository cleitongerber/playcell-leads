import { FollowUpCancellationDialog } from "@/components/v2/FollowUpCancellationDialog";
import { LeadEvidenceUploader } from "@/components/v2/LeadEvidenceUploader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { useV2Session } from "@/components/v2/V2AppShell";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { followUpStatusLabel } from "@/lib/followUpPresentation";
import {
  presentNextLeadAction,
  type BackendNextLeadAction,
} from "@/lib/leadJourneyPresentation";
import {
  buildV2Path,
  currentV2Path,
  safeV2ReturnPath,
} from "@/lib/operationalNavigation";
import { presentTimelineEvent } from "@/lib/timelinePresentation";
import { v2trpc } from "@/lib/v2trpc";
import {
  DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
  buildTelephoneUrl,
  buildWhatsAppUrl,
  renderWhatsAppInitialMessage,
} from "@shared/whatsappContact";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileUp,
  MessageCircle,
  PhoneCall,
  RotateCcw,
  ShieldCheck,
  StickyNote,
  UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";

type ExternalContactChannel = "whatsapp" | "phone";
type ExternalContactPrompt = ExternalContactChannel | "phone_outcome";

type AttemptForm = {
  channel: string;
  resultId: string;
  summary: string;
  followUpDueAt: string;
  followUpNote: string;
};

type TreatmentForm = AttemptForm & {
  finalStatusId: string;
};

type FormRequirements = {
  canOperate: boolean;
  blockedReason: string | null;
  allowedChannels: string[] | null;
  requirements: {
    summaryRequired: boolean;
    evidenceRequired: boolean;
    followUp: { required: boolean; allowed: boolean };
  };
  status: {
    policy: "none" | "suggest" | "require";
    suggested: { id: number; label: string; isTerminal: boolean } | null;
    canOverrideSuggestedStatus: boolean;
  };
  result: { conversionMode: "none" | "eligible" } | null;
  statuses: Array<{ id: number; label: string; isTerminal: boolean }>;
};

const externalContactStorageKey = (leadId: number) =>
  `v2-external-contact-action:${leadId}`;

const emptyAttempt = (channel = "whatsapp"): AttemptForm => ({
  channel,
  resultId: "",
  summary: "",
  followUpDueAt: "",
  followUpNote: "",
});

const emptyTreatment = (channel = "whatsapp"): TreatmentForm => ({
  ...emptyAttempt(channel),
  finalStatusId: "",
});

function makeRequestKey(operation: string) {
  const entropy =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${operation}-${entropy}`;
}

function directChannelFor(
  action: ExternalContactChannel,
  allowedChannels: string[] | null | undefined
) {
  const candidates =
    action === "whatsapp"
      ? ["whatsapp", "whats app"]
      : ["ligação", "ligacao", "telefone", "phone"];
  return (
    allowedChannels?.find(channel =>
      candidates.includes(channel.trim().toLowerCase())
    ) ?? (action === "whatsapp" ? "whatsapp" : "ligação")
  );
}

function isPendingStatus(status: string) {
  return status === "pending";
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Não programado";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Não programado"
    : date.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

function requirementTone(
  tone: "brand" | "warning" | "danger" | "success" | "muted"
) {
  switch (tone) {
    case "danger":
      return "border-danger/35 bg-danger/10";
    case "warning":
      return "border-warning/40 bg-warning/10";
    case "success":
      return "border-success/35 bg-success/10";
    case "muted":
      return "border-border bg-muted/30";
    default:
      return "border-brand-accent/35 bg-brand-accent/10";
  }
}

function ChannelField({
  id,
  value,
  allowedChannels,
  onChange,
}: {
  id: string;
  value: string;
  allowedChannels: string[] | null | undefined;
  onChange: (value: string) => void;
}) {
  if (allowedChannels?.length) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>Canal</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Selecione o canal" />
          </SelectTrigger>
          <SelectContent>
            {allowedChannels.map(channel => (
              <SelectItem key={channel} value={channel}>
                {channel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Canal</Label>
      <Input
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Ex.: WhatsApp, ligação ou presencial"
      />
    </div>
  );
}

function ResultField({
  id,
  value,
  items,
  onChange,
}: {
  id: string;
  value: string;
  items: Array<{ id: number; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Resultado</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Selecione o resultado" />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FollowUpFields({
  prefix,
  value,
  required,
  onChange,
}: {
  prefix: string;
  value: Pick<AttemptForm, "followUpDueAt" | "followUpNote">;
  required: boolean;
  onChange: (
    patch: Partial<Pick<AttemptForm, "followUpDueAt" | "followUpNote">>
  ) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-due-at`}>
          Quando devemos retornar? {required && "(obrigatório)"}
        </Label>
        <Input
          id={`${prefix}-due-at`}
          type="datetime-local"
          value={value.followUpDueAt}
          required={required}
          onChange={event => onChange({ followUpDueAt: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-note`}>Observação</Label>
        <Input
          id={`${prefix}-note`}
          value={value.followUpNote}
          onChange={event => onChange({ followUpNote: event.target.value })}
          placeholder="Motivo ou orientação"
        />
      </div>
    </div>
  );
}

/**
 * Operational Lead workspace for the explicitly enabled separated journey.
 * It only arranges commands and backend-provided requirements; no commercial
 * consequence is inferred in this component.
 */
export function V2SeparatedLeadJourney() {
  const [, params] = useRoute("/v2/leads/:id");
  const id = Number(params?.id);
  const session = useV2Session();
  const returnTo = safeV2ReturnPath(
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("from"),
    "/v2/leads"
  );
  const utils = v2trpc.useUtils();
  const detail = v2trpc.leads.get.useQuery(
    { id },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const access = v2trpc.access.context.useQuery();
  const configuration = v2trpc.leads.configuration.useQuery();
  const nextAction = v2trpc.leads.nextAction.useQuery(
    { leadId: id },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const whatsappTemplate = v2trpc.partnerSettings.whatsappTemplate.useQuery();
  const attemptResults = v2trpc.interactionResults.available.useQuery(
    { interactionKind: "attempt" },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const treatmentResults = v2trpc.interactionResults.available.useQuery(
    { interactionKind: "effective_contact" },
    { enabled: Number.isInteger(id) && id > 0 }
  );

  const [attemptOpen, setAttemptOpen] = useState(false);
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [externalPrompt, setExternalPrompt] =
    useState<ExternalContactPrompt | null>(null);
  const [attempt, setAttempt] = useState<AttemptForm>(emptyAttempt());
  const [treatment, setTreatment] = useState<TreatmentForm>(emptyTreatment());
  const [attemptFollowUpOpen, setAttemptFollowUpOpen] = useState(false);
  const [treatmentFollowUpOpen, setTreatmentFollowUpOpen] = useState(false);
  const [attemptRequestKey, setAttemptRequestKey] = useState<string | null>(
    null
  );
  const [treatmentRequestKey, setTreatmentRequestKey] = useState<string | null>(
    null
  );
  const [pendingEvidenceEventId, setPendingEvidenceEventId] = useState<
    number | null
  >(null);
  const [independentFollowUpOpen, setIndependentFollowUpOpen] = useState(false);
  const [independentFollowUp, setIndependentFollowUp] = useState({
    dueAt: "",
    note: "",
  });
  const [followUpToCancel, setFollowUpToCancel] = useState<number | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [adminStatusOpen, setAdminStatusOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [administrativeStatus, setAdministrativeStatus] = useState({
    statusId: "",
    reason: "",
  });
  const [reopen, setReopen] = useState({ statusId: "", reason: "" });
  const [administrativeRequestKey, setAdministrativeRequestKey] = useState<
    string | null
  >(null);
  const [reopenRequestKey, setReopenRequestKey] = useState<string | null>(null);
  const restoredExternalActionForLead = useRef<number | null>(null);
  const lastSuggestedResultId = useRef<string | null>(null);

  const attemptRequirements = v2trpc.leads.operationRequirements.useQuery(
    {
      leadId: id,
      operationKind: "attempt",
      channel: attempt.channel || undefined,
      resultId: attempt.resultId ? Number(attempt.resultId) : undefined,
    },
    { enabled: Number.isInteger(id) && id > 0 && attemptOpen }
  );
  const treatmentRequirements = v2trpc.leads.operationRequirements.useQuery(
    {
      leadId: id,
      operationKind: "effective_contact",
      channel: treatment.channel || undefined,
      resultId: treatment.resultId ? Number(treatment.resultId) : undefined,
    },
    { enabled: Number.isInteger(id) && id > 0 && treatmentOpen }
  );

  const refresh = () => {
    utils.leads.get.invalidate({ id });
    utils.leads.nextAction.invalidate({ leadId: id });
    utils.leads.operationRequirements.invalidate();
    utils.leads.list.invalidate();
    utils.followUps.alerts.invalidate();
    utils.followUps.list.invalidate();
  };

  const assume = v2trpc.leads.assume.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Lead assumido. Você já pode trabalhar neste atendimento.");
    },
    onError: error => toast.error(error.message),
  });
  const registerAttempt = v2trpc.leads.registerAttempt.useMutation({
    onSuccess: result => {
      const hasPendingEvidence = result.pendingRequirements.some(
        requirement => requirement.kind === "evidence"
      );
      setPendingEvidenceEventId(
        hasPendingEvidence ? result.timelineEvent.id : null
      );
      setAttempt(emptyAttempt());
      setAttemptFollowUpOpen(false);
      setAttemptRequestKey(null);
      setAttemptOpen(false);
      clearExternalPrompt(id);
      refresh();
      if (hasPendingEvidence) {
        toast.warning(
          "Tentativa registrada. A evidência continua pendente para este evento."
        );
      } else {
        toast.success(
          `Tentativa registrada. Próxima ação: ${presentNextLeadAction(result.nextAction as BackendNextLeadAction).title}.`
        );
      }
    },
    onError: error => toast.error(error.message),
  });
  const recordTreatment = v2trpc.leads.recordEffectiveContact.useMutation({
    onSuccess: result => {
      const hasPendingEvidence = result.pendingRequirements.some(
        requirement => requirement.kind === "evidence"
      );
      setPendingEvidenceEventId(
        hasPendingEvidence ? result.timelineEvent.id : null
      );
      setTreatment(emptyTreatment());
      setTreatmentFollowUpOpen(false);
      setTreatmentRequestKey(null);
      setTreatmentOpen(false);
      clearExternalPrompt(id);
      refresh();
      if (result.conversion) {
        toast.success("Lead convertido. A venda foi registrada na tratativa.");
      } else if (hasPendingEvidence) {
        toast.warning(
          "Tratativa registrada. Falta adicionar a evidência solicitada."
        );
      } else {
        toast.success(
          `Tratativa registrada. Próxima ação: ${presentNextLeadAction(result.nextAction as BackendNextLeadAction).title}.`
        );
      }
    },
    onError: error => toast.error(error.message),
  });
  const addNote = v2trpc.leads.note.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Nota interna adicionada ao histórico.");
    },
    onError: error => toast.error(error.message),
  });
  const createFollowUp = v2trpc.followUps.create.useMutation({
    onSuccess: () => {
      setIndependentFollowUp({ dueAt: "", note: "" });
      setIndependentFollowUpOpen(false);
      refresh();
      toast.success("Tarefa de follow-up agendada.");
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
  const adjustAdministrativeStatus =
    v2trpc.leads.changeAdministrativeStatus.useMutation({
      onSuccess: () => {
        setAdministrativeStatus({ statusId: "", reason: "" });
        setAdministrativeRequestKey(null);
        setAdminStatusOpen(false);
        refresh();
        toast.success("Situação ajustada administrativamente.");
      },
      onError: error => toast.error(error.message),
    });
  const reopenLead = v2trpc.leads.reopen.useMutation({
    onSuccess: () => {
      setReopen({ statusId: "", reason: "" });
      setReopenRequestKey(null);
      setReopenOpen(false);
      refresh();
      toast.success("Lead reaberto. O histórico foi preservado.");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (
      detail.isLoading ||
      !Number.isInteger(id) ||
      id < 1 ||
      restoredExternalActionForLead.current === id
    ) {
      return;
    }
    restoredExternalActionForLead.current = id;
    try {
      const raw = sessionStorage.getItem(externalContactStorageKey(id));
      if (!raw) return;
      const persisted = JSON.parse(raw) as {
        action?: ExternalContactChannel;
        at?: number;
      };
      if (
        (persisted.action !== "whatsapp" && persisted.action !== "phone") ||
        !persisted.at ||
        Date.now() - persisted.at > 30 * 60 * 1000
      ) {
        sessionStorage.removeItem(externalContactStorageKey(id));
        return;
      }
      setExternalPrompt(persisted.action);
    } catch {
      // The shortcut context is optional UX state, never a commercial fact.
    }
  }, [detail.isLoading, id]);

  useEffect(() => {
    const requirements = treatmentRequirements.data as
      | FormRequirements
      | undefined;
    if (!treatment.resultId || !requirements?.status.suggested) return;
    if (lastSuggestedResultId.current === treatment.resultId) return;
    lastSuggestedResultId.current = treatment.resultId;
    setTreatment(current =>
      current.resultId === treatment.resultId
        ? {
            ...current,
            finalStatusId: String(requirements.status.suggested?.id ?? ""),
          }
        : current
    );
  }, [treatment.resultId, treatmentRequirements.data]);

  const lead = detail.data?.lead;
  const action = nextAction.data as BackendNextLeadAction | undefined;
  const actionPresentation = action ? presentNextLeadAction(action) : null;
  const isSeller = access.data?.role === "seller";
  const isOwner = lead?.assignedMembershipId === access.data?.membershipId;
  const hasOperationalMembership = Boolean(access.data?.membershipId);
  const canOperateOwnLead = Boolean(
    hasOperationalMembership && (!isSeller || isOwner)
  );
  const canManageFollowUps = canOperateOwnLead;
  const canAdministerStatus = Boolean(
    access.data && access.data.role !== "seller"
  );
  const canManageEvidence =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const isTerminal = Boolean(detail.data?.status?.isTerminal);
  const commercialActionsBlocked =
    action?.kind === "campaign_not_operational" || isTerminal;
  const canStartCommercialWork = canOperateOwnLead && !commercialActionsBlocked;
  const directPhone = lead?.phone || lead?.normalizedPhone;
  const telephoneUrl = buildTelephoneUrl(directPhone);

  const pendingGovernance = useMemo(
    () =>
      (detail.data?.treatmentGovernance ?? []).filter(
        governance => !governance.isComplete
      ),
    [detail.data?.treatmentGovernance]
  );
  const evidencePending = useMemo(
    () => pendingGovernance.filter(governance => !governance.evidenceSatisfied),
    [pendingGovernance]
  );
  const pendingFollowUps = useMemo(
    () =>
      (detail.data?.followUps ?? []).filter(item =>
        isPendingStatus(item.status)
      ),
    [detail.data?.followUps]
  );
  const timelineById = useMemo(
    () =>
      new Map((detail.data?.timeline ?? []).map(event => [event.id, event])),
    [detail.data?.timeline]
  );
  const selectedEvidenceEventId =
    pendingEvidenceEventId ?? evidencePending[0]?.timelineEventId ?? null;
  const selectedEvidenceEvent = selectedEvidenceEventId
    ? timelineById.get(selectedEvidenceEventId)
    : null;
  const timeline = useMemo(
    () => [...(detail.data?.timeline ?? [])].reverse(),
    [detail.data?.timeline]
  );
  const latestInteraction = timeline.find(event =>
    ["contact", "contact_attempted", "effective_contact_recorded"].includes(
      event.type
    )
  );
  const latestInteractionPresentation = latestInteraction
    ? presentTimelineEvent(
        latestInteraction.type,
        latestInteraction.payloadJson
      )
    : null;
  const visibleTimeline = timelineExpanded ? timeline : timeline.slice(0, 5);
  const followUpNeedsAttention =
    action?.kind === "complete_overdue_follow_up" ||
    action?.kind === "complete_today_follow_up";

  if (detail.isLoading || nextAction.isLoading) {
    return (
      <main className="v2-page">
        <V2LoadingState label="Carregando área de trabalho" />
      </main>
    );
  }
  if (!lead || !actionPresentation) {
    return (
      <main className="v2-page">
        <V2ErrorState
          message="Não foi possível carregar a jornada operacional deste Lead."
          onRetry={() => {
            detail.refetch();
            nextAction.refetch();
          }}
        />
      </main>
    );
  }

  const openAttempt = (channel: string) => {
    setAttempt(emptyAttempt(channel));
    setAttemptFollowUpOpen(false);
    setAttemptRequestKey(null);
    setAttemptOpen(true);
  };
  const openTreatment = (channel: string) => {
    lastSuggestedResultId.current = null;
    setTreatment(emptyTreatment(channel));
    setTreatmentFollowUpOpen(false);
    setTreatmentRequestKey(null);
    setTreatmentOpen(true);
  };
  const clearExternal = () => {
    clearExternalPrompt(id);
    setExternalPrompt(null);
  };
  const rememberExternal = (channel: ExternalContactChannel) => {
    setExternalPrompt(channel);
    try {
      sessionStorage.setItem(
        externalContactStorageKey(id),
        JSON.stringify({ action: channel, at: Date.now() })
      );
    } catch {
      // No storage is required to preserve the no-contact-on-click rule.
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
    rememberExternal("whatsapp");
    if (window.matchMedia("(max-width: 767px)").matches) {
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
    rememberExternal("phone");
    window.location.assign(url);
  };
  const submitAttempt = (event: FormEvent) => {
    event.preventDefault();
    const requirements = attemptRequirements.data as
      | FormRequirements
      | undefined;
    if (!requirements || attemptRequirements.isFetching) {
      toast.error("Aguarde a atualização dos requisitos desta tentativa.");
      return;
    }
    if (!attempt.resultId) {
      toast.error("Selecione o resultado da tentativa.");
      return;
    }
    if (requirements && !requirements.canOperate) {
      toast.error(
        requirements.blockedReason ?? "Esta ação não está disponível."
      );
      return;
    }
    const shouldSchedule =
      Boolean(requirements?.requirements.followUp.required) ||
      attemptFollowUpOpen;
    if (shouldSchedule && !attempt.followUpDueAt) {
      toast.error("Informe quando devemos realizar a próxima tentativa.");
      return;
    }
    const requestKey = attemptRequestKey ?? makeRequestKey("attempt");
    if (!attemptRequestKey) setAttemptRequestKey(requestKey);
    registerAttempt.mutate({
      leadId: id,
      channel: attempt.channel,
      resultId: Number(attempt.resultId),
      summary: attempt.summary.trim() || null,
      followUp:
        shouldSchedule && attempt.followUpDueAt
          ? {
              dueAt: new Date(attempt.followUpDueAt),
              note: attempt.followUpNote.trim() || null,
            }
          : null,
      requestKey,
    });
  };
  const submitTreatment = (event: FormEvent) => {
    event.preventDefault();
    const requirements = treatmentRequirements.data as
      | FormRequirements
      | undefined;
    if (!requirements || treatmentRequirements.isFetching) {
      toast.error("Aguarde a atualização dos requisitos desta tratativa.");
      return;
    }
    if (!treatment.resultId) {
      toast.error("Selecione o resultado da tratativa.");
      return;
    }
    if (requirements && !requirements.canOperate) {
      toast.error(
        requirements.blockedReason ?? "Esta ação não está disponível."
      );
      return;
    }
    const shouldSchedule =
      Boolean(requirements?.requirements.followUp.required) ||
      treatmentFollowUpOpen;
    if (shouldSchedule && !treatment.followUpDueAt) {
      toast.error("Informe quando devemos retornar ao cliente.");
      return;
    }
    const requestKey = treatmentRequestKey ?? makeRequestKey("treatment");
    if (!treatmentRequestKey) setTreatmentRequestKey(requestKey);
    recordTreatment.mutate({
      leadId: id,
      channel: treatment.channel,
      resultId: Number(treatment.resultId),
      summary: treatment.summary.trim() || null,
      finalStatusId: treatment.finalStatusId
        ? Number(treatment.finalStatusId)
        : null,
      followUp:
        shouldSchedule && treatment.followUpDueAt
          ? {
              dueAt: new Date(treatment.followUpDueAt),
              note: treatment.followUpNote.trim() || null,
            }
          : null,
      expectedStatusId: lead.statusId,
      requestKey,
    });
  };

  return (
    <main className="v2-page v2-lead-journey space-y-5">
      <V2PageHeader
        eyebrow="Área de trabalho"
        title={lead.name || "Lead sem nome"}
        description={`${lead.phone || "Sem telefone"} · ${detail.data?.campaign?.name ?? "Campanha não informada"} · ${detail.data?.pdv?.name ?? "PDV não informado"}`}
        actions={
          <>
            <Badge>
              {detail.data?.status?.label ?? "Situação não informada"}
            </Badge>
            <Link href={returnTo}>
              <Button variant="outline">
                <ArrowLeft className="mr-2 size-4" /> Leads
              </Button>
            </Link>
          </>
        }
      />

      {!lead.assignedMembershipId && isSeller && (
        <Card className="border-brand-accent/35 bg-brand-accent/10">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <UserRound className="mt-0.5 size-5 shrink-0 text-brand-primary" />
              <div>
                <p className="font-medium">
                  Este Lead está disponível na fila.
                </p>
                <p className="text-sm text-muted-foreground">
                  Assuma o atendimento antes de registrar uma ação comercial.
                </p>
              </div>
            </div>
            <Button
              onClick={() => assume.mutate({ id })}
              disabled={assume.isPending}
            >
              {assume.isPending ? "Assumindo…" : "Assumir Lead"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.8fr)]">
        <div className="min-w-0 space-y-5">
          <Card className="border-brand-secondary/25">
            <CardHeader className="pb-3">
              <p className="v2-eyebrow">Situação atual</p>
              <CardTitle className="text-xl">
                {actionPresentation.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">
                {actionPresentation.description}
              </p>
              <div className="v2-mobile-detail-grid text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-5">
                <span>
                  Responsável
                  <strong>
                    {detail.data?.assignee?.name ?? "Não atribuído"}
                  </strong>
                </span>
                <span>
                  PDV
                  <strong>{detail.data?.pdv?.name ?? "Não informado"}</strong>
                </span>
                <span>
                  Campanha
                  <strong>
                    {detail.data?.campaign?.name ?? "Não informada"}
                  </strong>
                </span>
                <span>
                  Próximo retorno
                  <strong>{formatDateTime(lead.nextFollowUpAt)}</strong>
                </span>
                <span>
                  Última interação
                  <strong>
                    {latestInteractionPresentation?.title ??
                      "Ainda não registrada"}
                  </strong>
                  {latestInteraction && (
                    <small className="mt-1 block text-xs">
                      {formatDateTime(latestInteraction.occurredAt)}
                    </small>
                  )}
                </span>
              </div>
              {actionPresentation.cta === "evidence" &&
                selectedEvidenceEventId && (
                  <Button
                    type="button"
                    onClick={() =>
                      setPendingEvidenceEventId(selectedEvidenceEventId)
                    }
                  >
                    <FileUp className="mr-2 size-4" /> Adicionar evidência
                  </Button>
                )}
              {actionPresentation.cta === "treatment" &&
                canStartCommercialWork && (
                  <Button
                    type="button"
                    onClick={() => openTreatment("whatsapp")}
                  >
                    Registrar tratativa
                  </Button>
                )}
              {actionPresentation.cta === "contact" &&
                canStartCommercialWork && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={
                        !telephoneUrl ||
                        whatsappTemplate.isLoading ||
                        whatsappTemplate.isError
                      }
                      onClick={openWhatsApp}
                    >
                      <MessageCircle className="mr-2 size-4" /> Abrir WhatsApp
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!telephoneUrl}
                      onClick={openTelephone}
                    >
                      <PhoneCall className="mr-2 size-4" /> Ligar
                    </Button>
                  </div>
                )}
            </CardContent>
          </Card>

          {externalPrompt && (
            <Card
              className="border-brand-accent/40 bg-brand-accent/10"
              role="status"
            >
              <CardContent className="space-y-3 py-4">
                <div className="flex gap-3">
                  {externalPrompt === "whatsapp" ? (
                    <MessageCircle className="mt-0.5 size-5 shrink-0 text-brand-primary" />
                  ) : (
                    <PhoneCall className="mt-0.5 size-5 shrink-0 text-brand-primary" />
                  )}
                  <div>
                    <p className="font-medium">
                      {externalPrompt === "whatsapp"
                        ? "Você enviou a mensagem ao cliente?"
                        : externalPrompt === "phone_outcome"
                          ? "Conseguiu falar com o cliente?"
                          : "Você realizou a ligação?"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Abrir um aplicativo não registra nenhuma ação. Confirme
                      somente o que realmente aconteceu.
                    </p>
                  </div>
                </div>
                {externalPrompt !== "phone_outcome" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        if (externalPrompt === "whatsapp") {
                          clearExternal();
                          openAttempt(
                            directChannelFor(
                              "whatsapp",
                              (
                                attemptRequirements.data as
                                  | FormRequirements
                                  | undefined
                              )?.allowedChannels
                            )
                          );
                        } else {
                          // A real conversation cannot be inferred from a dialer.
                          // Ask one additional question before choosing the command.
                          setExternalPrompt("phone_outcome");
                        }
                      }}
                    >
                      {externalPrompt === "whatsapp" ? "Sim, enviei" : "Sim"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearExternal}
                    >
                      {externalPrompt === "whatsapp" ? "Não enviei" : "Não"}
                    </Button>
                  </div>
                )}
                {externalPrompt === "phone_outcome" && (
                  <div className="rounded-md border border-border bg-background/70 p-3">
                    <p className="mt-1 text-xs text-muted-foreground">
                      Uma conversa deve ser registrada como tratativa; ausência
                      de interação é uma tentativa.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          clearExternal();
                          openTreatment(
                            directChannelFor(
                              "phone",
                              (
                                treatmentRequirements.data as
                                  | FormRequirements
                                  | undefined
                              )?.allowedChannels
                            )
                          );
                        }}
                      >
                        Sim, registrar tratativa
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          clearExternal();
                          openAttempt(
                            directChannelFor(
                              "phone",
                              (
                                attemptRequirements.data as
                                  | FormRequirements
                                  | undefined
                              )?.allowedChannels
                            )
                          );
                        }}
                      >
                        Não, registrar tentativa
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <p className="v2-eyebrow">Agir</p>
              <CardTitle>Atendimento do Lead</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canStartCommercialWork ? (
                <div className="flex gap-3 rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {action?.kind === "campaign_not_operational"
                      ? "Esta campanha está encerrada. Novas tentativas e tratativas não podem ser registradas."
                      : isTerminal
                        ? "Este Lead está concluído. Use Reabrir Lead, quando tiver permissão, antes de uma nova ação comercial."
                        : !hasOperationalMembership
                          ? "É necessário acesso operacional ativo para registrar ações neste Lead."
                          : "Somente o responsável pode registrar uma ação comercial neste Lead."}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      className="sm:flex-1"
                      variant="outline"
                      disabled={
                        !telephoneUrl ||
                        whatsappTemplate.isLoading ||
                        whatsappTemplate.isError
                      }
                      onClick={openWhatsApp}
                    >
                      <MessageCircle className="mr-2 size-4" />
                      {whatsappTemplate.isLoading
                        ? "Preparando…"
                        : "Abrir WhatsApp"}
                    </Button>
                    <Button
                      type="button"
                      className="sm:flex-1"
                      variant="outline"
                      disabled={!telephoneUrl}
                      onClick={openTelephone}
                    >
                      <PhoneCall className="mr-2 size-4" /> Ligar
                    </Button>
                  </div>
                  {!telephoneUrl && (
                    <p className="text-xs text-muted-foreground">
                      Informe um telefone válido com DDD para usar os atalhos de
                      contato.
                    </p>
                  )}
                  {telephoneUrl && whatsappTemplate.isError && (
                    <p className="text-xs text-muted-foreground">
                      Não foi possível carregar a mensagem configurada.
                      Recarregue a página antes de abrir o WhatsApp.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      onClick={() => openTreatment("whatsapp")}
                    >
                      Registrar tratativa
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setIndependentFollowUpOpen(true)}
                    >
                      <CalendarClock className="mr-2 size-4" /> Agendar tarefa
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    WhatsApp e ligação apenas abrem o canal. A tentativa ou a
                    tratativa é sempre registrada depois, com o resultado
                    declarado por você.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {pendingGovernance.length > 0 ||
          followUpNeedsAttention ||
          (isTerminal && pendingFollowUps.length > 0) ? (
            <Card className="border-warning/35">
              <CardHeader>
                <p className="v2-eyebrow">Pendências</p>
                <CardTitle>O que ainda precisa de atenção</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingGovernance.map(governance => {
                  const event = timelineById.get(governance.timelineEventId);
                  const title = event
                    ? presentTimelineEvent(event.type, event.payloadJson).title
                    : "Evento operacional";
                  const needsEvidence = !governance.evidenceSatisfied;
                  return (
                    <div
                      key={governance.timelineEventId}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <CircleAlert className="size-4 text-warning" />
                        <p className="text-sm font-medium">{title}</p>
                        <Badge variant="outline">Pendente</Badge>
                      </div>
                      {needsEvidence && (
                        <p className="mt-2 text-sm font-medium">
                          Evidência pendente
                        </p>
                      )}
                      <p className="mt-1 text-sm text-muted-foreground">
                        {needsEvidence
                          ? "Esta ação exige evidência para ficar completa."
                          : "Esta ação ainda não atende todos os requisitos configurados."}
                      </p>
                      {needsEvidence && canOperateOwnLead && (
                        <Button
                          type="button"
                          size="sm"
                          className="mt-3"
                          onClick={() =>
                            setPendingEvidenceEventId(
                              governance.timelineEventId
                            )
                          }
                        >
                          <FileUp className="mr-2 size-4" /> Adicionar evidência
                        </Button>
                      )}
                    </div>
                  );
                })}
                {followUpNeedsAttention && (
                  <div className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CalendarClock className="size-4 text-warning" />
                      <p className="text-sm font-medium">
                        {actionPresentation.title}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {actionPresentation.description}
                    </p>
                    {canStartCommercialWork && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3"
                        onClick={() => openTreatment("whatsapp")}
                      >
                        Registrar tratativa
                      </Button>
                    )}
                  </div>
                )}
                {isTerminal && pendingFollowUps.length > 0 && (
                  <div className="rounded-md border border-border bg-muted/25 p-3 text-sm">
                    <p className="font-medium">
                      Follow-up anterior à conclusão
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Existe uma tarefa pendente, mas ela não é uma nova ação
                      comercial sugerida para este Lead concluído.
                    </p>
                    {canManageFollowUps && (
                      <div className="mt-3 space-y-2">
                        {pendingFollowUps.map(followUp => (
                          <div
                            key={followUp.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/70 p-2"
                          >
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(followUp.dueAt)}
                            </span>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={completeFollowUp.isPending}
                                onClick={() =>
                                  completeFollowUp.mutate({ id: followUp.id })
                                }
                              >
                                Concluir
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={cancelFollowUp.isPending}
                                onClick={() => setFollowUpToCancel(followUp.id)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {selectedEvidenceEvent && canOperateOwnLead && (
                  <LeadEvidenceUploader
                    leadId={id}
                    timelineEventId={selectedEvidenceEvent.id}
                    onUploaded={() => {
                      setPendingEvidenceEventId(null);
                      refresh();
                    }}
                    successMessage="Evidência anexada ao evento operacional."
                    failureMessage="Não foi possível enviar a evidência. A ação já foi registrada e continua pendente; tente novamente."
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <p className="v2-eyebrow">Contexto</p>
              <CardTitle>Informações e histórico</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <details className="rounded-md border border-border p-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  Dados do Lead{" "}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </summary>
                <div className="v2-mobile-detail-grid mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>
                    Telefone<strong>{lead.phone || "Não informado"}</strong>
                  </span>
                  <span>
                    E-mail<strong>{lead.email || "Não informado"}</strong>
                  </span>
                  <span>
                    Origem
                    <strong>
                      {detail.data?.lead.sourceId
                        ? "Registrada"
                        : "Não informada"}
                    </strong>
                  </span>
                  <span>
                    Última atividade
                    <strong>{formatDateTime(lead.lastActivityAt)}</strong>
                  </span>
                </div>
              </details>
              <details className="rounded-md border border-border p-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  Nota interna{" "}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </summary>
                <form
                  className="mt-3 space-y-2 border-t border-border pt-3"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const value =
                      new FormData(form).get("note")?.toString().trim() ?? "";
                    if (!value) return;
                    addNote.mutate({ id, text: value });
                    form.reset();
                  }}
                >
                  <p className="text-sm text-muted-foreground">
                    Use para informações internas; uma nota não cria uma
                    tratativa nem substitui uma pendência.
                  </p>
                  <Textarea name="note" placeholder="Informação interna" />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={addNote.isPending}
                  >
                    <StickyNote className="mr-2 size-4" />
                    {addNote.isPending ? "Salvando…" : "Salvar nota interna"}
                  </Button>
                </form>
              </details>
              <details className="rounded-md border border-border p-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  Follow-ups ({detail.data?.followUps.length ?? 0})
                  <ChevronDown className="size-4 text-muted-foreground" />
                </summary>
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {(detail.data?.followUps ?? []).map(item => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-md bg-muted/25 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              item.status === "pending"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {followUpStatusLabel(item.status)}
                          </Badge>
                          <span className="text-sm">
                            {formatDateTime(item.dueAt)}
                          </span>
                        </div>
                        {item.note && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.note}
                          </p>
                        )}
                      </div>
                      {canManageFollowUps && item.status === "pending" && (
                        <div className="v2-follow-up-actions">
                          <Button
                            size="sm"
                            disabled={completeFollowUp.isPending}
                            onClick={() =>
                              completeFollowUp.mutate({ id: item.id })
                            }
                          >
                            {completeFollowUp.isPending
                              ? "Concluindo…"
                              : "Concluir"}
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
                      Nenhum follow-up registrado.
                    </p>
                  )}
                  <Link
                    href={buildV2Path("/v2/follow-ups", {
                      from: currentV2Path(),
                    })}
                  >
                    <Button type="button" size="sm" variant="ghost">
                      Abrir central de follow-ups
                    </Button>
                  </Link>
                </div>
              </details>
              <details className="rounded-md border border-border p-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  Histórico ({timeline.length}){" "}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </summary>
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  {visibleTimeline.map(event => {
                    const presentation = presentTimelineEvent(
                      event.type,
                      event.payloadJson
                    );
                    const eventEvidences = (
                      detail.data?.evidences ?? []
                    ).filter(evidence => evidence.timelineEventId === event.id);
                    const canAttach =
                      event.type === "contact_attempted" ||
                      event.type === "effective_contact_recorded";
                    return (
                      <div
                        key={event.id}
                        className="border-l-2 border-brand-accent pl-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">
                            {presentation.title}
                          </p>
                          {eventEvidences.some(
                            evidence =>
                              !evidence.deletedAt &&
                              evidence.storageStatus === "available"
                          ) && <Badge variant="secondary">Evidência</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(event.occurredAt)} ·{" "}
                          {event.actorName || "Sistema"}
                        </p>
                        {presentation.description && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                            {presentation.description}
                          </p>
                        )}
                        {eventEvidences.map(evidence => (
                          <div
                            key={evidence.id}
                            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs"
                          >
                            <span className="font-medium">
                              {evidence.fileName}
                            </span>
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
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    downloadEvidence.mutate({ id: evidence.id })
                                  }
                                >
                                  Visualizar
                                </Button>
                              )}
                            {canManageEvidence && !evidence.deletedAt && (
                              <Button
                                size="sm"
                                type="button"
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
                        {canOperateOwnLead && canAttach && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="mt-2"
                            onClick={() => setPendingEvidenceEventId(event.id)}
                          >
                            <FileUp className="mr-2 size-4" /> Anexar evidência
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {timeline.length > 5 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full"
                      onClick={() => setTimelineExpanded(expanded => !expanded)}
                      aria-expanded={timelineExpanded}
                    >
                      {timelineExpanded
                        ? "Mostrar menos histórico"
                        : `Ver mais ${timeline.length - 5} evento(s)`}
                    </Button>
                  )}
                  {!timeline.length && (
                    <p className="text-sm text-muted-foreground">
                      Sem eventos registrados.
                    </p>
                  )}
                </div>
              </details>
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card className={requirementTone(actionPresentation.tone)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Próxima ação programada
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 text-sm">
                {actionPresentation.tone === "danger" ||
                actionPresentation.tone === "warning" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                ) : actionPresentation.tone === "success" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Clock3 className="mt-0.5 size-4 shrink-0" />
                )}
                <span>{actionPresentation.description}</span>
              </div>
            </CardContent>
          </Card>

          {canAdministerStatus && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Ações administrativas
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {isTerminal ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReopenOpen(true)}
                  >
                    <RotateCcw className="mr-2 size-4" /> Reabrir Lead
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAdminStatusOpen(true)}
                  >
                    Ajustar situação
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Ajustes administrativos não criam tratativa nem conversão.
                </p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <Dialog
        open={attemptOpen}
        onOpenChange={open => {
          setAttemptOpen(open);
          if (!open) setAttemptRequestKey(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar tentativa de contato</DialogTitle>
            <DialogDescription>
              Registre uma ação realizada sem afirmar que houve interação com o
              cliente.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitAttempt}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChannelField
                id="attempt-channel"
                value={attempt.channel}
                allowedChannels={
                  (attemptRequirements.data as FormRequirements | undefined)
                    ?.allowedChannels
                }
                onChange={channel => {
                  setAttempt(current => ({ ...current, channel }));
                  setAttemptRequestKey(null);
                }}
              />
              <ResultField
                id="attempt-result"
                value={attempt.resultId}
                items={attemptResults.data ?? []}
                onChange={resultId => {
                  setAttempt(current => ({ ...current, resultId }));
                  setAttemptRequestKey(null);
                }}
              />
            </div>
            {(attemptRequirements.data as FormRequirements | undefined)
              ?.requirements.summaryRequired && (
              <div className="space-y-1.5">
                <Label htmlFor="attempt-summary">
                  Observação (obrigatória)
                </Label>
                <Textarea
                  id="attempt-summary"
                  value={attempt.summary}
                  required
                  onChange={event => {
                    setAttempt(current => ({
                      ...current,
                      summary: event.target.value,
                    }));
                    setAttemptRequestKey(null);
                  }}
                  placeholder="Descreva o que foi realizado"
                />
              </div>
            )}
            {(attemptRequirements.data as FormRequirements | undefined)
              ?.requirements.evidenceRequired && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">
                  Esta tentativa exige uma evidência.
                </p>
                <p className="mt-1 text-muted-foreground">
                  A tentativa será registrada primeiro. Depois você poderá
                  anexar o arquivo ao evento correto.
                </p>
              </div>
            )}
            {((attemptRequirements.data as FormRequirements | undefined)
              ?.requirements.followUp.required ||
              attemptFollowUpOpen) && (
              <FollowUpFields
                prefix="attempt-follow-up"
                value={attempt}
                required={Boolean(
                  (attemptRequirements.data as FormRequirements | undefined)
                    ?.requirements.followUp.required
                )}
                onChange={patch => {
                  setAttempt(current => ({ ...current, ...patch }));
                  setAttemptRequestKey(null);
                }}
              />
            )}
            {(attemptRequirements.data as FormRequirements | undefined)
              ?.requirements.followUp.allowed &&
              !(attemptRequirements.data as FormRequirements | undefined)
                ?.requirements.followUp.required &&
              !attemptFollowUpOpen && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttemptFollowUpOpen(true)}
                >
                  <CalendarClock className="mr-2 size-4" /> Agendar nova
                  tentativa
                </Button>
              )}
            {attemptRequirements.data &&
              !(attemptRequirements.data as FormRequirements).canOperate && (
                <p className="text-sm text-destructive">
                  {(attemptRequirements.data as FormRequirements).blockedReason}
                </p>
              )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAttemptOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  registerAttempt.isPending ||
                  attemptRequirements.isLoading ||
                  attemptRequirements.isFetching ||
                  !attemptRequirements.data
                }
              >
                {registerAttempt.isPending
                  ? "Registrando…"
                  : "Registrar tentativa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={treatmentOpen}
        onOpenChange={open => {
          setTreatmentOpen(open);
          if (!open) setTreatmentRequestKey(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar tratativa</DialogTitle>
            <DialogDescription>
              Use quando houve interação com o cliente. O resultado define as
              próximas exigências.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitTreatment}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChannelField
                id="treatment-channel"
                value={treatment.channel}
                allowedChannels={
                  (treatmentRequirements.data as FormRequirements | undefined)
                    ?.allowedChannels
                }
                onChange={channel => {
                  setTreatment(current => ({ ...current, channel }));
                  setTreatmentRequestKey(null);
                }}
              />
              <ResultField
                id="treatment-result"
                value={treatment.resultId}
                items={treatmentResults.data ?? []}
                onChange={resultId => {
                  lastSuggestedResultId.current = null;
                  setTreatment(current => ({
                    ...current,
                    resultId,
                    finalStatusId: "",
                  }));
                  setTreatmentRequestKey(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="treatment-summary">
                Resumo{" "}
                {(treatmentRequirements.data as FormRequirements | undefined)
                  ?.requirements.summaryRequired && "(obrigatório)"}
              </Label>
              <Textarea
                id="treatment-summary"
                value={treatment.summary}
                required={Boolean(
                  (treatmentRequirements.data as FormRequirements | undefined)
                    ?.requirements.summaryRequired
                )}
                onChange={event => {
                  setTreatment(current => ({
                    ...current,
                    summary: event.target.value,
                  }));
                  setTreatmentRequestKey(null);
                }}
                placeholder="Registre o que foi tratado com o cliente"
              />
            </div>
            {(treatmentRequirements.data as FormRequirements | undefined)
              ?.status.suggested && (
              <div className="rounded-md border border-brand-secondary/25 bg-brand-accent/5 p-3">
                <Label htmlFor="treatment-status">
                  Situação após esta tratativa
                </Label>
                {(treatmentRequirements.data as FormRequirements).status
                  .policy === "require" ||
                !(treatmentRequirements.data as FormRequirements).status
                  .canOverrideSuggestedStatus ? (
                  <p className="mt-2 text-sm font-medium">
                    {
                      (treatmentRequirements.data as FormRequirements).status
                        .suggested?.label
                    }
                  </p>
                ) : (
                  <Select
                    value={treatment.finalStatusId}
                    onValueChange={finalStatusId => {
                      setTreatment(current => ({ ...current, finalStatusId }));
                      setTreatmentRequestKey(null);
                    }}
                  >
                    <SelectTrigger id="treatment-status" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        (treatmentRequirements.data as FormRequirements)
                          .statuses ?? []
                      ).map((status: { id: number; label: string }) => (
                        <SelectItem key={status.id} value={String(status.id)}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(treatmentRequirements.data as FormRequirements).result
                  ?.conversionMode === "eligible" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ao salvar, a conversão comercial será registrada junto com
                    esta tratativa.
                  </p>
                )}
              </div>
            )}
            {(treatmentRequirements.data as FormRequirements | undefined)
              ?.requirements.evidenceRequired && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">
                  Esta tratativa exige uma evidência.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Você poderá anexá-la depois de salvar; a tratativa permanecerá
                  pendente até o envio.
                </p>
              </div>
            )}
            {((treatmentRequirements.data as FormRequirements | undefined)
              ?.requirements.followUp.required ||
              treatmentFollowUpOpen) && (
              <FollowUpFields
                prefix="treatment-follow-up"
                value={treatment}
                required={Boolean(
                  (treatmentRequirements.data as FormRequirements | undefined)
                    ?.requirements.followUp.required
                )}
                onChange={patch => {
                  setTreatment(current => ({ ...current, ...patch }));
                  setTreatmentRequestKey(null);
                }}
              />
            )}
            {(treatmentRequirements.data as FormRequirements | undefined)
              ?.requirements.followUp.allowed &&
              !(treatmentRequirements.data as FormRequirements | undefined)
                ?.requirements.followUp.required &&
              !treatmentFollowUpOpen && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTreatmentFollowUpOpen(true)}
                >
                  <CalendarClock className="mr-2 size-4" /> Agendar retorno
                </Button>
              )}
            {treatmentRequirements.data &&
              !(treatmentRequirements.data as FormRequirements).canOperate && (
                <p className="text-sm text-destructive">
                  {
                    (treatmentRequirements.data as FormRequirements)
                      .blockedReason
                  }
                </p>
              )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTreatmentOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  recordTreatment.isPending ||
                  treatmentRequirements.isLoading ||
                  treatmentRequirements.isFetching ||
                  !treatmentRequirements.data
                }
              >
                {recordTreatment.isPending ? "Salvando…" : "Salvar tratativa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={independentFollowUpOpen}
        onOpenChange={setIndependentFollowUpOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Agendar tarefa</DialogTitle>
            <DialogDescription>
              Cria um follow-up independente sem registrar tentativa ou
              tratativa.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (!independentFollowUp.dueAt) return;
              createFollowUp.mutate({
                leadId: id,
                dueAt: new Date(independentFollowUp.dueAt),
                note: independentFollowUp.note.trim() || null,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="independent-follow-up-due">Data e hora</Label>
              <Input
                id="independent-follow-up-due"
                type="datetime-local"
                value={independentFollowUp.dueAt}
                required
                onChange={event =>
                  setIndependentFollowUp(current => ({
                    ...current,
                    dueAt: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="independent-follow-up-note">Observação</Label>
              <Textarea
                id="independent-follow-up-note"
                value={independentFollowUp.note}
                onChange={event =>
                  setIndependentFollowUp(current => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIndependentFollowUpOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createFollowUp.isPending}>
                {createFollowUp.isPending ? "Agendando…" : "Agendar tarefa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={adminStatusOpen} onOpenChange={setAdminStatusOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajustar situação</DialogTitle>
            <DialogDescription>
              Este é um ajuste administrativo: não cria tratativa nem conversão.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (
                !administrativeStatus.statusId ||
                !administrativeStatus.reason.trim()
              )
                return;
              const requestKey =
                administrativeRequestKey ??
                makeRequestKey("administrative-status");
              if (!administrativeRequestKey)
                setAdministrativeRequestKey(requestKey);
              adjustAdministrativeStatus.mutate({
                leadId: id,
                statusId: Number(administrativeStatus.statusId),
                reason: administrativeStatus.reason.trim(),
                expectedStatusId: lead.statusId,
                requestKey,
              });
            }}
          >
            <p className="text-sm">
              Situação atual: <strong>{detail.data?.status?.label}</strong>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="administrative-status">Nova situação</Label>
              <Select
                value={administrativeStatus.statusId}
                onValueChange={statusId => {
                  setAdministrativeStatus(current => ({
                    ...current,
                    statusId,
                  }));
                  setAdministrativeRequestKey(null);
                }}
              >
                <SelectTrigger id="administrative-status">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(configuration.data?.statuses ?? []).map(status => (
                    <SelectItem key={status.id} value={String(status.id)}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="administrative-reason">Motivo</Label>
              <Textarea
                id="administrative-reason"
                value={administrativeStatus.reason}
                required
                onChange={event => {
                  setAdministrativeStatus(current => ({
                    ...current,
                    reason: event.target.value,
                  }));
                  setAdministrativeRequestKey(null);
                }}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdminStatusOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={adjustAdministrativeStatus.isPending}
              >
                {adjustAdministrativeStatus.isPending
                  ? "Salvando…"
                  : "Confirmar ajuste"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reabrir Lead</DialogTitle>
            <DialogDescription>
              O Lead voltará para uma situação operacional. O histórico
              anterior, inclusive conversões, será preservado.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (!reopen.statusId || !reopen.reason.trim()) return;
              const requestKey =
                reopenRequestKey ?? makeRequestKey("reopen-lead");
              if (!reopenRequestKey) setReopenRequestKey(requestKey);
              reopenLead.mutate({
                leadId: id,
                statusId: Number(reopen.statusId),
                reason: reopen.reason.trim(),
                expectedStatusId: lead.statusId,
                requestKey,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="reopen-status">Nova situação operacional</Label>
              <Select
                value={reopen.statusId}
                onValueChange={statusId => {
                  setReopen(current => ({ ...current, statusId }));
                  setReopenRequestKey(null);
                }}
              >
                <SelectTrigger id="reopen-status">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(configuration.data?.statuses ?? [])
                    .filter(status => !status.isTerminal)
                    .map(status => (
                      <SelectItem key={status.id} value={String(status.id)}>
                        {status.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reopen-reason">Motivo da reabertura</Label>
              <Textarea
                id="reopen-reason"
                value={reopen.reason}
                required
                onChange={event => {
                  setReopen(current => ({
                    ...current,
                    reason: event.target.value,
                  }));
                  setReopenRequestKey(null);
                }}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReopenOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={reopenLead.isPending}>
                {reopenLead.isPending ? "Reabrindo…" : "Reabrir Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <FollowUpCancellationDialog
        open={followUpToCancel !== null}
        onOpenChange={open => !open && setFollowUpToCancel(null)}
        leadName={lead.name || "este Lead"}
        pending={cancelFollowUp.isPending}
        onConfirm={() => {
          if (followUpToCancel !== null)
            cancelFollowUp.mutate({ id: followUpToCancel });
        }}
      />
    </main>
  );
}

function clearExternalPrompt(leadId: number) {
  try {
    sessionStorage.removeItem(externalContactStorageKey(leadId));
  } catch {
    // Browser storage is a convenience only and has no domain significance.
  }
}
