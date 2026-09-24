import { describe, expect, it } from "vitest";
import {
  createEvidenceStorageKey,
  validateEvidenceUpload,
} from "./evidenceStorage";
import { defaultGovernanceRule } from "./governancePolicy";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const pngBase64 = pngBytes.toString("base64");

describe("V2 evidence upload validation", () => {
  it("accepts a supported file and records a checksum without trusting its name for storage", () => {
    const upload = validateEvidenceUpload(
      {
        fileName: "print-whatsapp.png",
        mimeType: "image/png",
        base64: pngBase64,
      },
      defaultGovernanceRule
    );
    expect(upload.mimeType).toBe("image/png");
    expect(upload.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    const key = createEvidenceStorageKey(17);
    expect(key).toMatch(/^v2\/evidences\/17\//);
    expect(key).not.toContain("print-whatsapp");
  });

  it("rejects MIME, extension and size mismatches defensively", () => {
    expect(() =>
      validateEvidenceUpload(
        {
          fileName: "print.pdf",
          mimeType: "application/pdf",
          base64: pngBase64,
        },
        defaultGovernanceRule
      )
    ).toThrow("conteúdo");
    expect(() =>
      validateEvidenceUpload(
        { fileName: "print.jpg", mimeType: "image/png", base64: pngBase64 },
        defaultGovernanceRule
      )
    ).toThrow("extensão");
    expect(() =>
      validateEvidenceUpload(
        { fileName: "print.png", mimeType: "image/png", base64: pngBase64 },
        { ...defaultGovernanceRule, maxEvidenceSizeBytes: 8 }
      )
    ).toThrow("excede");
  });

  it("applies the partner allowlist to evidence types", () => {
    expect(() =>
      validateEvidenceUpload(
        { fileName: "print.png", mimeType: "image/png", base64: pngBase64 },
        {
          ...defaultGovernanceRule,
          allowedEvidenceMimeTypes: ["application/pdf"],
        }
      )
    ).toThrow("não é permitido");
  });
});
