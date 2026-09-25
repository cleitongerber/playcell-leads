import { describe, expect, it } from "vitest";
import { followUpStatusLabel } from "../../client/src/lib/followUpPresentation";

describe("followUpStatusLabel", () => {
  it("presents persisted statuses in operational Portuguese", () => {
    expect(followUpStatusLabel("pending")).toBe("Pendente");
    expect(followUpStatusLabel("completed")).toBe("Concluído");
    expect(followUpStatusLabel("cancelled")).toBe("Cancelado");
  });

  it("prioritizes the derived overdue state", () => {
    expect(followUpStatusLabel("pending", "overdue")).toBe("Vencido");
  });
});
