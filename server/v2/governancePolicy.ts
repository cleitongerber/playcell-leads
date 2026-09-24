export const SUPPORTED_EVIDENCE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export const DEFAULT_MAX_EVIDENCE_SIZE_BYTES = 5 * 1024 * 1024;
export const ABSOLUTE_MAX_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024;

export type GovernanceRule = {
  evidenceRequired: boolean;
  noteRequired: boolean;
  followUpRequired: boolean;
  allowedChannels: string[] | null;
  allowedOutcomes: string[] | null;
  allowedEvidenceMimeTypes: string[] | null;
  maxEvidenceSizeBytes: number;
  retentionDays: number | null;
};

export const defaultGovernanceRule: GovernanceRule = {
  evidenceRequired: false,
  noteRequired: false,
  followUpRequired: false,
  allowedChannels: null,
  allowedOutcomes: null,
  allowedEvidenceMimeTypes: null,
  maxEvidenceSizeBytes: DEFAULT_MAX_EVIDENCE_SIZE_BYTES,
  retentionDays: null,
};

export function selectEffectiveGovernance(
  partnerRule: GovernanceRule,
  campaignOverride: GovernanceRule | null
) {
  return campaignOverride
    ? { source: "campaign" as const, rule: campaignOverride }
    : { source: "partner" as const, rule: partnerRule };
}

function normalizedSet(values: string[] | null | undefined) {
  if (!values?.length) return null;
  return new Set(values.map(value => value.trim().toLowerCase()));
}

export function assertContactGovernance(
  rule: GovernanceRule,
  input: {
    channel: string;
    outcome: string;
    summary?: string | null;
    followUpDueAt?: Date | null;
  }
) {
  const channels = normalizedSet(rule.allowedChannels);
  const outcomes = normalizedSet(rule.allowedOutcomes);
  if (channels && !channels.has(input.channel.trim().toLowerCase())) {
    throw new Error("Canal não permitido pela regra de governança");
  }
  if (outcomes && !outcomes.has(input.outcome.trim().toLowerCase())) {
    throw new Error("Resultado não permitido pela regra de governança");
  }
  if (rule.noteRequired && !input.summary?.trim()) {
    throw new Error("Esta tratativa exige uma observação");
  }
  if (rule.followUpRequired && !input.followUpDueAt) {
    throw new Error("Esta tratativa exige um próximo follow-up");
  }
}

export function evaluateTreatmentGovernance(
  rule: GovernanceRule,
  input: {
    hasNote: boolean;
    hasFollowUp: boolean;
    hasEvidence: boolean;
  }
) {
  const noteSatisfied = !rule.noteRequired || input.hasNote;
  const followUpSatisfied = !rule.followUpRequired || input.hasFollowUp;
  const evidenceSatisfied = !rule.evidenceRequired || input.hasEvidence;
  return {
    noteSatisfied,
    followUpSatisfied,
    evidenceSatisfied,
    isComplete: noteSatisfied && followUpSatisfied && evidenceSatisfied,
  };
}

export function allowedEvidenceMimeTypes(rule: GovernanceRule) {
  const configured = normalizedSet(rule.allowedEvidenceMimeTypes);
  const supported = new Set<string>(SUPPORTED_EVIDENCE_MIME_TYPES);
  if (!configured) return supported;
  return new Set(
    Array.from(configured).filter(mimeType => supported.has(mimeType))
  );
}

export function normalizeRule(input: Partial<GovernanceRule>): GovernanceRule {
  const normalizeList = (value: string[] | null | undefined) => {
    const values = value
      ?.map(item => item.trim().toLowerCase())
      .filter(Boolean);
    return values?.length ? Array.from(new Set(values)) : null;
  };
  const max = input.maxEvidenceSizeBytes ?? DEFAULT_MAX_EVIDENCE_SIZE_BYTES;
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    max > ABSOLUTE_MAX_EVIDENCE_SIZE_BYTES
  ) {
    throw new Error("Limite de tamanho de evidência inválido");
  }
  const retentionDays = input.retentionDays ?? null;
  if (
    retentionDays !== null &&
    (!Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650)
  ) {
    throw new Error("Prazo de retenção inválido");
  }
  return {
    evidenceRequired: input.evidenceRequired ?? false,
    noteRequired: input.noteRequired ?? false,
    followUpRequired: input.followUpRequired ?? false,
    allowedChannels: normalizeList(input.allowedChannels),
    allowedOutcomes: normalizeList(input.allowedOutcomes),
    allowedEvidenceMimeTypes: normalizeList(input.allowedEvidenceMimeTypes),
    maxEvidenceSizeBytes: max,
    retentionDays,
  };
}
