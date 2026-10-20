import { describe, expect, it } from "vitest";
import {
  duplicateRowDisposition,
  resolvePolicyForBatchValidation,
  type ResolvedImportPolicy,
} from "./importService";

type SnapshotInput = Parameters<typeof resolvePolicyForBatchValidation>[0];

function snapshot(
  overrides: Partial<SnapshotInput> = {}
): SnapshotInput {
  return {
    status: "validated",
    duplicatePolicy: "reject",
    duplicateMatchStrategy: "phone_or_email",
    duplicateIdentifiers: null,
    duplicateMatchVersion: null,
    safeUpdateFields: ["name", "phone", "email"],
    ...overrides,
  };
}

function livePolicy(
  overrides: Partial<ResolvedImportPolicy> = {}
): ResolvedImportPolicy {
  return {
    policy: "allow",
    matchStrategy: "email",
    safeUpdateFields: ["email"],
    duplicateIdentifiers: ["email"],
    duplicateMatchVersion: "any_v2",
    rule: {
      identifiers: ["email"],
      version: "any_v2",
      legacyMatchStrategy: null,
    },
    source: "partner",
    ...overrides,
  };
}

describe("import policy snapshots", () => {
  it("uses the live policy only for a first validation and preserves a V2 snapshot on revalidation", () => {
    const current = livePolicy();
    const draft = snapshot({ status: "draft" });
    expect(resolvePolicyForBatchValidation(draft, current)).toBe(current);

    const persisted = snapshot({
      duplicatePolicy: "reject",
      duplicateMatchStrategy: "phone_or_email",
      duplicateIdentifiers: ["phone", "cpf"],
      duplicateMatchVersion: "any_v2",
      safeUpdateFields: ["name", "normalizedCpf"],
    });
    const resolved = resolvePolicyForBatchValidation(persisted, current);
    expect(resolved).toMatchObject({
      policy: "reject",
      duplicateIdentifiers: ["phone", "cpf"],
      duplicateMatchVersion: "any_v2",
      source: "batch",
    });
    expect(resolved).not.toBe(current);
  });

  it("preserves a legacy phone_and_email snapshot even when live policy becomes ANY", () => {
    const legacy = snapshot({
      duplicatePolicy: "update_safe_fields",
      duplicateMatchStrategy: "phone_and_email",
      duplicateIdentifiers: null,
      duplicateMatchVersion: null,
    });
    const resolved = resolvePolicyForBatchValidation(legacy, livePolicy());

    expect(resolved).toMatchObject({
      policy: "update_safe_fields",
      matchStrategy: "phone_and_email",
      duplicateIdentifiers: ["phone", "email"],
      duplicateMatchVersion: null,
      rule: { version: "legacy_v1", legacyMatchStrategy: "phone_and_email" },
      source: "batch",
    });
  });

  it("never updates an arbitrary lead when an identity conflict has no duplicateLeadId", () => {
    expect(
      duplicateRowDisposition({
        status: "duplicate",
        policy: "reject",
        duplicateLeadId: null,
      })
    ).toBe("reject");
    expect(
      duplicateRowDisposition({
        status: "duplicate",
        policy: "update_safe_fields",
        duplicateLeadId: null,
      })
    ).toBe("reject");
    expect(
      duplicateRowDisposition({
        status: "duplicate",
        policy: "allow",
        duplicateLeadId: null,
      })
    ).toBe("insert");
  });
});
