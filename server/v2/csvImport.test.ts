import { describe, expect, it } from "vitest";
import { parseImportCsv } from "./csvImport";

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("V2 CSV importer parser", () => {
  it("accepts semicolon CSV, UTF-8 BOM and quoted delimiters", () => {
    const parsed = parseImportCsv(
      encode('\uFEFFNOME CLIENTE;CELULAR;OBS\r\nAna;47999999999;"A; B"\r\n')
    );
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["NOME CLIENTE", "CELULAR", "OBS"]);
    expect(parsed.rows[0]).toEqual({
      rowNumber: 2,
      values: {
        "NOME CLIENTE": "Ana",
        CELULAR: "47999999999",
        OBS: "A; B",
      },
    });
  });

  it("accepts comma CSV without depending on any header alias", () => {
    const parsed = parseImportCsv(
      encode("Pessoa,Contato\nBruno,47988888888\n")
    );
    expect(parsed.delimiter).toBe(",");
    expect(parsed.headers).toEqual(["Pessoa", "Contato"]);
    expect(parsed.rows).toHaveLength(1);
  });

  it("rejects malformed or ambiguous source structure safely", () => {
    expect(() => parseImportCsv(encode("Nome,NOME\nAna,Ana\n"))).toThrow(
      "cabeçalhos duplicados"
    );
    expect(() => parseImportCsv(encode('Nome\n"Ana'))).toThrow(
      "aspas não foram fechadas"
    );
  });
});
