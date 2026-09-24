import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { v2trpc } from "@/lib/v2trpc";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useRoute } from "wouter";

type MappingDraft = {
  sourceHeader: string;
  targetKind: "core" | "custom";
  targetKey: string;
  valueType: "text" | "number" | "date" | "boolean";
  isRequired: boolean;
  transformKey: string | null;
};

const coreTargets = [
  { key: "name", label: "Nome" },
  { key: "phone", label: "Telefone" },
  { key: "email", label: "E-mail" },
  { key: "source", label: "Origem" },
  { key: "receivedAt", label: "Data de entrada" },
  { key: "pdv", label: "PDV" },
] as const;

const batchStatusLabels = {
  draft: "Rascunho",
  validated: "Validada",
  processing: "Processando",
  completed: "Concluída",
  failed: "Falhou",
} as const;

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Não foi possível ler o arquivo"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function blankMappings(headers: string[]): MappingDraft[] {
  return headers.map(sourceHeader => ({
    sourceHeader,
    targetKind: "core",
    targetKey: "",
    valueType: "text",
    isRequired: false,
    transformKey: null,
  }));
}

function typeForTarget(
  targetKind: MappingDraft["targetKind"],
  targetKey: string,
  customFields: Array<{ key: string; fieldType: string }>
): MappingDraft["valueType"] {
  if (targetKind === "core")
    return targetKey === "receivedAt" ? "date" : "text";
  const field = customFields.find(item => item.key === targetKey);
  if (field?.fieldType === "number") return "number";
  if (field?.fieldType === "date") return "date";
  if (field?.fieldType === "boolean") return "boolean";
  return "text";
}

function mappingsFromTemplate(
  headers: string[],
  fields: Array<{
    sourceHeader: string;
    targetKind: "core" | "custom";
    targetKey: string;
    valueType: "text" | "number" | "date" | "boolean";
    isRequired: boolean;
    transformKey: string | null;
  }>
) {
  const byHeader = new Map(fields.map(field => [field.sourceHeader, field]));
  return headers.map(header => {
    const existing = byHeader.get(header);
    return existing
      ? { ...existing }
      : {
          sourceHeader: header,
          targetKind: "core" as const,
          targetKey: "",
          valueType: "text" as const,
          isRequired: false,
          transformKey: null,
        };
  });
}

function statusBadge(status: keyof typeof batchStatusLabels) {
  if (status === "completed") return "secondary" as const;
  if (status === "failed") return "destructive" as const;
  return "outline" as const;
}

