import { createHash } from "node:crypto";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_COLUMNS = 200;

export type ParsedCsv = {
  delimiter: "," | ";";
  headers: string[];
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
  fileSizeBytes: number;
  fileChecksum: string;
};

function countUnquoted(text: string, target: "," | ";") {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === target) {
      count += 1;
    }
  }
  return count;
}

export function detectCsvDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return countUnquoted(firstLine, ";") > countUnquoted(firstLine, ",")
    ? ";"
    : ",";
}

/**
 * Small RFC-4180 compatible parser for the bounded V2 CSV payload.
 * Parsing lives on the server so the browser never becomes the authority for
 * transformation or validation.
 */
export function parseCsvRecords(
  text: string,
  delimiter: "," | ";"
): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  const pushField = () => {
    record.push(value);
    value = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      pushField();
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRecord();
      continue;
    }
    value += character;
  }
  if (quoted) throw new Error("CSV inválido: aspas não foram fechadas");
  if (value.length || record.length) pushRecord();
  return records;
}

function decodeBase64(base64: string) {
  const normalized = base64.replace(/^data:[^;]+;base64,/, "").trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Arquivo CSV inválido");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length) throw new Error("O arquivo está vazio");
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw new Error("O arquivo excede o limite de 5 MB");
  }
  return buffer;
}

function normalizeHeaders(values: string[]) {
  const headers = values.map(value => value.replace(/^\uFEFF/, "").trim());
  if (!headers.length || headers.every(header => !header)) {
    throw new Error("O CSV precisa conter uma linha de cabeçalho");
  }
  if (headers.length > MAX_IMPORT_COLUMNS) {
    throw new Error("O arquivo excede o limite de 200 colunas");
  }
  if (headers.some(header => !header)) {
    throw new Error("O CSV possui cabeçalho vazio");
  }
  if (headers.some(header => header.length > 255)) {
    throw new Error("O CSV possui cabeçalho maior que 255 caracteres");
  }
  const keys = new Set(
    headers.map(header => header.toLocaleLowerCase("pt-BR"))
  );
  if (keys.size !== headers.length) {
    throw new Error("O CSV possui cabeçalhos duplicados");
  }
  return headers;
}

function isBlankRecord(values: string[]) {
  return values.every(value => !value.trim());
}

export function parseImportCsv(base64: string): ParsedCsv {
  const buffer = decodeBase64(base64);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("O arquivo deve estar codificado em UTF-8");
  }
  text = text.replace(/^\uFEFF/, "");
  const delimiter = detectCsvDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  const headers = normalizeHeaders(records.shift() ?? []);
  const rows = records
    .map((values, index) => ({ values, rowNumber: index + 2 }))
    .filter(record => !isBlankRecord(record.values));
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error("O arquivo excede o limite de 20.000 linhas");
  }

  return {
    delimiter,
    headers,
    fileSizeBytes: buffer.length,
    fileChecksum: createHash("sha256").update(buffer).digest("hex"),
    rows: rows.map(({ values, rowNumber }) => ({
      rowNumber,
      values: Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? ""])
      ),
    })),
  };
}
