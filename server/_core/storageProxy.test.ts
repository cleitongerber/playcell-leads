import { describe, expect, it } from "vitest";
import { isPrivateV2EvidenceKey } from "./storageProxy";

describe("private V2 evidence proxy boundary", () => {
  it("never routes V2 evidence through the unauthorised legacy storage proxy", () => {
    expect(isPrivateV2EvidenceKey("v2/evidences/10/opaque-object")).toBe(true);
    expect(isPrivateV2EvidenceKey("v2%2Fevidences%2F10%2Fopaque-object")).toBe(
      true
    );
    expect(isPrivateV2EvidenceKey("uploads/legacy-document.pdf")).toBe(false);
  });
});
