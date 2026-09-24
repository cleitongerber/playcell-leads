import { describe, expect, it } from "vitest";
import { presentTimelineEvent } from "./timelinePresentation";

describe("V2 timeline presentation", () => {
  it("shows lead creation in operational language without exposing ids", () => {
    expect(
      presentTimelineEvent("lead_created", {
        campaignId: 1,
        pdvId: 1,
        statusId: 3,
      })
    ).toEqual({
      title: "Lead criado",
      description:
        "O lead foi incluído na campanha e disponibilizado para atendimento.",
    });
  });

  it("presents contacts and notes without raw JSON", () => {
    expect(
      presentTimelineEvent("contact", {
        channel: "whatsapp",
        outcome: "sem_resposta",
        summary: "Mensagem enviada.",
      })
    ).toEqual({
      title: "Contato registrado",
      description:
        "Canal: Whatsapp · Resultado: Sem Resposta — Mensagem enviada.",
    });
    expect(presentTimelineEvent("note", { text: "Retornar amanhã." })).toEqual({
      title: "Nota interna adicionada",
      description: "Retornar amanhã.",
    });
  });

  it("keeps an unknown future event safe and readable", () => {
    expect(presentTimelineEvent("future_event", { internalId: 9 })).toEqual({
      title: "Evento registrado",
      description: "Uma atualização operacional foi registrada no histórico.",
    });
  });
});
