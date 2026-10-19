import { describe, expect, it } from "vitest";
import {
  canCreateImportForCampaign,
  claimImportBatch,
  duplicateIsMatch,
  duplicateIdentityKeys,
  duplicateReasons,
  evaluateDuplicateCandidates,
  isValidCpf,
  mapImportRow,
  normalizeCpf,
  normalizeImportBoolean,
  normalizeImportDate,
  normalizeImportNumber,
  normalizeSafeUpdateFields,
  resolveDuplicateRule,
  validateImportMappings,
} from "./importDomain";

describe("V2 configurable import domain", () => {
  const customFields = [
    {
      key: "documento",
      fieldType: "text" as const,
      isRequired: true,
      isActive: true,
      options: null,
    },
    {
      key: "aceitou",
      fieldType: "boolean" as const,
      isRequired: false,
      isActive: true,
      options: null,
    },
  ];
  const mappings = [
    {
      sourceHeader: "NOME CLIENTE",
      targetKind: "core" as const,
      targetKey: "name",
      valueType: "text" as const,
      isRequired: true,
    },
    {
      sourceHeader: "CELULAR",
      targetKind: "core" as const,
      targetKey: "phone",
      valueType: "text" as const,
      isRequired: false,
    },
    {
      sourceHeader: "DOCUMENTO",
      targetKind: "custom" as const,
      targetKey: "documento",
      valueType: "text" as const,
      isRequired: true,
    },
    {
      sourceHeader: "ACEITOU",
      targetKind: "custom" as const,
      targetKey: "aceitou",
      valueType: "boolean" as const,
      isRequired: false,
    },
  ];

  it("maps arbitrary headers to core and custom fields with deterministic conversions", () => {
    expect(
      validateImportMappings(
        ["NOME CLIENTE", "CELULAR", "DOCUMENTO", "ACEITOU"],
        mappings,
        customFields
      )
    ).toEqual([]);
    const result = mapImportRow(
      {
        "NOME CLIENTE": " Ana ",
        CELULAR: "(47) 99999-9999",
        DOCUMENTO: "123",
        ACEITOU: "sim",
      },
      mappings,
      customFields
    );
    expect(result.issues).toEqual([]);
    expect(result.mapped).toMatchObject({
      name: "Ana",
      normalizedPhone: "47999999999",
      customData: { documento: "123", aceitou: true },
    });
  });

  it("reports conversion and required-field problems without silently changing values", () => {
    const result = mapImportRow(
      { "NOME CLIENTE": "", CELULAR: "", DOCUMENTO: "", ACEITOU: "talvez" },
      mappings,
      customFields
    );
    expect(result.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        "value_required",
        "lead_name_required",
        "lead_contact_required",
        "value_boolean_invalid",
      ])
    );
    expect(normalizeImportDate("31/02/2026")).toBeNull();
    expect(normalizeImportNumber("1.234,50")).toBe(1234.5);
    expect(normalizeImportBoolean("não")).toBe(false);
    expect(
      mapImportRow(
        {
          "NOME CLIENTE": "Ana",
          CELULAR: "123",
          DOCUMENTO: "1",
          ACEITOU: "sim",
        },
        mappings,
        customFields
      ).issues.map(issue => issue.code)
    ).toContain("phone_invalid");
  });

  it("preserves duplicate and lifecycle policy safeguards", () => {
    expect(
      duplicateIsMatch(
        "phone_or_email",
        { normalizedPhone: "4799", normalizedEmail: null },
        { normalizedPhone: "4799", email: "other@example.com" }
      )
    ).toBe(true);
    expect(
      duplicateIsMatch(
        "phone_and_email",
        { normalizedPhone: "4799", normalizedEmail: "a@example.com" },
        { normalizedPhone: "4799", email: "b@example.com" }
      )
    ).toBe(false);
    expect(
      normalizeSafeUpdateFields(["name", "statusId", "assignedMembershipId"])
    ).toEqual(["name"]);
    expect(
      canCreateImportForCampaign({ status: "draft", isFrozen: false })
    ).toBe(true);
    expect(
      canCreateImportForCampaign({ status: "active", isFrozen: true })
    ).toBe(false);
    expect(claimImportBatch("validated")).toBe("processing");
    expect(claimImportBatch("completed")).toBe("completed");
  });

  it("normalizes and validates CPF as text without losing leading zeroes", () => {
    expect(normalizeCpf("012.345.678-90")).toBe("01234567890");
    expect(normalizeCpf("   ")).toBeNull();
    expect(normalizeCpf("CPF 529.982.247-25")).toBeNull();
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("52998224724")).toBe(false);
    const mapped = mapImportRow(
      { Nome: "Ana", Telefone: "47999999999", CPF: "012.345.678-90" },
      [
        {
          sourceHeader: "Nome",
          targetKind: "core",
          targetKey: "name",
          valueType: "text",
          isRequired: true,
        },
        {
          sourceHeader: "Telefone",
          targetKind: "core",
          targetKey: "phone",
          valueType: "text",
          isRequired: true,
        },
        {
          sourceHeader: "CPF",
          targetKind: "core",
          targetKey: "cpf",
          valueType: "text",
          isRequired: true,
        },
      ],
      []
    );
    expect(mapped.mapped.normalizedCpf).toBe("01234567890");
    expect(mapped.issues.map(issue => issue.code)).not.toContain("invalid_cpf");
    expect(
      mapImportRow(
        { Nome: "Ana", Telefone: "47999999999", CPF: "111.111.111-11" },
        [
          {
            sourceHeader: "Nome",
            targetKind: "core",
            targetKey: "name",
            valueType: "text",
            isRequired: true,
          },
          {
            sourceHeader: "Telefone",
            targetKind: "core",
            targetKey: "phone",
            valueType: "text",
            isRequired: true,
          },
          {
            sourceHeader: "CPF",
            targetKind: "core",
            targetKey: "cpf",
            valueType: "text",
            isRequired: true,
          },
        ],
        []
      ).issues.map(issue => issue.code)
    ).toContain("invalid_cpf");
  });

  it("uses V2 ANY identity keys consistently for external and in-file duplicates", () => {
    const rule = resolveDuplicateRule({
      matchStrategy: "phone_or_email",
      duplicateIdentifiers: ["phone", "cpf"],
      duplicateMatchVersion: "any_v2",
    });
    expect(rule).toMatchObject({
      version: "any_v2",
      identifiers: ["phone", "cpf"],
    });
    expect(
      duplicateReasons(
        rule,
        {
          normalizedPhone: "47999999999",
          normalizedEmail: null,
          normalizedCpf: "52998224725",
        },
        {
          normalizedPhone: "47000000000",
          normalizedEmail: null,
          normalizedCpf: "52998224725",
        }
      )
    ).toEqual(["duplicate_cpf"]);
    expect(
      duplicateIdentityKeys(rule, {
        normalizedPhone: "47999999999",
        normalizedEmail: null,
        normalizedCpf: "52998224725",
      })
    ).toEqual(["phone:47999999999", "cpf:52998224725"]);
  });

  it("retains the historical phone_and_email behavior instead of silently becoming ANY", () => {
    const rule = resolveDuplicateRule({ matchStrategy: "phone_and_email" });
    const input = {
      normalizedPhone: "47999999999",
      normalizedEmail: "ana@example.com",
      normalizedCpf: null,
    };
    expect(
      duplicateReasons(rule, input, {
        normalizedPhone: "47999999999",
        normalizedEmail: "other@example.com",
        normalizedCpf: null,
      })
    ).toEqual([]);
    expect(duplicateReasons(rule, input, { ...input })).toEqual([
      "duplicate_phone",
      "duplicate_email",
    ]);
  });

  it("flags an identity conflict when selected identifiers resolve to different leads", () => {
    const rule = resolveDuplicateRule({
      matchStrategy: "phone_or_email",
      duplicateIdentifiers: ["phone", "cpf"],
      duplicateMatchVersion: "any_v2",
    });
    const result = evaluateDuplicateCandidates(
      rule,
      {
        normalizedPhone: "47999999999",
        normalizedEmail: null,
        normalizedCpf: "52998224725",
      },
      [
        {
          id: 10,
          normalizedPhone: "47999999999",
          normalizedEmail: null,
          normalizedCpf: null,
        },
        {
          id: 11,
          normalizedPhone: null,
          normalizedEmail: null,
          normalizedCpf: "52998224725",
        },
      ]
    );
    expect(result).toMatchObject({
      isDuplicate: true,
      identityConflict: true,
      duplicateLeadId: null,
    });
    expect(result.reasons).toEqual(
      expect.arrayContaining(["duplicate_phone", "duplicate_cpf"])
    );
  });

  it("keeps template mapping fingerprints deterministic and validates select fields", async () => {
    const { mappingFingerprint } = await import("./importDomain");
    expect(mappingFingerprint(mappings)).toBe(
      mappingFingerprint([...mappings].reverse())
    );
    const result = mapImportRow(
      { Tipo: "Preferencial", Nome: "Clara", Telefone: "47977777777" },
      [
        {
          sourceHeader: "Nome",
          targetKind: "core",
          targetKey: "name",
          valueType: "text",
          isRequired: true,
        },
        {
          sourceHeader: "Telefone",
          targetKind: "core",
          targetKey: "phone",
          valueType: "text",
          isRequired: true,
        },
        {
          sourceHeader: "Tipo",
          targetKind: "custom",
          targetKey: "perfil",
          valueType: "text",
          isRequired: false,
        },
      ],
      [
        {
          key: "perfil",
          fieldType: "select",
          isRequired: false,
          isActive: true,
          options: ["Preferencial", "Padrão"],
        },
      ]
    );
    expect(result.issues).toEqual([]);
    expect(result.mapped.customData).toEqual({ perfil: "Preferencial" });
  });
});
