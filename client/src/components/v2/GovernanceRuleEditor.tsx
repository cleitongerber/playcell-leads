import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { governanceChannels } from "@shared/governanceChannels";

export type GovernanceOutcomeOption = { code: string; label: string };

export type GovernanceRuleFormValue = {
  evidenceRequired: boolean;
  evidenceRequiredChannels: string[];
  noteRequired: boolean;
  followUpRequired: boolean;
  allowedChannels: string[] | null;
  allowedOutcomes: string[] | null;
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
  evidenceRequiredChannels: [],
  noteRequired: false,
  followUpRequired: false,
  allowedChannels: null,
  allowedOutcomes: null,
  allowedEvidenceMimeTypes: [],
  maxEvidenceSizeMb: "5",
  retentionDays: "",
};

type ApiRule = {
  evidenceRequired: boolean;
  evidenceRequiredChannels: string[] | null;
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
    evidenceRequiredChannels: rule.evidenceRequiredChannels ?? [],
    noteRequired: rule.noteRequired,
    followUpRequired: rule.followUpRequired,
    allowedChannels: rule.allowedChannels,
    allowedOutcomes: rule.allowedOutcomes,
    allowedEvidenceMimeTypes: rule.allowedEvidenceMimeTypes ?? [],
    maxEvidenceSizeMb: String(rule.maxEvidenceSizeBytes / 1024 / 1024),
    retentionDays: rule.retentionDays ? String(rule.retentionDays) : "",
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function nullableList(values: string[]) {
  const normalized = unique(values);
  return normalized.length ? normalized : null;
}

export function governanceFormToInput(value: GovernanceRuleFormValue) {
  const maxEvidenceSizeBytes = Math.round(
    Number(value.maxEvidenceSizeMb) * 1024 * 1024
  );
  return {
    evidenceRequired: value.evidenceRequired,
    evidenceRequiredChannels: nullableList(value.evidenceRequiredChannels),
    noteRequired: value.noteRequired,
    followUpRequired: value.followUpRequired,
    allowedChannels: value.allowedChannels
      ? nullableList(value.allowedChannels)
      : null,
    allowedOutcomes: value.allowedOutcomes
      ? nullableList(value.allowedOutcomes)
      : null,
    allowedEvidenceMimeTypes: value.allowedEvidenceMimeTypes.length
      ? value.allowedEvidenceMimeTypes
      : null,
    maxEvidenceSizeBytes,
    retentionDays: value.retentionDays ? Number(value.retentionDays) : null,
  };
}

function toggle(values: string[], value: string) {
  return values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value];
}

export function unrecognizedGovernanceOutcomeCodes(
  value: GovernanceRuleFormValue,
  outcomes: readonly GovernanceOutcomeOption[]
) {
  if (!value.allowedOutcomes) return [];
  const known = new Set(outcomes.map(outcome => outcome.code));
  return value.allowedOutcomes.filter(code => !known.has(code));
}

export function unrecognizedGovernanceChannelCodes(
  value: GovernanceRuleFormValue
) {
  const known = new Set<string>(
    governanceChannels.map(channel => channel.code)
  );
  return [
    ...(value.allowedChannels ?? []),
    ...value.evidenceRequiredChannels,
  ].filter(channel => !known.has(channel));
}

export function hasInvalidGovernanceRuleSelection(
  value: GovernanceRuleFormValue,
  outcomes: readonly GovernanceOutcomeOption[]
) {
  if (value.allowedChannels && value.allowedChannels.length === 0) return true;
  if (value.allowedOutcomes && value.allowedOutcomes.length === 0) return true;
  return (
    unrecognizedGovernanceOutcomeCodes(value, outcomes).length > 0 ||
    unrecognizedGovernanceChannelCodes(value).length > 0
  );
}