export default function V2Importer() {
  const [, params] = useRoute("/v2/campaigns/:id/imports");
  const campaignId = Number(params?.id);
  const validCampaignId = Number.isInteger(campaignId) && campaignId > 0;
  const setup = v2trpc.imports.setup.useQuery(
    { campaignId },
    { enabled: validCampaignId }
  );
  const access = v2trpc.access.context.useQuery();
  const utils = v2trpc.useUtils();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [targetPdv, setTargetPdv] = useState("");
  const [mappings, setMappings] = useState<MappingDraft[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [policyMode, setPolicyMode] = useState<"inherit" | "override">(
    "inherit"
  );
  const [policy, setPolicy] = useState<
    "reject" | "allow" | "update_safe_fields"
  >("reject");
  const [matchStrategy, setMatchStrategy] = useState<
    "phone" | "email" | "phone_or_email" | "phone_and_email"
  >("phone_or_email");
  const [customField, setCustomField] = useState({
    key: "",
    label: "",
    fieldType: "text" as "text" | "number" | "date" | "boolean" | "select",
    options: "",
    isRequired: false,
  });
  const canManage =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const history = v2trpc.imports.history.useQuery(
    { campaignId, page: 1, pageSize: 10 },
    { enabled: validCampaignId }
  );
  const preview = v2trpc.imports.previewRows.useQuery(
    { batchId: batchId ?? 0, page: 1, pageSize: 12 },
    { enabled: batchId !== null && step >= 3 }
  );
  const issues = v2trpc.imports.issues.useQuery(
    { batchId: batchId ?? 0, page: 1, pageSize: 20 },
    { enabled: batchId !== null && step >= 3 }
  );

  useEffect(() => {
    if (!setup.data) return;
    setPolicyMode(
      setup.data.policy.source === "campaign" ? "override" : "inherit"
    );
    setPolicy(setup.data.policy.policy);
    setMatchStrategy(setup.data.policy.matchStrategy);
    if (setup.data.pdvs.length === 1 && !targetPdv) {
      setTargetPdv(String(setup.data.pdvs[0].id));
    }
  }, [setup.data, targetPdv]);

  const createDraft = v2trpc.imports.createDraft.useMutation({
    onSuccess: data => {
      setBatchId(data.batchId);
      setMappings(blankMappings(data.headers));
      setTemplateId("");
      setSaveTemplateName("");
      setStep(2);
      toast.success("Arquivo recebido. Agora mapeie as colunas.");
      utils.imports.history.invalidate({ campaignId, page: 1, pageSize: 10 });
    },
    onError: error => toast.error(error.message),
  });
  const validate = v2trpc.imports.validate.useMutation({
    onSuccess: () => {
      setStep(3);
      if (batchId) {
        utils.imports.getBatch.invalidate({ batchId });
        utils.imports.previewRows.invalidate();
        utils.imports.issues.invalidate();
      }
      utils.imports.history.invalidate();
      toast.success("Prévia validada. Nenhum lead foi criado ainda.");
    },
    onError: error => toast.error(error.message),
  });
  const confirm = v2trpc.imports.confirm.useMutation({
    onSuccess: () => {
      setStep(4);
      utils.imports.getBatch.invalidate();
      utils.imports.previewRows.invalidate();
      utils.imports.history.invalidate();
      utils.campaigns.get.invalidate({ id: campaignId });
      utils.leads.list.invalidate();
      toast.success("Importação concluída.");
    },
    onError: error => toast.error(error.message),
  });
  const savePolicy = v2trpc.imports.setCampaignPolicy.useMutation({
    onSuccess: () => {
      utils.imports.setup.invalidate({ campaignId });
      toast.success("Política de duplicidade atualizada");
    },
    onError: error => toast.error(error.message),
  });
  const saveField = v2trpc.imports.saveCustomField.useMutation({
    onSuccess: () => {
      setCustomField({
        key: "",
        label: "",
        fieldType: "text",
        options: "",
        isRequired: false,
      });
      utils.imports.setup.invalidate({ campaignId });
      toast.success("Campo personalizado salvo");
    },
    onError: error => toast.error(error.message),
  });

  const setupData = setup.data;
  const customFields = setupData?.customFields ?? [];
  const activeMappings = useMemo(
    () => mappings.filter(mapping => mapping.targetKey),
    [mappings]
  );
  const batch = v2trpc.imports.getBatch.useQuery(
    { batchId: batchId ?? 0 },
    { enabled: batchId !== null && step >= 3 }
  );

  const updateMapping = (sourceHeader: string, patch: Partial<MappingDraft>) =>
    setMappings(current =>
      current.map(mapping =>
        mapping.sourceHeader === sourceHeader
          ? { ...mapping, ...patch }
          : mapping
      )
    );

  const selectTarget = (sourceHeader: string, value: string) => {
    if (!value) {
      updateMapping(sourceHeader, {
        targetKind: "core",
        targetKey: "",
        valueType: "text",
      });
      return;
    }
    const [targetKind, targetKey] = value.split(":", 2) as [
      MappingDraft["targetKind"],
      string,
    ];
    updateMapping(sourceHeader, {
      targetKind,
      targetKey,
      valueType: typeForTarget(targetKind, targetKey, customFields),
    });
  };

  const applyTemplate = (value: string) => {
    setTemplateId(value);
    const selected = setupData?.templates.find(
      template => template.id === Number(value)
    );
    if (selected?.currentVersion) {
      setMappings(
        mappingsFromTemplate(
          mappings.map(mapping => mapping.sourceHeader),
          selected.currentVersion.fields
        )
      );
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLocaleLowerCase("pt-BR").endsWith(".csv")) {
      toast.error("Nesta etapa, selecione um arquivo CSV em UTF-8.");
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      toast.error("O arquivo excede o limite de 5 MB.");
      return;
    }
    try {
      setFile(selected);
      const base64 = await readFileAsBase64(selected);
      createDraft.mutate({
        campaignId,
        fileName: selected.name,
        base64,
        targetPdvId: targetPdv ? Number(targetPdv) : null,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao ler o arquivo"
      );
    }
  };

  if (!validCampaignId) {
    return (
      <main className="p-8 text-center text-sm text-muted-foreground">
        Campanha inválida.
      </main>
    );
  }
  if (setup.isLoading) {
    return (
      <main className="p-8 text-center text-sm text-muted-foreground">
        Carregando importador…
      </main>
    );
  }
  if (!setupData) {
    return (
      <main className="p-8 text-center text-sm text-muted-foreground">
        Campanha não encontrada ou sem acesso.
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Campanhas / Importações
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Importar leads</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {setupData.campaign.name} · o CSV é validado no servidor antes de
            qualquer lead ser criado.
          </p>
        </div>
        <Link href={`/v2/campaigns/${campaignId}`}>
          <Button variant="outline">← Campanha</Button>
        </Link>
      </header>

      <section className="grid gap-2 sm:grid-cols-4">
        {[
          [1, "Arquivo"],
          [2, "Mapeamento"],
          [3, "Prévia"],
          [4, "Resultado"],
        ].map(([number, label]) => (
          <div
            key={number}
            className={`rounded-lg border p-3 text-sm ${step === number ? "border-emerald-600 bg-emerald-50" : "text-muted-foreground"}`}
          >
            <strong>{number}.</strong> {label}
          </div>
        ))}
      </section>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>1. Arquivo e PDV de destino</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm font-medium">
                PDV para todo o arquivo
              </label>
              <Select value={targetPdv} onValueChange={setTargetPdv}>
                <SelectTrigger>
                  <SelectValue placeholder="Usar coluna PDV do arquivo" />
                </SelectTrigger>
                <SelectContent>
                  {setupData.pdvs.map(pdv => (
                    <SelectItem key={pdv.id} value={String(pdv.id)}>
                      {pdv.name} · {pdv.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Com vários PDVs, selecione um aqui ou mapeie uma coluna para PDV
                no próximo passo. O sistema não infere um PDV silenciosamente.
              </p>
            </div>
            <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center hover:bg-muted/30">
              <span className="font-medium">Selecionar CSV UTF-8</span>
              <span className="mt-2 text-xs text-muted-foreground">
                Aceita vírgula ou ponto e vírgula, até 5 MB e 20.000 linhas.
              </span>
              <input
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={upload}
                disabled={createDraft.isPending}
              />
              {file && (
                <span className="mt-3 max-w-full truncate text-sm text-muted-foreground">
                  {file.name}
                </span>
              )}
            </label>
          </CardContent>
        </Card>
      )}

      {step === 2 && batchId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Mapeamento das colunas</CardTitle>
              <p className="text-sm text-muted-foreground">
                Os nomes de cabeçalho vêm exclusivamente do seu arquivo; escolha
                o destino interno de cada coluna.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Template reutilizável
                  </label>
                  <Select value={templateId} onValueChange={applyTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar template" />
                    </SelectTrigger>
                    <SelectContent>
                      {setupData.templates.map(template => (
                        <SelectItem
                          key={template.id}
                          value={String(template.id)}
                        >
                          {template.name}
                          {template.currentVersion
                            ? ` · v${template.currentVersion.versionNumber}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {setupData.canManageTemplates && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Ou salvar como novo template
                    </label>
                    <Input
                      value={saveTemplateName}
                      onChange={event =>
                        setSaveTemplateName(event.target.value)
                      }
                      placeholder="Ex.: Base de loja parceira"
                    />
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Coluna do arquivo</th>
                      <th className="p-3">Destino</th>
                      <th className="p-3">Transformação</th>
                      <th className="p-3">Obrigatório</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map(mapping => (
                      <tr key={mapping.sourceHeader} className="border-t">
                        <td className="p-3 font-medium">
                          {mapping.sourceHeader}
                        </td>
                        <td className="p-3">
                          <select
                            className="h-9 w-full rounded-md border bg-background px-2"
                            value={
                              mapping.targetKey
                                ? `${mapping.targetKind}:${mapping.targetKey}`
                                : ""
                            }
                            onChange={event =>
                              selectTarget(
                                mapping.sourceHeader,
                                event.target.value
                              )
                            }
                          >
                            <option value="">Não importar esta coluna</option>
                            <optgroup label="Campos do lead">
                              {coreTargets.map(target => (
                                <option
                                  key={target.key}
                                  value={`core:${target.key}`}
                                >
                                  {target.label}
                                </option>
                              ))}
                            </optgroup>
                            {customFields.length > 0 && (
                              <optgroup label="Campos personalizados">
                                {customFields.map(field => (
                                  <option
                                    key={field.key}
                                    value={`custom:${field.key}`}
                                  >
                                    {field.label ?? field.key} · {field.key}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </td>
                        <td className="p-3">
                          <select
                            className="h-9 rounded-md border bg-background px-2"
                            value={mapping.transformKey ?? ""}
                            onChange={event =>
                              updateMapping(mapping.sourceHeader, {
                                transformKey: event.target.value || null,
                              })
                            }
                          >
                            <option value="">Sem transformação</option>
                            <option value="trim">Remover espaços</option>
                            <option value="lowercase">Minúsculas</option>
                            <option value="uppercase">Maiúsculas</option>
                            <option value="digits_only">Somente dígitos</option>
                          </select>
                        </td>
                        <td className="p-3">
                          <Checkbox
                            checked={mapping.isRequired}
                            disabled={!mapping.targetKey}
                            onCheckedChange={checked =>
                              updateMapping(mapping.sourceHeader, {
                                isRequired: checked === true,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    validate.isPending ||
                    !activeMappings.length ||
                    (!templateId && !saveTemplateName)
                  }
                  onClick={() =>
                    validate.mutate({
                      batchId,
                      mappings: activeMappings,
                      templateId: templateId ? Number(templateId) : null,
                      saveTemplateName: saveTemplateName || null,
                    })
                  }
                >
                  Validar e gerar prévia
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBatchId(null);
                    setStep(1);
                  }}
                >
                  Trocar arquivo
                </Button>
              </div>
              {!setupData.canManageTemplates && !templateId && (
                <p className="text-xs text-amber-700">
                  Seu perfil pode importar usando um template existente, mas não
                  pode criar ou alterar templates.
                </p>
              )}
            </CardContent>
          </Card>

          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>Campo personalizado de lead</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Input
                  value={customField.key}
                  onChange={event =>
                    setCustomField({ ...customField, key: event.target.value })
                  }
                  placeholder="Chave, ex.: documento"
                />
                <Input
                  value={customField.label}
                  onChange={event =>
                    setCustomField({
                      ...customField,
                      label: event.target.value,
                    })
                  }
                  placeholder="Nome exibido"
                />
                <select
                  className="h-10 rounded-md border bg-background px-2"
                  value={customField.fieldType}
                  onChange={event =>
                    setCustomField({
                      ...customField,
                      fieldType: event.target
                        .value as typeof customField.fieldType,
                    })
                  }
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="date">Data</option>
                  <option value="boolean">Booleano</option>
                  <option value="select">Seleção</option>
                </select>
                <Input
                  value={customField.options}
                  disabled={customField.fieldType !== "select"}
                  onChange={event =>
                    setCustomField({
                      ...customField,
                      options: event.target.value,
                    })
                  }
                  placeholder="Opções separadas por vírgula"
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={customField.isRequired}
                      onCheckedChange={checked =>
                        setCustomField({
                          ...customField,
                          isRequired: checked === true,
                        })
                      }
                    />{" "}
                    Obrigatório
                  </label>
                  <Button
                    size="sm"
                    disabled={saveField.isPending}
                    onClick={() =>
                      saveField.mutate({
                        key: customField.key,
                        label: customField.label,
                        fieldType: customField.fieldType,
                        options:
                          customField.fieldType === "select"
                            ? customField.options
                                .split(",")
                                .map(value => value.trim())
                                .filter(Boolean)
                            : null,
                        isRequired: customField.isRequired,
                        isActive: true,
                        sortOrder: customFields.length + 1,
                      })
                    }
                  >
                    Salvar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {step >= 3 && batchId && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Linhas</p>
                <p className="text-2xl font-semibold">
                  {batch.data?.totalRows ?? "…"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Válidas</p>
                <p className="text-2xl font-semibold">
                  {batch.data?.validRows ?? "…"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Inválidas</p>
                <p className="text-2xl font-semibold">
                  {batch.data?.invalidRows ?? "…"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Possíveis duplicidades
                </p>
                <p className="text-2xl font-semibold">
                  {batch.data?.duplicateRows ?? "…"}
                </p>
              </CardContent>
            </Card>
          </section>
          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>3. Prévia obrigatória</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Esta etapa ainda não criou leads. A confirmação abaixo é
                  explícita e só pode ser processada uma vez.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[650px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">Linha</th>
                        <th className="p-3">Situação</th>
                        <th className="p-3">Dados transformados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data?.items.map(row => (
                        <tr key={row.rowNumber} className="border-t">
                          <td className="p-3">{row.rowNumber}</td>
                          <td className="p-3">
                            <Badge
                              variant={
                                row.status === "invalid"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {row.status}
                            </Badge>
                          </td>
                          <td className="max-w-[580px] truncate p-3 font-mono text-xs">
                            {row.mappedData
                              ? JSON.stringify(row.mappedData)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!!issues.data?.items.length && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="mb-2 font-medium">Problemas encontrados</p>
                    <ul className="space-y-1 text-sm">
                      {issues.data.items.map(issue => (
                        <li key={`${issue.rowNumber}-${issue.code}`}>
                          Linha {issue.rowNumber}: {issue.details}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Button
                  disabled={
                    confirm.isPending || batch.data?.status !== "validated"
                  }
                  onClick={() => confirm.mutate({ batchId })}
                >
                  Confirmar importação
                </Button>
              </CardContent>
            </Card>
          )}
          {step === 4 && (
            <Card>
              <CardHeader>
                <CardTitle>4. Resultado da importação</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <strong>Importados:</strong> {batch.data?.importedRows ?? 0}
                </p>
                <p>
                  <strong>Atualizados com segurança:</strong>{" "}
                  {batch.data?.updatedRows ?? 0}
                </p>
                <p>
                  <strong>Recusados:</strong> {batch.data?.rejectedRows ?? 0}
                </p>
                <Link href={`/v2/leads?campaignId=${campaignId}`}>
                  <Button className="mt-3">Abrir leads da campanha</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Política de duplicidade da campanha</CardTitle>
            <p className="text-sm text-muted-foreground">
              O override da campanha prevalece sobre o padrão do parceiro.
              Atualizações seguras jamais alteram responsável, status, timeline,
              follow-ups ou evidências.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <select
              className="h-10 rounded-md border bg-background px-2"
              value={policyMode}
              onChange={event =>
                setPolicyMode(event.target.value as "inherit" | "override")
              }
            >
              <option value="inherit">Usar padrão do parceiro</option>
              <option value="override">Usar override da campanha</option>
            </select>
            <select
              className="h-10 rounded-md border bg-background px-2"
              disabled={policyMode === "inherit"}
              value={policy}
              onChange={event => setPolicy(event.target.value as typeof policy)}
            >
              <option value="reject">REJECT — recusar</option>
              <option value="allow">ALLOW — permitir</option>
              <option value="update_safe_fields">
                UPDATE_SAFE_FIELDS — atualizar campos seguros
              </option>
            </select>
            <select
              className="h-10 rounded-md border bg-background px-2"
              disabled={policyMode === "inherit"}
              value={matchStrategy}
              onChange={event =>
                setMatchStrategy(event.target.value as typeof matchStrategy)
              }
            >
              <option value="phone_or_email">Telefone ou e-mail</option>
              <option value="phone">Telefone</option>
              <option value="email">E-mail</option>
              <option value="phone_and_email">Telefone e e-mail</option>
            </select>
            <Button
              disabled={savePolicy.isPending}
              onClick={() =>
                savePolicy.mutate({
                  campaignId,
                  setting:
                    policyMode === "inherit"
                      ? { mode: "inherit" }
                      : {
                          mode: "override",
                          policy,
                          matchStrategy,
                          safeUpdateFields: [
                            "name",
                            "phone",
                            "email",
                            "sourceId",
                            "customData",
                          ],
                        },
                })
              }
            >
              Salvar política
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de importações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.data?.items.map(item => (
            <article
              key={item.id}
              className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
            >
              <div>
                <p className="font-medium">{item.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {item.templateName
                    ? `${item.templateName} · v${item.templateVersionNumber}`
                    : "Template pendente"}{" "}
                  · {item.importerName ?? "Super Admin"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">{item.importedRows} importados</span>
                <Badge variant={statusBadge(item.status)}>
                  {batchStatusLabels[item.status]}
                </Badge>
              </div>
            </article>
          ))}
          {!history.data?.items.length && (
            <p className="text-sm text-muted-foreground">
              Ainda não há importações nesta campanha.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
