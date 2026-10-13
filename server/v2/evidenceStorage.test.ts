import { describe, expect, it, vi } from "vitest";
import {
  createEvidenceStorageKey,
  evidenceStorageUploadDiagnostic,
  EvidenceStorageConfigurationError,
  putS3EvidenceObject,
  readS3EvidenceConfiguration,
  resolveEvidenceStorageProvider,
  validateEvidenceUpload,
} from "./evidenceStorage";
import { defaultGovernanceRule } from "./governancePolicy";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const pngBase64 = pngBytes.toString("base64");

const s3Configuration = {
  bucket: "private-evidence-bucket",
  region: "us-east-2",
  endpoint: "https://project.storage.supabase.co/storage/v1/s3?never=log",
  forcePathStyle: true,
  accessKeyId: "access-key-must-not-appear",
  secretAccessKey: "secret-key-must-not-appear",
};

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

  it("records a bounded, sanitized XML S3 error and keeps it failed", async () => {
    const error = Object.assign(new Error("S3 upload failed"), {
      name: "S3ServiceException",
      code: "AccessDenied",
      $metadata: {
        httpStatusCode: 403,
        requestId: "safe-request-id",
        extendedRequestId: "safe-extended-request-id",
      },
      $response: {
        statusCode: 403,
        statusMessage: "Forbidden",
        headers: {
          "content-type": "application/xml",
          "x-amz-request-id": "safe-request-id",
          authorization: "Bearer must-never-appear",
        },
        body: Buffer.from("<Error><Code>AccessDenied</Code></Error>"),
      },
    });
    const send = vi.fn().mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      putS3EvidenceObject(
        { send },
        s3Configuration,
        "v2/evidences/7/object",
        pngBytes,
        "image/png"
      )
    ).rejects.toBe(error);

    expect(send).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    const [event, diagnostic] = log.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("[evidence_storage_upload_failed]");
    expect(diagnostic).toMatchObject({
      event: "evidence_storage_upload_failed",
      provider: "s3",
      operation: "PutObject",
      region: "us-east-2",
      endpoint: "project.storage.supabase.co/storage/v1/s3",
      forcePathStyle: true,
      errorName: "S3ServiceException",
      errorCode: "AccessDenied",
      httpStatus: 403,
      metadataHttpStatus: 403,
      metadataRequestId: "safe-request-id",
      responseBodyPrefix: "<Error><Code>AccessDenied</Code></Error>",
    });
    expect((diagnostic.headers as Record<string, string>)["content-type"]).toBe(
      "application/xml"
    );
    expect(JSON.stringify(diagnostic)).not.toContain("must-never-appear");
    expect(JSON.stringify(diagnostic)).not.toContain("private-evidence-bucket");
    expect(JSON.stringify(diagnostic)).not.toContain("v2/evidences/7/object");
    expect(JSON.stringify(diagnostic)).not.toContain(pngBase64);
    log.mockRestore();
  });

  it("sanitizes a plain-text response without consuming unavailable stream bodies", async () => {
    const body = `Permission denied Authorization: Bearer top-secret token=abc123 ${"A".repeat(500)}`;
    const error = Object.assign(new Error("storage response"), {
      name: "UnknownError",
      $response: {
        statusCode: 401,
        headers: {
          "content-type": "text/plain",
          server: "storage-gateway",
          cookie: "session=must-not-appear",
        },
        body,
      },
    });
    const diagnostic = evidenceStorageUploadDiagnostic(error, s3Configuration);

    expect(diagnostic).toMatchObject({
      httpStatus: 401,
      responseBodyPrefix: expect.stringContaining("Permission denied"),
    });
    expect(diagnostic.responseBodyPrefix?.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(diagnostic)).not.toContain("top-secret");
    expect(JSON.stringify(diagnostic)).not.toContain("abc123");
    expect(JSON.stringify(diagnostic)).not.toContain("must-not-appear");

    const streamDiagnostic = evidenceStorageUploadDiagnostic(
      Object.assign(new Error("storage response"), {
        $response: { statusCode: 502, body: { pipe: () => undefined } },
      }),
      s3Configuration
    );
    expect(streamDiagnostic.responseBodyUnavailable).toBe(true);
    expect(streamDiagnostic.responseBodyPrefix).toBeUndefined();
  });
});
