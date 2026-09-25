import { describe, expect, it } from "vitest";
import { formatAnalyticsCsv } from "./analyticsService";

describe("V2 analytics CSV export", () => {
  it("keeps UTF-8 accents, quotes fields, and neutralizes spreadsheet formulas", () => {
    const csv = formatAnalyticsCsv(
      [
        { key: "name", label: "Nome" },
        { key: "city", label: "Cidade" },
        { key: "note", label: "Observação" },
      ],
      [{ name: "João", city: "Caçador", note: '=HYPERLINK("https://invalid")' }]
    );

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"João","Caçador"');
    expect(csv).toContain("'=");
    expect(csv).toContain('""https://invalid""');
  });
});
