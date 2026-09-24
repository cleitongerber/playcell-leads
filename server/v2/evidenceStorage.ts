import { createHash, randomUUID } from "node:crypto";
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

export const forgeEvidenceStorage: EvidenceStorage = {
  async put(key, bytes, mimeType) {
    await storagePutExact(key, bytes, mimeType);
  },
  getSignedUrl: storageGetSignedUrl,
};

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
