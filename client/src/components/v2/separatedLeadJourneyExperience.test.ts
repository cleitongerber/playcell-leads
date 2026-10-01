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
  const evidenceUploader = readProjectFile(
    "client/src/components/v2/LeadEvidenceUploader.tsx"
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
    expect(workspace).toContain("Registre uma ação realizada sem afirmar");
  });

  it("keeps pending evidence and terminal residual follow-ups visible without creating a false next action", () => {
    expect(workspace).toContain("Evidência pendente");
    expect(workspace).toContain("Follow-up anterior à conclusão");
    expect(workspace).toContain("pendingRequirements.some");
    expect(workspace).toContain("operationRequirements.useQuery");
  });

  it("opens the native evidence picker directly from each operational action without persisting a new fact", () => {
    const evidenceAction = workspace.slice(
      workspace.indexOf("function EvidenceAttachmentAction"),
      workspace.indexOf("/**\n * Operational Lead workspace")
    );
    expect(workspace).toContain("EvidenceAttachmentAction");
    expect(evidenceAction).toContain("uploaderRef.current?.openFilePicker()");
    expect(evidenceAction).toContain("timelineEventId={timelineEventId}");
    expect(evidenceAction).toContain("showPickerButton={false}");
    expect(evidenceAction).not.toContain(".mutate(");
    expect(evidenceAction).not.toContain("registerAttempt");
    expect(evidenceAction).not.toContain("recordEffectiveContact");
    expect(workspace).not.toContain("setPendingEvidenceEventId");
    expect(evidenceUploader).toContain("forwardRef");
    expect(evidenceUploader).toContain("useImperativeHandle");
    expect(evidenceUploader).toContain("inputRef.current?.click()");
    expect(evidenceUploader).toContain('type="file"');
    expect(evidenceUploader).toContain(
      "setFile(event.target.files?.[0] ?? null)"
    );
    expect(evidenceUploader).not.toContain("onChange={send}");
  });

  it("keeps selection, upload error retry and the existing secure upload pipeline intact", () => {
    expect(evidenceUploader).toContain("Arquivo selecionado:");
    expect(evidenceUploader).toContain("upload.mutateAsync");
    expect(evidenceUploader).toContain("leadId,");
    expect(evidenceUploader).toContain("timelineEventId,");
    expect(evidenceUploader).toContain(
      "base64: await readEvidenceFileAsBase64(file)"
    );
    expect(evidenceUploader).toContain("toast.error(");
    expect(evidenceUploader).toContain("Enviar evidência");
  });

  it("requires a locally selected attempt evidence before the new operation is persisted", () => {
    const attemptDialog = workspace.slice(
      workspace.indexOf("open={attemptOpen}"),
      workspace.indexOf("open={treatmentOpen}")
    );
    const attemptSubmit = workspace.slice(
      workspace.indexOf("const submitAttempt"),
      workspace.indexOf("const submitTreatment")
    );
    expect(attemptDialog).toContain("Evidência obrigatória *");
    expect(attemptDialog).toContain("attemptEvidenceInputRef.current?.click()");
    expect(attemptDialog).toContain("Arquivo selecionado:");
    expect(attemptDialog).toContain("Remover");
    expect(attemptDialog).toContain("!attemptEvidence");
    expect(attemptSubmit).toContain(
      "readEvidenceFileAsBase64(attemptEvidence)"
    );
    expect(attemptSubmit).toContain("evidence,");
    expect(attemptSubmit).toContain(
      "Adicione a evidência obrigatória para registrar esta tentativa"
    );
    expect(attemptDialog).not.toContain("evidences.upload.useMutation");
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
