import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type GovernanceRuleFormValue = {
  evidenceRequired: boolean;
  noteRequired: boolean;
  followUpRequired: boolean;
  allowedChannels: string;
  allowedOutcomes: string;
  allowedEvidenceMimeTypes: string[];
  maxEvidenceSizeMb: string;
  retentionDays: string;
};

export const supportedEvidenceTypes = [
  { mime: "image/png", label: "PNG" },
  { mime: "image/jpeg", label: "JPEG" },
  { mime: "image/webp", label: "WEBP" },
  { mime: "application/pdf", label: "PDF" },
] as const;

export const blankGovernanceRule: GovernanceRuleFormValue = {
  evidenceRequired: false,
  noteRequired: false,
  followUpRequired: false,
  allowedChannels: "",
  allowedOutcomes: "",
  allowedEvidenceMimeTypes: [],
  maxEvidenceSizeMb: "5",
  retentionDays: "",
};

type ApiRule = {
  evidenceRequired: boolean;
  noteRequired: boolean;
  followUpRequired: boolean;
  allowedChannels: string[] | null;
  allowedOutcomes: string[] | null;
  allowedEvidenceMimeTypes: string[] | null;
  maxEvidenceSizeBytes: number;
  retentionDays: number | null;
};

export function governanceRuleToForm(rule: ApiRule): GovernanceRuleFormValue {
  return {
    evidenceRequired: rule.evidenceRequired,
    noteRequired: rule.noteRequired,
    followUpRequired: rule.followUpRequired,
    allowedChannels: rule.allowedChannels?.join(", ") ?? "",
    allowedOutcomes: rule.allowedOutcomes?.join(", ") ?? "",
    allowedEvidenceMimeTypes: rule.allowedEvidenceMimeTypes ?? [],
    maxEvidenceSizeMb: String(rule.maxEvidenceSizeBytes / 1024 / 1024),
    retentionDays: rule.retentionDays ? String(rule.retentionDays) : "",
  };
}

function commaList(value: string) {
  const values = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return values.length ? Array.from(new Set(values)) : null;
}

export function governanceFormToInput(value: GovernanceRuleFormValue) {
  const maxEvidenceSizeBytes = Math.round(
    Number(value.maxEvidenceSizeMb) * 1024 * 1024
  );
  return {
    evidenceRequired: value.evidenceRequired,
    noteRequired: value.noteRequired,
    followUpRequired: value.followUpRequired,
    allowedChannels: commaList(value.allowedChannels),
    allowedOutcomes: commaList(value.allowedOutcomes),
    allowedEvidenceMimeTypes: value.allowedEvidenceMimeTypes.length
      ? value.allowedEvidenceMimeTypes
      : null,
    maxEvidenceSizeBytes,
    retentionDays: value.retentionDays ? Number(value.retentionDays) : null,
  };
}

export function GovernanceRuleEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: GovernanceRuleFormValue;
  onChange: (value: GovernanceRuleFormValue) => void;
  disabled?: boolean;
}) {
  const toggleMime = (mime: string) =>
    onChange({
      ...value,
      allowedEvidenceMimeTypes: value.allowedEvidenceMimeTypes.includes(mime)
        ? value.allowedEvidenceMimeTypes.filter(item => item !== mime)
        : [...value.allowedEvidenceMimeTypes, mime],
    });
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={value.noteRequired}
            disabled={disabled}
            onCheckedChange={checked =>
              onChange({ ...value, noteRequired: checked === true })
            }
          />
          Exigir observação
        </label>
        <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={value.followUpRequired}
            disabled={disabled}
            onCheckedChange={checked =>
              onChange({ ...value, followUpRequired: checked === true })
            }
          />
          Exigir follow-up
        </label>
        <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={value.evidenceRequired}
            disabled={disabled}
            onCheckedChange={checked =>
              onChange({ ...value, evidenceRequired: checked === true })
            }
          />
          Exigir evidência
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Textarea
          disabled={disabled}
          value={value.allowedChannels}
          onChange={event =>
            onChange({ ...value, allowedChannels: event.target.value })
          }
          placeholder="Canais permitidos, separados por vírgula. Vazio = todos."
        />
        <Textarea
          disabled={disabled}
          value={value.allowedOutcomes}
          onChange={event =>
            onChange({ ...value, allowedOutcomes: event.target.value })
          }
          placeholder="Resultados permitidos, separados por vírgula. Vazio = todos."
        />
      </div>
      <div className="rounded-md border p-3">
        <p className="mb-2 text-sm font-medium">Tipos de evidência aceitos</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Sem seleção, todos os tipos operacionais suportados são aceitos.
        </p>
        <div className="flex flex-wrap gap-3">
          {supportedEvidenceTypes.map(type => (
            <label key={type.mime} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.allowedEvidenceMimeTypes.includes(type.mime)}
                disabled={disabled}
                onCheckedChange={() => toggleMime(type.mime)}
              />
              {type.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Limite por evidência (MB)</span>
          <Input
            disabled={disabled}
            inputMode="decimal"
            value={value.maxEvidenceSizeMb}
            onChange={event =>
              onChange({ ...value, maxEvidenceSizeMb: event.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Retenção em dias (opcional)</span>
          <Input
            disabled={disabled}
            inputMode="numeric"
            value={value.retentionDays}
            onChange={event =>
              onChange({ ...value, retentionDays: event.target.value })
            }
            placeholder="Sem prazo automático"
          />
        </label>
      </div>
    </div>
  );
}
