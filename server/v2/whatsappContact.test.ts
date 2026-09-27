import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
  buildTelephoneUrl,
  buildWhatsAppUrl,
  normalizePhoneForDirectContact,
  referencedWhatsAppTemplateVariables,
  renderWhatsAppInitialMessage,
} from "../../shared/whatsappContact";

describe("V2 WhatsApp contact helpers", () => {
  const values = {
    nome: "Adair Jose Soares",
    vendedor: "João",
    pdv: "Loja Centro",
    campanha: "Campanha Setembro",
  };

  it("renders the default template and the official variables as plain text", () => {
    expect(renderWhatsAppInitialMessage(undefined, values)).toBe(
      "Olá, Adair! Tudo bem? Meu nome é João e estou entrando em contato para dar continuidade ao seu atendimento."
    );
    expect(
      renderWhatsAppInitialMessage(
        "{{nome}} | {{primeiro_nome}} | {{vendedor}} | {{pdv}} | {{campanha}}",
        values
      )
    ).toBe(
      "Adair Jose Soares | Adair | João | Loja Centro | Campanha Setembro"
    );
    expect(DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE).toContain(
      "{{primeiro_nome}}"
    );
  });

  it("removes absent and unknown placeholders instead of exposing them", () => {
    expect(
      renderWhatsAppInitialMessage("Olá, {{primeiro_nome}}! Tudo bem?", {})
    ).toBe("Olá! Tudo bem?");
    expect(
      renderWhatsAppInitialMessage("Olá {{desconhecida}} {{nome}}", {})
    ).toBe("Olá");
  });

  it("keeps accents and emoji safe when building the official WhatsApp URL", () => {
    const url = buildWhatsAppUrl(
      "(49) 9 9000-1003",
      "Olá, Adair! 👋 Ação rápida & segura."
    );
    expect(url).toBe(
      "https://wa.me/5549990001003?text=Ol%C3%A1%2C%20Adair!%20%F0%9F%91%8B%20A%C3%A7%C3%A3o%20r%C3%A1pida%20%26%20segura."
    );
  });

  it("normalizes Brazilian and explicit international numbers without dialing invalid data", () => {
    expect(normalizePhoneForDirectContact("(49) 90000-1003")).toBe(
      "5549900001003"
    );
    expect(normalizePhoneForDirectContact("+1 (415) 555-2671")).toBe(
      "14155552671"
    );
    expect(normalizePhoneForDirectContact("0044 20 7946 0958")).toBe(
      "442079460958"
    );
    expect(normalizePhoneForDirectContact("123")).toBeNull();
    expect(normalizePhoneForDirectContact("0000000000")).toBeNull();
    expect(buildTelephoneUrl("(49) 90000-1003")).toBe("tel:+5549900001003");
    expect(buildTelephoneUrl("sem telefone")).toBeNull();
  });

  it("keeps template audit metadata limited to the allowlist", () => {
    expect(
      referencedWhatsAppTemplateVariables(
        "{{nome}} {{script}} {{PDV}} {{primeiro_nome}}"
      )
    ).toEqual(["nome", "pdv", "primeiro_nome"]);
  });
});
