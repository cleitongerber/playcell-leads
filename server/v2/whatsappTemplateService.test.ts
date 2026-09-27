import { describe, expect, it } from "vitest";
import { whatsappTemplateAuditMetadata } from "./whatsappTemplateService";

describe("WhatsApp template administrative audit", () => {
  it("records configuration metadata without retaining the template body", () => {
    const template =
      "Olá, {{primeiro_nome}}. Pedido interno: não registrar este texto.";
    const metadata = whatsappTemplateAuditMetadata(template);

    expect(metadata).toEqual({
      setting: "whatsappInitialMessageTemplate",
      templateLength: template.length,
      variables: ["primeiro_nome"],
    });
    expect(JSON.stringify(metadata)).not.toContain(template);
    expect(JSON.stringify(metadata)).not.toContain("Pedido interno");
  });
});
