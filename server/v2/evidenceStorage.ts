import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "../_core/env";
import { storageGetSignedUrl, storagePutExact } from "../storage";
import {
  allowedEvidenceMimeTypes,
  type GovernanceRule,
} from "./governancePolicy";

const mimeToExtensions: Record<string, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

export type EvidenceStorage = {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  getSignedUrl(key: string): Promise<string>;
};

export type EvidenceStorageProvider = "forge_s3" | "s3";

const EVIDENCE_DOWNLOAD_TTL_SECONDS = 5 * 60;
const STORAGE_CONFIGURATION_MESSAGE =
  "O armazenamento privado de evidências ainda não está configurado.";

export class EvidenceStorageConfigurationError extends Error {
  constructor() {
    super(STORAGE_CONFIGURATION_MESSAGE);
    this.name = "EvidenceStorageConfigurationError";
  }
}

export const forgeEvidenceStorage: EvidenceStorage = {
  async put(key, bytes, mimeType) {
    await storagePutExact(key, bytes, mimeType);
  },
  getSignedUrl: storageGetSignedUrl,
};

type S3EvidenceConfiguration = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

function setting(environment: NodeJS.ProcessEnv, key: string) {
  return environment[key]?.trim() ?? "";
}

function booleanSetting(value: string) {
  if (!value) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new EvidenceStorageConfigurationError();
}

/**
 * Forge was used by the original hosted template. V2 now defaults to the
 * portable S3-compatible backend and only uses Forge when it is explicitly
 * selected for a legacy deployment.
 */
export function resolveEvidenceStorageProvider(
  environment: NodeJS.ProcessEnv = process.env
): EvidenceStorageProvider {
  const configured = setting(
    environment,
    "V2_EVIDENCE_STORAGE_PROVIDER"
  ).toLowerCase();
  if (!configured) return "s3";
  if (configured === "forge_s3" || configured === "s3") return configured;
  throw new EvidenceStorageConfigurationError();
}

export function readS3EvidenceConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): S3EvidenceConfiguration {
  const bucket = setting(environment, "V2_EVIDENCE_S3_BUCKET");
  const region = setting(environment, "V2_EVIDENCE_S3_REGION");
  const accessKeyId = setting(environment, "V2_EVIDENCE_S3_ACCESS_KEY_ID");
  const secretAccessKey = setting(
    environment,
    "V2_EVIDENCE_S3_SECRET_ACCESS_KEY"
  );
  const endpoint = setting(environment, "V2_EVIDENCE_S3_ENDPOINT");
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new EvidenceStorageConfigurationError();
  }
  if (endpoint) {
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "https:") throw new Error("insecure endpoint");
    } catch {
      throw new EvidenceStorageConfigurationError();
    }
  }
  return {
    bucket,
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: booleanSetting(
      setting(environment, "V2_EVIDENCE_S3_FORCE_PATH_STYLE")
    ),
    accessKeyId,
    secretAccessKey,
  };
}

function createS3EvidenceStorage(
  environment: NodeJS.ProcessEnv = process.env
): EvidenceStorage {
  const config = readS3EvidenceConfiguration(environment);
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return {
    async put(key, bytes, mimeType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: mimeType,
        })
      );
    },
    getSignedUrl(key) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: EVIDENCE_DOWNLOAD_TTL_SECONDS }
      );
    },
  };
}

/** Resolves a backend without leaking endpoints or credentials to callers. */
export function getEvidenceStorage(
  provider: EvidenceStorageProvider,
  environment: NodeJS.ProcessEnv = process.env
): EvidenceStorage {
  if (provider === "forge_s3") {
    if (
      !setting(environment, "BUILT_IN_FORGE_API_URL") ||
      !setting(environment, "BUILT_IN_FORGE_API_KEY")
    ) {
      throw new EvidenceStorageConfigurationError();
    }
    return forgeEvidenceStorage;
  }
  return createS3EvidenceStorage(environment);
}

function sanitizeOriginalFileName(fileName: string) {
  const normalized = fileName
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized || normalized.length > 255)
    throw new Error("Nome de arquivo inválido");
  return normalized;
}

function expectedMimeFromBytes(bytes: Buffer) {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  )
    return "image/webp";
  if (bytes.length >= 5 && bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    return "application/pdf";
  return null;
}

function decodeBase64(value: string) {
  const compact = value.replace(/\s/g, "");
  if (
    !compact ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    throw new Error("Conteúdo de arquivo inválido");
  }
  const bytes = Buffer.from(compact, "base64");
  if (!bytes.length) throw new Error("O arquivo está vazio");
  return bytes;
}

export function validateEvidenceUpload(
  input: { fileName: string; mimeType: string; base64: string },
  rule: GovernanceRule
) {
  const fileName = sanitizeOriginalFileName(input.fileName);
  const mimeType = input.mimeType.trim().toLowerCase();
  const permitted = allowedEvidenceMimeTypes(rule);
  if (!permitted.has(mimeType))
    throw new Error("Este tipo de evidência não é permitido pela governança");
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !mimeToExtensions[mimeType]?.includes(extension)) {
    throw new Error("A extensão do arquivo não corresponde ao tipo informado");
  }
  const bytes = decodeBase64(input.base64);
  if (bytes.length > rule.maxEvidenceSizeBytes)
    throw new Error("O arquivo excede o limite configurado para evidências");
  const detected = expectedMimeFromBytes(bytes);
  if (detected !== mimeType)
    throw new Error("O conteúdo do arquivo não corresponde ao tipo informado");
  return {
    fileName,
    mimeType,
    bytes,
    sizeBytes: bytes.length,
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

/** Original names never influence the private physical object key. */
export function createEvidenceStorageKey(partnerId: number) {
  return `v2/evidences/${partnerId}/${randomUUID()}`;
}
