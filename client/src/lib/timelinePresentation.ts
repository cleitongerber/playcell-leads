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
    .replace(/\b\w/g, character => character.toUpperCase());
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
        description: "O lead foi incluído na campanha e disponibilizado para atendimento.",
      };
    case "lead_imported":
      return {
        title: "Lead importado",
        description: "O lead foi incluído por uma importação de base.",
      };
    case "import_updated": {
      const fields = Array.isArray(data.fields)
        ? data.fields.filter((field): field is string => typeof field === "string")
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
        description: textOf(data.reason) ?? "A responsabilidade pelo lead foi transferida.",
      };
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
      const detail = [channel && `Canal: ${channel}`, outcome && `Resultado: ${outcome}`]
        .filter(Boolean)
        .join(" · ");
      return {
        title: "Contato registrado",
        description: [detail, note].filter(Boolean).join(note && detail ? " — " : "") || undefined,
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
        description: [dueAt && `Para ${dueAt}`, note]
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
        description: [schedule, reason].filter(Boolean).join(reason && schedule ? " — " : "") || undefined,
      };
    }
    default:
      return {
        title: "Evento registrado",
        description: "Uma atualização operacional foi registrada no histórico.",
      };
  }
}
