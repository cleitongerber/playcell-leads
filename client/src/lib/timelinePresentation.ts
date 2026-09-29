export type TimelinePresentation = {
  title: string;
  description?: string;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function labelFromCode(value: unknown): string | null {
  const code = textOf(value);
  if (!code) return null;
  return code
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(word => `${word[0]?.toLocaleUpperCase("pt-BR") ?? ""}${word.slice(1)}`)
    .join(" ");
}

function formatDateTime(value: unknown): string | null {
  const valueText = textOf(value);
  if (!valueText) return null;
  const date = new Date(valueText);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

function interactionDescription(data: Record<string, unknown>) {
  const channel = labelFromCode(data.channel);
  const result = textOf(data.resultLabel) ?? labelFromCode(data.resultCode);
  return [channel && `Canal: ${channel}`, result && `Resultado: ${result}`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Converts the immutable, machine-readable lead timeline into language that is
 * useful in the operational UI. The original event payload remains preserved
 * in the database; internal ids are deliberately not exposed to operators.
 */
export function presentTimelineEvent(
  type: string,
  payload: unknown
): TimelinePresentation {
  const data = recordOf(payload);
  const note = textOf(data.note) ?? textOf(data.summary) ?? textOf(data.text);
  const dueAt = formatDateTime(data.dueAt);

  switch (type) {
    case "lead_created":
      return {
        title: "Lead criado",
        description:
          "O lead foi incluído na campanha e disponibilizado para atendimento.",
      };
    case "lead_imported":
      return {
        title: "Lead importado",
        description: "O lead foi incluído por uma importação de base.",
      };
    case "import_updated": {
      const fields = Array.isArray(data.fields)
        ? data.fields.filter(
            (field): field is string => typeof field === "string"
          )
        : [];
      return {
        title: "Dados atualizados por importação",
        description: fields.length
          ? `Campos atualizados: ${fields.join(", ")}.`
          : "Dados seguros do lead foram atualizados por uma importação.",
      };
    }
    case "assigned":
      return {
        title: "Lead assumido",
        description: "O lead foi atribuído a um vendedor para atendimento.",
      };
    case "assignee_changed":
      return {
        title: "Responsável alterado",
        description:
          textOf(data.reason) ??
          "A responsabilidade pelo lead foi transferida.",
      };
    case "lead_distributed":
      return {
        title: "Lead distribuído",
        description:
          textOf(data.reason) ??
          "O lead foi atribuído à carteira de um vendedor.",
      };
    case "lead_reassigned":
      return {
        title: "Lead redistribuído",
        description:
          textOf(data.reason) ??
          "A responsabilidade operacional foi transferida para outro vendedor.",
      };
    case "lead_returned_to_queue":
      return {
        title: "Lead devolvido à fila",
        description:
          textOf(data.reason) ??
          "O responsável foi removido e o lead voltou à fila disponível.",
      };
    case "follow_up_owner_changed": {
      const followUpIds = Array.isArray(data.followUpIds)
        ? data.followUpIds.filter(item => typeof item === "number")
        : [];
      return {
        title: "Responsabilidade de follow-up transferida",
        description: followUpIds.length
          ? `${followUpIds.length} follow-up(s) pendente(s) foram transferidos junto com a carteira.`
          : "Os follow-ups pendentes foram transferidos junto com a carteira.",
      };
    }
    case "status_changed": {
      const status = labelFromCode(data.statusCode);
      return {
        title: "Status atualizado",
        description: status ? `Novo status: ${status}.` : undefined,
      };
    }
    case "contact": {
      const channel = labelFromCode(data.channel);
      const outcome = labelFromCode(data.outcome);
      const detail = [
        channel && `Canal: ${channel}`,
        outcome && `Resultado: ${outcome}`,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        title: "Contato registrado",
        description:
          [detail, note].filter(Boolean).join(note && detail ? " — " : "") ||
          undefined,
      };
    }
    case "contact_attempted": {
      const detail = interactionDescription(data);
      return {
        title: "Tentativa de contato",
        description:
          [detail, note].filter(Boolean).join(note && detail ? " — " : "") ||
          undefined,
      };
    }
    case "effective_contact_recorded": {
      const detail = interactionDescription(data);
      return {
        title: "Tratativa registrada",
        description:
          [detail, note].filter(Boolean).join(note && detail ? " — " : "") ||
          undefined,
      };
    }
    case "conversion_recorded": {
      const result = textOf(data.resultLabel) ?? labelFromCode(data.resultCode);
      return {
        title: "Conversão registrada",
        description: result ? `Resultado: ${result}.` : undefined,
      };
    }
    case "lead_reopened": {
      const status = labelFromCode(data.statusCode);
      const reason = textOf(data.reason);
      return {
        title: "Lead reaberto",
        description:
          [status && `Nova situação: ${status}.`, reason]
            .filter(Boolean)
            .join(reason && status ? " — " : "") || undefined,
      };
    }
    case "administrative_status_changed": {
      const status = labelFromCode(data.statusCode);
      const reason = textOf(data.reason);
      return {
        title: "Situação ajustada administrativamente",
        description:
          [status && `Nova situação: ${status}.`, reason]
            .filter(Boolean)
            .join(reason && status ? " — " : "") || undefined,
      };
    }
    case "note":
      return {
        title: "Nota interna adicionada",
        description: note ?? "Uma observação interna foi registrada.",
      };
    case "follow_up_created":
      return {
        title: "Follow-up agendado",
        description:
          [dueAt && `Para ${dueAt}`, note]
            .filter(Boolean)
            .join(note && dueAt ? " — " : "") || undefined,
      };
    case "follow_up_completed":
      return {
        title: "Follow-up concluído",
        description: dueAt ? `Agendamento original: ${dueAt}.` : undefined,
      };
    case "follow_up_cancelled":
      return {
        title: "Follow-up cancelado",
        description: dueAt ? `Agendamento original: ${dueAt}.` : undefined,
      };
    case "follow_up_rescheduled": {
      const previousDueAt = formatDateTime(data.previousDueAt);
      const reason = textOf(data.reason);
      const schedule = [
        previousDueAt && `De ${previousDueAt}`,
        dueAt && `para ${dueAt}`,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        title: "Follow-up reagendado",
        description:
          [schedule, reason]
            .filter(Boolean)
            .join(reason && schedule ? " — " : "") || undefined,
      };
    }
    default:
      return {
        title: "Evento registrado",
        description: "Uma atualização operacional foi registrada no histórico.",
      };
  }
}
