import { describe, expect, it } from "vitest";
import {
  createEvidenceStorageKey,
  EvidenceStorageConfigurationError,
  readS3EvidenceConfiguration,
  resolveEvidenceStorageProvider,
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

  it("selects portable S3 storage by default and keeps legacy Forge explicit", () => {
    expect(resolveEvidenceStorageProvider({})).toBe("s3");
    expect(
      resolveEvidenceStorageProvider({
        BUILT_IN_FORGE_API_URL: "https://legacy-storage.example",
        BUILT_IN_FORGE_API_KEY: "legacy-key",
      })
    ).toBe("s3");
    expect(
      resolveEvidenceStorageProvider({ V2_EVIDENCE_STORAGE_PROVIDER: "s3" })
    ).toBe("s3");
    expect(
      resolveEvidenceStorageProvider({
        V2_EVIDENCE_STORAGE_PROVIDER: "forge_s3",
      })
    ).toBe("forge_s3");
    expect(() =>
      resolveEvidenceStorageProvider({
        V2_EVIDENCE_STORAGE_PROVIDER: "invalid",
      })
    ).toThrow(EvidenceStorageConfigurationError);
  });

  it("requires complete HTTPS S3 configuration without returning secrets", () => {
    const configured = readS3EvidenceConfiguration({
      V2_EVIDENCE_S3_BUCKET: "playcell-evidences",
      V2_EVIDENCE_S3_REGION: "auto",
      V2_EVIDENCE_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      V2_EVIDENCE_S3_ACCESS_KEY_ID: "test-access-key",
      V2_EVIDENCE_S3_SECRET_ACCESS_KEY: "test-secret-key",
      V2_EVIDENCE_S3_FORCE_PATH_STYLE: "false",
    });
    expect(configured).toMatchObject({
      bucket: "playcell-evidences",
      region: "auto",
      endpoint: "https://account.r2.cloudflarestorage.com",
      forcePathStyle: false,
    });
    expect(() => readS3EvidenceConfiguration({})).toThrow(
      EvidenceStorageConfigurationError
    );
    expect(() =>
      readS3EvidenceConfiguration({
        V2_EVIDENCE_S3_BUCKET: "playcell-evidences",
        V2_EVIDENCE_S3_REGION: "auto",
        V2_EVIDENCE_S3_ENDPOINT: "http://insecure-storage.example",
        V2_EVIDENCE_S3_ACCESS_KEY_ID: "test-access-key",
        V2_EVIDENCE_S3_SECRET_ACCESS_KEY: "test-secret-key",
      })
    ).toThrow(EvidenceStorageConfigurationError);
  });
});
