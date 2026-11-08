import { describe, expect, it } from "vitest";
import {
  assertProductivityExportLimit,
  buildProductivityExportRows,
  formatProductivityXlsx,
  formatProductivityCsv,
  PRODUCTIVITY_EXPORT_ROW_MAX,
  PRODUCTIVITY_XLSX_EXPORT_GLOBAL_MAX,
  ProductivityXlsxConcurrencyError,
  productivityExportColumns,
  type ProductivityAnalytics,
  withProductivityXlsxExportSlot,
} from "./analyticsService";
import * as XLSX from "xlsx";
import { inflateRawSync } from "node:zlib";

function readZipEntries(content: string) {
  const archive = Buffer.from(content, "base64");
  let eocdOffset = -1;
  for (let index = archive.length - 22; index >= 0; index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("EOCD ausente no XLSX");

  const entries = new Map<string, string>();
  let offset = archive.readUInt32LE(eocdOffset + 16);
  while (archive.readUInt32LE(offset) === 0x02014b50) {
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = compression === 8 ? inflateRawSync(compressed) : compressed;
    entries.set(name, data.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const analytics: ProductivityAnalytics = {
  period: {
    start: new Date("2026-11-01T03:00:00.000Z"),
    end: new Date("2026-12-01T03:00:00.000Z"),
    timeZone: "America/Sao_Paulo",
    label: "Novembro",
  },
  totals: {
    sellers: 1,
    portfolio: 5,
    attempts: 3,
    leadsWithAttempt: 2,
    attemptsPerLead: 1.5,
    effectiveContacts: 1,
    leadsWithEffectiveContact: 1,
    worked: 2,
    workCoverage: 0.4,
    effectiveContactRate: 0.5,
    conversions: 1,
    leadsConverted: 1,
    conversionRate: 1,
    firstAttemptAverageSeconds: 300,
    firstEffectiveContactAverageSeconds: 600,
    followUpsOverdue: 1,
    followUpsCompleted: 2,
  },
  sellers: [
    {
      membershipId: 7,
      name: "=Vendedor de teste",
      pdvIds: [3],
      pdvNames: ["PDV Centro"],
      leadsInPortfolio: 5,
      leadsAssignedInPeriod: 2,
      leadsWorked: 2,
      attempts: 3,
      leadsWithAttempt: 2,
      effectiveContacts: 1,
      leadsWithEffectiveContact: 1,
      interested: 1,
      conversions: 1,
      leadsConverted: 1,
      followUpsCreated: 2,
      followUpsCompleted: 1,
      followUpsOverdue: 1,
      followUpsPending: 1,
      followUpsFromAttempts: 1,
      followUpsFromTreatments: 1,
      followUpsIndependent: 0,
      firstAttemptAverageSeconds: 300,
      firstEffectiveContactAverageSeconds: 600,
      leadsWithoutWork: 3,
      governanceComplete: 2,
      governancePending: 1,
      lastActivityAt: new Date("2026-11-03T15:00:00.000Z"),
      effectiveContactRate: 0.5,
      conversionRate: 1,
      workCoverage: 0.4,
      attemptsPerLead: 1.5,
      followUpCompletionRate: 0.5,
    },
  ],
  daily: [],
};

const metadata = {
  partner: "Parceiro de teste",
  campaign: "Todas as campanhas autorizadas",
  pdv: "PDV Centro",
  seller: "Todos os vendedores autorizados",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  timeZone: "America/Sao_Paulo",
  generatedAt: "07/11/2026, 10:30:00",
};

describe("V2 productivity export", () => {
  it("uses the official productivity facts without recalculating rates", () => {
    const [row] = buildProductivityExportRows(analytics, metadata);

    expect(row).toMatchObject({
      partner: "Parceiro de teste",
      filterPdv: "PDV Centro",
      seller: "=Vendedor de teste",
      portfolio: 5,
      assignedInPeriod: 2,
      withoutWork: 3,
      workCoverage: 40,
      attemptsPerLead: 1.5,
      effectiveContactRate: 50,
      conversionRate: 100,
      firstAttemptAverageSeconds: 300,
      followUpsOverdue: 1,
      governancePending: 1,
    });
  });

  it("keeps the CSV tabular, UTF-8 compatible, and safe from spreadsheet formulas", () => {
    const csv = formatProductivityCsv(analytics, metadata);

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"Carteira atual (snapshot)"');
    expect(csv).toContain('"Tentativas (período)"');
    expect(csv).toContain('"\'=Vendedor de teste"');
  });

  it("creates a real Excel workbook with the official rows and safe text values", async () => {
    const content = await formatProductivityXlsx(analytics, metadata);
    const workbook = XLSX.read(Buffer.from(content, "base64"), {
      type: "buffer",
      cellNF: true,
    });

    expect(workbook.SheetNames).toEqual(["Produtividade", "Informações"]);
    const sheet = workbook.Sheets.Produtividade;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0]).toEqual(
      productivityExportColumns.map(column => column.label)
    );
    expect(sheet.A2?.v).toBe("Produtividade por vendedor");
    expect(sheet.K2?.v).toBe("'=Vendedor de teste");
    expect(sheet.Q2?.v).toBe(40);
    expect(sheet.Q2?.z).toBe('0.00"%"');
    expect(workbook.Sheets.Informações.B13?.v).toContain("intervalo selecionado");
    expect(workbook.Sheets.Informações.B14?.v).toContain("estado atual");
  });

  it("serializes Excel-compatible panes, filters, widths, and header styles", async () => {
    const entries = readZipEntries(await formatProductivityXlsx(analytics, metadata));
    const workbookXml = entries.get("xl/workbook.xml") ?? "";
    const sheetXml = entries.get("xl/worksheets/sheet1.xml") ?? "";
    const stylesXml = entries.get("xl/styles.xml") ?? "";

    expect(workbookXml).toMatch(/<sheet[^>]*name="Produtividade"/);
    expect(workbookXml).toMatch(/<sheet[^>]*name="Informações"/);
    expect(sheetXml).toContain('<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>');
    expect(sheetXml).toContain('<autoFilter ref="A1:AM2"/>');
    expect(sheetXml).toContain('<cols>');
    expect(sheetXml).toMatch(/<c r="A1" s="\d+"/);
    expect(stylesXml).toContain('FF0F4C5C');
    expect(stylesXml).toContain('FFFFFFFF');
    expect(stylesXml).toContain('<b/>');
  });

  it("neutralizes direct and control-prefixed formula payloads without emitting formulas", async () => {
    const unsafeAnalytics: ProductivityAnalytics = {
      ...analytics,
      sellers: [{ ...analytics.sellers[0], name: "\t=SUM(1,1)" }],
    };
    const unsafeMetadata = { ...metadata, partner: " \r\n@partner" };
    const csv = formatProductivityCsv(unsafeAnalytics, unsafeMetadata);
    const content = await formatProductivityXlsx(unsafeAnalytics, unsafeMetadata);
    const entries = readZipEntries(content);
    const workbook = XLSX.read(Buffer.from(content, "base64"), { type: "buffer" });

    expect(csv).toContain("'\t=SUM(1,1)");
    expect(csv).toContain("' \r\n@partner");
    expect(workbook.Sheets.Produtividade.K2?.v).toBe("'\t=SUM(1,1)");
    expect(workbook.Sheets.Produtividade.C2?.v).toBe("' \r\n@partner");
    const archiveXml = [...entries.values()].join("\n");
    expect(archiveXml).not.toMatch(/<f(?:\s|>)/);
    expect(archiveXml).not.toContain("<hyperlink");
    expect([...entries.keys()].some(entry => entry.includes("externalLinks"))).toBe(false);
    expect([...entries.keys()].some(entry => entry.includes("vbaProject"))).toBe(false);
  });

  it("preserves null metrics when no valid denominator exists", () => {
    const emptyRates: ProductivityAnalytics = {
      ...analytics,
      sellers: [
        {
          ...analytics.sellers[0],
          workCoverage: null,
          effectiveContactRate: null,
          conversionRate: null,
          attemptsPerLead: null,
        },
      ],
    };

    const [row] = buildProductivityExportRows(emptyRates, metadata);
    expect(row.workCoverage).toBeNull();
    expect(row.effectiveContactRate).toBeNull();
    expect(row.conversionRate).toBeNull();
    expect(row.attemptsPerLead).toBeNull();
  });

  it("rejects exports above the explicit seller limit without truncating", () => {
    expect(() => assertProductivityExportLimit(PRODUCTIVITY_EXPORT_ROW_MAX)).not.toThrow();
    expect(() =>
      assertProductivityExportLimit(PRODUCTIVITY_EXPORT_ROW_MAX + 1)
    ).toThrow("Refine os filtros antes de exportar");
  });

  it("limits XLSX generation per user and per process, then always releases the slot", async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const first = withProductivityXlsxExportSlot({ userId: 801 }, () =>
      new Promise<void>(resolve => {
        releaseFirst = resolve;
      })
    );
    await Promise.resolve();
    await expect(
      withProductivityXlsxExportSlot({ userId: 801 }, async () => undefined)
    ).rejects.toBeInstanceOf(ProductivityXlsxConcurrencyError);

    const second = withProductivityXlsxExportSlot({ userId: 802 }, () =>
      new Promise<void>(resolve => {
        releaseSecond = resolve;
      })
    );
    await Promise.resolve();
    expect(PRODUCTIVITY_XLSX_EXPORT_GLOBAL_MAX).toBe(2);
    await expect(
      withProductivityXlsxExportSlot({ userId: 803 }, async () => undefined)
    ).rejects.toBeInstanceOf(ProductivityXlsxConcurrencyError);

    releaseFirst?.();
    releaseSecond?.();
    await Promise.all([first, second]);
    await expect(
      withProductivityXlsxExportSlot({ userId: 801 }, async () => "released")
    ).resolves.toBe("released");
    await expect(
      withProductivityXlsxExportSlot({ userId: 804 }, async () => {
        throw new Error("generation failed");
      })
    ).rejects.toThrow("generation failed");
    await expect(
      withProductivityXlsxExportSlot({ userId: 804 }, async () => "recovered")
    ).resolves.toBe("recovered");
  });
});
