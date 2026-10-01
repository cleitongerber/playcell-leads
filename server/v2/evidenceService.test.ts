import { describe, expect, it } from "vitest";
import {
  evidenceAuditMetadata,
  preparePrivateEvidence,
} from "./evidenceService";
import type { EvidenceStorage } from "./evidenceStorage";
import { defaultAttemptGovernanceRule } from "./governancePolicy";

describe("V2 evidence audit metadata", () => {
  it("does not include a storage key, signed URL or file content", () => {
    const metadata = evidenceAuditMetadata({
      leadId: 11,
      timelineEventId: 21,
      mimeType: "image/png",
      sizeBytes: 1234,
      checksum: "sha256:abc",
    });
    expect(metadata).toEqual({
      leadId: 11,
      timelineEventId: 21,
      mimeType: "image/png",
      sizeBytes: 1234,
      checksum: "sha256:abc",
    });
    expect(JSON.stringify(metadata)).not.toMatch(/storage|https?:|base64/i);
  });

  it("stages a validated private file so an attempt can bind it in its transaction", async () => {
    const puts: string[] = [];
    const removed: string[] = [];
    const storage: EvidenceStorage = {
      put: async key => {
        puts.push(key);
      },
      getSignedUrl: async () => "https://example.invalid/signed",
      remove: async key => {
        removed.push(key);
      },
    };
    const staged = await preparePrivateEvidence(
      71,
      {
        fileName: "tentativa.png",
        mimeType: "image/png",
        base64: "iVBORw0KGgoA",
      },
      defaultAttemptGovernanceRule,
      storage
    );
    expect(staged.storageKey).toMatch(/^v2\/evidences\/71\//);
    expect(staged.checksum).toMatch(/^sha256:/);
    expect(puts).toEqual([staged.storageKey]);
    await staged.cleanup();
    expect(removed).toEqual([staged.storageKey]);
  });
});
