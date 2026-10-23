import { describe, expect, it } from "vitest";
import { presentLeadCustomData } from "./leadDetailPresentation";

describe("lead detail custom data presentation", () => {
  it("shows a normalized CPF once and keeps inactive fields in configured order", () => {
    const fields = presentLeadCustomData({
      normalizedCpf: "01234567890",
      customData: {
        plano: "Premium",
        cidade: "Florianópolis",
        cpf: "1234567890",
      },
      definitions: [
        { key: "cidade", label: "Cidade", fieldType: "text", sortOrder: 20, isActive: false },
        { key: "cpf", label: "CPF", fieldType: "number", sortOrder: 10, isActive: true },
        { key: "plano", label: "Plano", fieldType: "text", sortOrder: 10, isActive: true },
      ],
    });

    expect(fields).toEqual([
      { key: "system-cpf", label: "CPF", value: "012.345.678-90" },
      { key: "plano", label: "Plano", value: "Premium" },
      { key: "cidade", label: "Cidade", value: "Florianópolis" },
    ]);
  });

  it("keeps zero and false, skips empty values, and formats typed dates and reliable currency", () => {
    const fields = presentLeadCustomData({
      customData: {
        valor_plano: "1234,56",
        quantidade: 0,
        aceita_contato: false,
        aniversario: "2026-10-23T00:00:00.000Z",
        vazio: " ",
        nulo: null,
      },
      definitions: [
        { key: "valor_plano", label: "Valor do plano", fieldType: "number", sortOrder: 1, isActive: true },
        { key: "quantidade", label: "Quantidade", fieldType: "number", sortOrder: 2, isActive: true },
        { key: "aceita_contato", label: "Aceita contato", fieldType: "boolean", sortOrder: 3, isActive: true },
        { key: "aniversario", label: "Aniversário", fieldType: "date", sortOrder: 4, isActive: true },
        { key: "vazio", label: "Vazio", fieldType: "text", sortOrder: 5, isActive: true },
        { key: "nulo", label: "Nulo", fieldType: "text", sortOrder: 6, isActive: true },
      ],
    });

    expect(fields.map(field => field.label)).toEqual([
      "Valor do plano",
      "Quantidade",
      "Aceita contato",
      "Aniversário",
    ]);
    expect(fields[0]?.value).toBe("R$ 1.234,56");
    expect(fields[1]?.value).toBe("0");
    expect(fields[2]?.value).toBe("Não");
    expect(fields[3]?.value).toMatch(/^23\/10\/2026$/);
  });

  it("uses a readable fallback for historical keys without a definition", () => {
    expect(
      presentLeadCustomData({
        customData: { bairro_residencial: "Centro" },
        definitions: [],
      })
    ).toEqual([
      {
        key: "bairro_residencial",
        label: "Bairro Residencial",
        value: "Centro",
      },
    ]);
  });
});
