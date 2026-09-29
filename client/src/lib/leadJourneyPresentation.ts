export type BackendNextLeadAction = {
  kind:
    | "complete_governance"
    | "campaign_not_operational"
    | "lead_terminal"
    | "complete_overdue_follow_up"
    | "complete_today_follow_up"
    | "make_first_contact_attempt"
    | "await_response"
    | "resolve_invalid_contact"
    | "continue_lead_work";
  hasResidualFollowUp: boolean;
};

export type LeadJourneyCta = "evidence" | "contact" | "treatment" | "none";

export function presentNextLeadAction(action: BackendNextLeadAction) {
  switch (action.kind) {
    case "complete_governance":
      return {
        title: "Adicione a evidência pendente",
        description:
          "Existe uma ação registrada que ainda precisa atender os requisitos configurados.",
        cta: "evidence" as const,
        tone: "warning" as const,
      };
    case "lead_terminal":
      return {
        title: "Lead concluído",
        description: action.hasResidualFollowUp
          ? "Há um follow-up anterior pendente para revisão, mas nenhuma nova ação comercial é sugerida."
          : "Este Lead não possui uma próxima ação comercial programada.",
        cta: "none" as const,
        tone: "success" as const,
      };
    case "campaign_not_operational":
      return {
        title: "Campanha encerrada — somente consulta",
        description:
          "Novas tentativas e tratativas estão bloqueadas para esta campanha.",
        cta: "none" as const,
        tone: "muted" as const,
      };
    case "complete_overdue_follow_up":
      return {
        title: "Follow-up vencido",
        description: "Há um retorno pendente que precisa ser tratado.",
        cta: "treatment" as const,
        tone: "danger" as const,
      };
    case "complete_today_follow_up":
      return {
        title: "Retornar contato hoje",
        description: "Existe um follow-up agendado para hoje.",
        cta: "treatment" as const,
        tone: "brand" as const,
      };
    case "make_first_contact_attempt":
      return {
        title: "Faça a primeira tentativa de contato",
        description:
          "Abra um canal e registre somente o que efetivamente aconteceu.",
        cta: "contact" as const,
        tone: "brand" as const,
      };
    case "await_response":
      return {
        title: "Aguardando resposta do cliente",
        description:
          "A última tentativa foi registrada. Programe uma nova tentativa se necessário.",
        cta: "none" as const,
        tone: "muted" as const,
      };
    case "resolve_invalid_contact":
      return {
        title: "Contato precisa de revisão",
        description:
          "A última tentativa indicou um contato inválido. Revise os dados antes de continuar.",
        cta: "none" as const,
        tone: "warning" as const,
      };
    default:
      return {
        title: "Continue o atendimento",
        description:
          "Registre uma tratativa quando houver interação com o cliente.",
        cta: "treatment" as const,
        tone: "brand" as const,
      };
  }
}

/** Fails closed, matching the server's missing-setting legacy default. */
export function usesSeparatedLeadJourney(value: unknown) {
  return value === "separated_contact_v1";
}
