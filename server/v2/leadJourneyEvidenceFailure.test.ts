import { describe, expect, it } from "vitest";
import { EvidenceStorageUploadError } from "./evidenceService";
import { publicEvidenceUploadFailure } from "./leadJourneyService";
import { LeadJourneyOperationError } from "./leadJourneyOperationalPolicy";

describe("V2 lead journey evidence storage failures", () => {
  const rawStorageError = new Error(
    "char 'P' is not expected: PutObjectCommand Smithy response"
  );

  it("maps a failed attempt upload to the exact safe domain message", () => {
    const error = publicEvidenceUploadFailure(
      new EvidenceStorageUploadError(rawStorageError),
      "attempt"
    );

    expect(error).toBeInstanceOf(LeadJourneyOperationError);
    expect((error as LeadJourneyOperationError).code).toBe(
      "EVIDENCE_UPLOAD_FAILED"
    );
    expect((error as Error).message).toBe(
      "Não foi possível enviar a evidência. A tentativa não foi registrada. Tente novamente em alguns instantes."
    );
    expect((error as Error).message).not.toContain("Smithy");
  });

  it("maps a failed effective-contact upload to the exact safe domain message", () => {
    const error = publicEvidenceUploadFailure(
      new EvidenceStorageUploadError(rawStorageError),
      "effective_contact"
    );

    expect(error).toBeInstanceOf(LeadJourneyOperationError);
    expect((error as LeadJourneyOperationError).code).toBe(
      "EVIDENCE_UPLOAD_FAILED"
    );
    expect((error as Error).message).toBe(
      "Não foi possível enviar a evidência. A tratativa não foi registrada. Tente novamente em alguns instantes."
    );
    expect((error as Error).message).not.toContain("PutObjectCommand");
  });

  it("does not relabel validation, authorization or governance errors as storage failures", () => {
    const domainError = new LeadJourneyOperationError(
      "EVIDENCE_REQUIRED",
      "Adicione a evidência obrigatória para registrar esta tentativa"
    );

    expect(publicEvidenceUploadFailure(domainError, "attempt")).toBe(
      domainError
    );
  });
});