function ChannelSelection({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  disabled: boolean;
}) {
  const restricted = value !== null;
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">{description}</p>
      <RadioGroup
        value={restricted ? "specific" : "all"}
        onValueChange={next => onChange(next === "all" ? null : [])}
        className="gap-2 sm:grid-cols-2"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="all" disabled={disabled} />
          Todos os canais
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="specific" disabled={disabled} />
          Selecionar canais específicos
        </label>
      </RadioGroup>
      {restricted && (
        <div className="grid gap-2 sm:grid-cols-2">
          {governanceChannels.map(channel => (
            <label
              key={channel.code}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                checked={value.includes(channel.code)}
                disabled={disabled}
                onCheckedChange={() => onChange(toggle(value, channel.code))}
              />
              {channel.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function GovernanceRuleEditor({
  value,
  outcomes,
  onChange,
  disabled = false,
}: {
  value: GovernanceRuleFormValue;
  outcomes: readonly GovernanceOutcomeOption[];
  onChange: (value: GovernanceRuleFormValue) => void;
  disabled?: boolean;
}) {
  const unknownOutcomes = unrecognizedGovernanceOutcomeCodes(value, outcomes);
  const unknownChannels = unrecognizedGovernanceChannelCodes(value);
  const restrictedOutcomes = value.allowedOutcomes !== null;
  const toggleMime = (mime: string) =>
    onChange({
      ...value,
      allowedEvidenceMimeTypes: value.allowedEvidenceMimeTypes.includes(mime)
        ? value.allowedEvidenceMimeTypes.filter(item => item !== mime)
        : [...value.allowedEvidenceMimeTypes, mime],
    });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Requisitos da tratativa</h3>
        <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={value.noteRequired}
            disabled={disabled}
            onCheckedChange={checked =>
              onChange({ ...value, noteRequired: checked === true })
            }
          />
          Exigir resumo da tratativa
        </label>
        <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={value.followUpRequired}
            disabled={disabled}
            onCheckedChange={checked =>
              onChange({ ...value, followUpRequired: checked === true })
            }
          />
          Exigir próximo follow-up quando a tratativa permitir continuidade
        </label>
        <p className="text-xs text-muted-foreground">
          O follow-up é uma regra geral da tratativa; resultados terminais não
          criam retorno residual.
        </p>
      </section>

      <ChannelSelection
        label="Canais permitidos nas tratativas"
        description="Restrinja somente quando a operação não puder registrar tratativas por todos os canais disponíveis."
        value={value.allowedChannels}
        disabled={disabled}
        onChange={allowedChannels => onChange({ ...value, allowedChannels })}
      />
      {unknownChannels.length > 0 && (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
        >
          Esta regra contém canais antigos ou não reconhecidos:{" "}
          {Array.from(new Set(unknownChannels)).join(", ")}. Revise a seleção
          antes de salvar.
        </p>
      )}

      <section className="space-y-3 rounded-md border p-3">
        <h3 className="text-sm font-medium">Evidência</h3>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.evidenceRequired}
            disabled={disabled}
            onCheckedChange={checked =>
              onChange({ ...value, evidenceRequired: checked === true })
            }
          />
          Exigir evidência em todas as tratativas
        </label>
        <p className="text-xs text-muted-foreground">
          Quando a exigência geral estiver desativada, selecione os canais em
          que a evidência será obrigatória.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {governanceChannels.map(channel => (
            <label
              key={channel.code}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                checked={value.evidenceRequiredChannels.includes(channel.code)}
                disabled={disabled || value.evidenceRequired}
                onCheckedChange={() =>
                  onChange({
                    ...value,
                    evidenceRequiredChannels: toggle(
                      value.evidenceRequiredChannels,
                      channel.code
                    ),
                  })
                }
              />
              {channel.label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h3 className="text-sm font-medium">
          Resultados permitidos nas tratativas
        </h3>
        <p className="text-xs text-muted-foreground">
          A seleção usa o catálogo de resultados ativos deste parceiro. O
          sistema guarda códigos estáveis sem expô-los ao administrador.
        </p>
        <RadioGroup
          value={restrictedOutcomes ? "specific" : "all"}
          onValueChange={next =>
            onChange({
              ...value,
              allowedOutcomes:
                next === "all"
                  ? null
                  : (value.allowedOutcomes?.filter(code =>
                      outcomes.some(outcome => outcome.code === code)
                    ) ?? []),
            })
          }
          className="gap-2 sm:grid-cols-2"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all" disabled={disabled} />
            Todos os resultados ativos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value="specific"
              disabled={disabled || !outcomes.length}
            />
            Selecionar resultados específicos
          </label>
        </RadioGroup>
        {unknownOutcomes.length > 0 && (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
          >
            Esta regra contém resultados antigos ou não reconhecidos:{" "}
            {unknownOutcomes.join(", ")}. Revise a seleção antes de salvar.
          </p>
        )}
        {restrictedOutcomes && (
          <div className="grid gap-2 sm:grid-cols-2">
            {outcomes.map(outcome => (
              <label
                key={outcome.code}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={
                    value.allowedOutcomes?.includes(outcome.code) ?? false
                  }
                  disabled={disabled}
                  onCheckedChange={() =>
                    onChange({
                      ...value,
                      allowedOutcomes: toggle(
                        value.allowedOutcomes ?? [],
                        outcome.code
                      ),
                    })
                  }
                />
                {outcome.label}
              </label>
            ))}
            {!outcomes.length && (
              <p className="text-sm text-muted-foreground">
                Nenhum resultado ativo está disponível. Ative ou cadastre um
                resultado antes de restringir esta regra.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-md border p-3">
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
      </section>
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
