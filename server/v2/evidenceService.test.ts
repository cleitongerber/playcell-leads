import { describe, expect, it } from "vitest";
import { evidenceAuditMetadata } from "./evidenceService";

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
});
