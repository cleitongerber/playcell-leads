import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("016.4 unified lead journey experience contract", () => {
  const leadsPage = readProjectFile("client/src/pages/V2Leads.tsx");
  const app = readProjectFile("client/src/App.tsx");
  const workspace = readProjectFile(
    "client/src/components/v2/V2SeparatedLeadJourney.tsx"
  );
  const styles = readProjectFile("client/src/index.css");

  it("uses the new workspace as the only operational detail route", () => {
    expect(app).toContain("<V2SeparatedLeadJourney />");
    expect(leadsPage).not.toContain("partnerSettings.leadJourneyMode");
    expect(leadsPage).not.toContain("V2LegacyLeadDetail");
    expect(leadsPage).not.toContain("leads.contact.useMutation");
    expect(leadsPage).not.toContain("leads.changeStatus.useMutation");
  });

  it("uses only separated commands in the new workspace and preserves idempotent intents", () => {
    expect(workspace).toContain("leads.registerAttempt.useMutation");
    expect(workspace).toContain("leads.recordEffectiveContact.useMutation");
    expect(workspace).toContain("leads.changeAdministrativeStatus.useMutation");
    expect(workspace).toContain("leads.reopen.useMutation");
    expect(workspace).toContain("makeRequestKey");
    expect(workspace).not.toContain("leads.contact.useMutation");
    expect(workspace).not.toContain("leads.changeStatus.useMutation");
  });

  it("keeps an external-channel click non-persistent until the operator confirms what happened", () => {
    expect(workspace).toContain("Você enviou a mensagem ao cliente?");
    expect(workspace).toContain("Você realizou a ligação?");
    expect(workspace).toContain("Conseguiu falar com o cliente?");
    expect(workspace).toContain("Sim, registrar tratativa");
    expect(workspace).toContain("Não, registrar tentativa");
    expect(workspace).toContain("A tentativa será registrada primeiro");
  });

  it("keeps pending evidence and terminal residual follow-ups visible without creating a false next action", () => {
    expect(workspace).toContain("Evidência pendente");
    expect(workspace).toContain("Follow-up anterior à conclusão");
    expect(workspace).toContain("pendingRequirements.some");
    expect(workspace).toContain("operationRequirements.useQuery");
  });

  it("keeps the mobile workspace constrained, touch-friendly and progressively disclosed", () => {
    expect(workspace).toContain("grid min-w-0 gap-5 xl:grid-cols");
    expect(workspace).toContain("max-h-[calc(100dvh-2rem)] overflow-y-auto");
    expect(workspace).toContain("timelineExpanded");
    expect(workspace).toContain("min-h-11");
    expect(styles).toContain(".v2-lead-journey .v2-mobile-detail-grid strong");
    expect(styles).toContain("overflow-wrap: anywhere;");
  });
});
