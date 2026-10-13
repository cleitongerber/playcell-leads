import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve(process.cwd(), "server/v2/leadJourneyService.ts"),
  "utf8"
);
const router = readFileSync(
  resolve(process.cwd(), "server/v2/router.ts"),
  "utf8"
);
const evidence = readFileSync(
  resolve(process.cwd(), "server/v2/evidenceService.ts"),
  "utf8"
);
function commandSlice(start: string, end: string) {
  const startAt = service.indexOf(start);
  const endAt = service.indexOf(end, startAt + start.length);
  if (startAt < 0 || endAt < 0) throw new Error("Comando não encontrado");
  return service.slice(startAt, endAt);
}

describe("016.4 unified journey service contract", () => {
  it("keeps the new commands as the only commercial operation path", () => {
    for (const command of [
      "registerAttempt",
      "recordEffectiveContact",
      "changeAdministrativeStatus",
      "reopenLead",
    ]) {
      const start = service.indexOf(`export async function ${command}`);
      const section = service.slice(start, start + 450);
      expect(section).not.toContain("assertSeparatedJourney");
    }
    expect(router).not.toContain("changeStatus: v2PartnerProcedure");
    expect(router).not.toContain("contact: v2PartnerProcedure");
  });

  it("exposes active result choices and form requirements through the unified journey", () => {
    const resultChoices = service.slice(
      service.indexOf(
        "export async function listOperationalInteractionResults"
      ),
      service.indexOf("export async function getLeadOperationRequirements")
    );
    const requirements = service.slice(
      service.indexOf("export async function getLeadOperationRequirements"),
      service.indexOf("async function writeTimeline")
    );

    expect(resultChoices).toContain("listPartnerInteractionResults");
    expect(requirements).toContain("resolveEffectiveAttemptGovernance");
    expect(requirements).toContain("resolveEffectiveGovernance");
    expect(requirements).toContain("allowedResultIds");
    expect(requirements).toContain("allowedResults");
    expect(requirements).toContain("filterAllowedContactOutcomes");
    expect(requirements).toContain(
      'input.operationKind !== "effective_contact" || Boolean(result)'
    );
    expect(requirements).toContain('? { required: false, allowed: false }');
    expect(requirements).toContain("finalStatusId");
    expect(requirements).toContain("canOverrideSuggestedStatus");
    expect(router).toContain("operationRequirements: v2PartnerProcedure");
    expect(router).toContain("available: v2PartnerProcedure");
  });

  it("records attempts without creating legacy contacts, conversion, status or first contact", () => {
    const attempt = commandSlice(
      "export async function registerAttempt",
      "export async function recordEffectiveContact"
    );
    expect(attempt).toContain("leadContactAttempts");
    expect(attempt).toContain('type: "contact_attempted"');
    expect(attempt).toContain("updateAttemptActivity");
    expect(attempt).toContain("assertLeadOpenForCommercialOperation");
    expect(service).toContain("firstAttemptAt");
    expect(attempt).not.toContain("firstContactAt");
    expect(attempt).not.toContain("leadContacts).values");
    expect(attempt).not.toContain("leadConversions).values");
    expect(attempt).not.toContain("conditionalStatusUpdate");
  });

  it("prevents a governed attempt from bypassing its required evidence", () => {
    const attempt = commandSlice(
      "export async function registerAttempt",
      "export async function recordEffectiveContact"
    );
    expect(attempt).toContain("rule.evidenceRequired && !input.evidence");
    expect(attempt).toContain("preparePrivateEvidence");
    expect(attempt).toContain("leadEvidences");
    expect(attempt).toContain('storageStatus: "available"');
    expect(attempt).toContain("hasEvidence: Boolean(stagedEvidence.value)");
    expect(attempt).toContain("evidenceAuditMetadata");
    expect(attempt).toContain("stagedEvidence.value?.cleanup()");
    expect(attempt).not.toContain("leadContacts).values");
    expect(attempt).not.toContain("leadConversions).values");
    expect(router).toContain("evidence: z");
  });

  it("accepts optional attempt evidence and binds it atomically to the new attempt event", () => {
    const attempt = commandSlice(
      "export async function registerAttempt",
      "export async function recordEffectiveContact"
    );
    expect(attempt).toContain("if (input.evidence)");
    expect(attempt).toContain("preparePrivateEvidence(");
    expect(attempt).toContain("timelineEventId,");
    expect(attempt).toContain("await tx.insert(leadEvidences).values");
    expect(attempt).toContain("storageStatus: \"available\"");
    expect(attempt).toContain("stagedEvidence.value?.cleanup()");
    expect(router).toContain("base64: z.string().min(4)");
    expect(router).toContain(".optional(),");
  });

  it("keeps failed staged uploads before attempt persistence and maps only storage failures safely", () => {
    const attempt = commandSlice(
      "export async function registerAttempt",
      "export async function recordEffectiveContact"
    );
    const stageAt = attempt.indexOf("stagedEvidence.value = await preparePrivateEvidence");
    const timelineAt = attempt.indexOf("const timelineEventId = await writeTimeline");

    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(timelineAt).toBeGreaterThan(stageAt);
    expect(attempt).toContain('publicEvidenceUploadFailure(error, "attempt")');
    expect(attempt).toContain("stagedEvidence.value?.cleanup()");
    expect(service).toContain('"EVIDENCE_UPLOAD_FAILED"');
    expect(service).toContain(
      "A tentativa não foi registrada. Tente novamente em alguns instantes."
    );
  });

  it("persists an effective contact, result snapshot, governance and conversion atomically", () => {
    const contact = commandSlice(
      "export async function recordEffectiveContact",
      "async function assertAdministrativeLead"
    );
    expect(contact).toContain('recordKind: "effective_contact"');
    expect(contact).toContain("resultCode: result.code");
    expect(contact).toContain("updateEffectiveContactActivity");
    expect(contact).toContain("assertLeadOpenForCommercialOperation");
    expect(service).toContain("firstEffectiveContactAt");
    expect(contact).toContain("writeEffectiveContactGovernance");
    expect(contact).toContain("rule.evidenceRequired && !input.evidence");
    expect(contact).toContain("preparePrivateEvidence");
    expect(contact).toContain("leadEvidences");
    expect(contact).toContain("hasEvidence: Boolean(stagedEvidence.value)");
    expect(contact).toContain("stagedEvidence.value?.cleanup()");
    expect(contact).toContain("resolveEffectiveContactFollowUp");
    expect(contact).toContain("finalStatusIsTerminal");
    expect(contact).toContain("assertConversionSource");
    expect(contact).toContain('type: "conversion_recorded"');
    expect(contact).not.toContain("firstContactAt");
  });

  it("keeps a failed staged treatment upload before treatment persistence and preserves non-storage domain errors", () => {
    const contact = commandSlice(
      "export async function recordEffectiveContact",
      "async function assertAdministrativeLead"
    );
    const stageAt = contact.indexOf("stagedEvidence.value = await preparePrivateEvidence");
    const timelineAt = contact.indexOf("const timelineEventId = await writeTimeline");

    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(timelineAt).toBeGreaterThan(stageAt);
    expect(contact).toContain(
      'publicEvidenceUploadFailure(error, "effective_contact")'
    );
    expect(service).toContain(
      "A tratativa não foi registrada. Tente novamente em alguns instantes."
    );
    expect(service).toContain("if (!(error instanceof EvidenceStorageUploadError)) return error;");
  });

  it("uses per-command idempotency and CAS before state changes", () => {
    expect(service).toContain("leadOperationCommands");
    expect(service).toContain("commandReplayDisposition");
    expect(service).toContain("LEAD_STATUS_CONFLICT");
    expect(service).toContain("eq(leads.statusId, expectedStatusId)");
  });

  it("keeps administrative status and reopen separate from commercial conversion", () => {
    const admin = commandSlice(
      "export async function changeAdministrativeStatus",
      "export async function reopenLead"
    );
    const reopen = service.slice(
      service.indexOf("export async function reopenLead")
    );
    expect(admin).toContain('type: "administrative_status_changed"');
    expect(admin).toContain("writeV2Audit");
    expect(admin).toContain("assertAdministrativeStatusTransition");
    expect(admin).not.toContain("leadConversions).values");
    expect(reopen).toContain('type: "lead_reopened"');
    expect(reopen).toContain("Somente um lead terminal pode ser reaberto");
    expect(reopen).not.toContain("leadConversions).delete");
  });

  it("binds evidence to the operation snapshot and removes legacy commercial routes", () => {
    expect(evidence).toContain(
      "operationKind: leadTreatmentGovernance.operationKind"
    );
    expect(evidence).toContain("normalizeAttemptGovernanceRule");
    expect(router).toContain("registerAttempt: v2OperationalProcedure");
    expect(router).toContain("recordEffectiveContact: v2OperationalProcedure");
    expect(router).not.toContain("changeStatus: v2PartnerProcedure");
    expect(router).not.toContain("contact: v2PartnerProcedure");
  });

  it("keeps a later attachment failed without changing its original operational event", () => {
    const uploadStart = evidence.indexOf("export async function uploadLeadEvidence");
    const upload = evidence.slice(uploadStart);
    const failedAt = upload.indexOf('set({ storageStatus: "failed" })');
    const attachmentErrorAt = upload.indexOf("new EvidenceAttachmentUploadError(error)");

    expect(failedAt).toBeGreaterThanOrEqual(0);
    expect(attachmentErrorAt).toBeGreaterThan(failedAt);
    expect(upload).toContain("EvidenceStorageUploadError");
    expect(evidence).toContain(
      "A ação já foi registrada e continua disponível; tente anexar novamente."
    );
  });
});
