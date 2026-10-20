import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDuplicateRule } from "./importDomain";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("campaign import policy V2 contract", () => {
  const router = read("server/v2/router.ts");
  const service = read("server/v2/importService.ts");
  const importer = read("client/src/pages/V2Importer.tsx");

  it("forwards the identifier set and V2 match version to the campaign service", () => {
    const routeStart = router.indexOf("setCampaignPolicy:");
    const routeEnd = router.indexOf("  }),\n  evidences:", routeStart);
    const route = router.slice(routeStart, routeEnd);

    expect(route).toContain(
      "duplicateIdentifiers: input.setting.duplicateIdentifiers"
    );
    expect(route).toContain(
      'duplicateMatchVersion: input.setting.duplicateMatchVersion'
    );
    expect(service).toContain("duplicateIdentifiers: isV2Rule ? input.duplicateIdentifiers : null");
    expect(service).toContain('duplicateMatchVersion: isV2Rule ? "any_v2" : null');
  });

  it("keeps inherited rules read-only while allowing an explicit campaign V2 override", () => {
    expect(importer).toContain('setup.data.policy.source === "campaign" ? "override" : "inherit"');
    expect(importer).toContain("const policyIsInherited = policyMode === \"inherit\"");
    expect(importer).toContain("Usando o padrão do parceiro");
    expect(importer).toContain("duplicateIdentifiers,");
    expect(importer).toContain('duplicateMatchVersion: "any_v2"');
    expect(importer).toContain("Salvar regras");
  });

  it("uses CPF in the V2 ANY rule without converting the legacy AND rule", () => {
    expect(
      resolveDuplicateRule({
        matchStrategy: "phone_or_email",
        duplicateIdentifiers: ["phone", "cpf"],
        duplicateMatchVersion: "any_v2",
      })
    ).toMatchObject({ version: "any_v2", identifiers: ["phone", "cpf"] });
    expect(resolveDuplicateRule({ matchStrategy: "phone_and_email" })).toMatchObject({
      version: "legacy_v1",
      legacyMatchStrategy: "phone_and_email",
    });
    expect(importer).toContain("Regra existente: Telefone + E-mail");
    expect(importer).toContain("Usar nova regra");
  });
});
