import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { v2trpc } from "@/lib/v2trpc";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type DuplicatePolicy = "reject" | "allow" | "update_safe_fields";
type MatchStrategy = "phone" | "email" | "phone_or_email" | "phone_and_email";
type FieldType = "text" | "number" | "date" | "boolean" | "select";

export default function V2ImportConfiguration() {
  const access = v2trpc.access.context.useQuery();
  const canManage =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const policyQuery = v2trpc.imports.partnerPolicy.useQuery(undefined, {
    enabled: canManage,
  });
  const fields = v2trpc.imports.customFields.useQuery(
    { includeInactive: true },
    { enabled: canManage }
  );
  const templates = v2trpc.imports.templates.useQuery(
    { includeInactive: true },
    {
      enabled: canManage,
    }
  );
  const utils = v2trpc.useUtils();
  const [policy, setPolicy] = useState<DuplicatePolicy>("reject");
  const [matchStrategy, setMatchStrategy] =
    useState<MatchStrategy>("phone_or_email");
  const [field, setField] = useState({
    key: "",
    label: "",
    fieldType: "text" as FieldType,
    options: "",
    isRequired: false,
  });
  useEffect(() => {
    if (!policyQuery.data) return;
    setPolicy(policyQuery.data.policy);
    setMatchStrategy(policyQuery.data.matchStrategy);
  }, [policyQuery.data]);
  const savePolicy = v2trpc.imports.setPartnerPolicy.useMutation({
    onSuccess: () => {
      utils.imports.partnerPolicy.invalidate();
      toast.success("Política padrão de importação atualizada");
    },
    onError: error => toast.error(error.message),
  });
  const saveField = v2trpc.imports.saveCustomField.useMutation({
    onSuccess: () => {
      setField({
        key: "",
        label: "",
        fieldType: "text",
        options: "",
        isRequired: false,
      });
      utils.imports.customFields.invalidate();
      toast.success("Campo personalizado salvo");
    },
    onError: error => toast.error(error.message),
  });
  const setTemplateActive = v2trpc.imports.setTemplateActive.useMutation({
    onSuccess: () => {
      utils.imports.templates.invalidate();
      toast.success("Template atualizado");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <main className="v2-page space-y-6">
      <V2PageHeader eyebrow="V2 / Administração" title="Configuração de importações" description="Defina a política padrão, campos personalizados e templates reutilizáveis do parceiro." actions={<Link href="/v2/admin"><Button variant="outline">← Administração V2</Button></Link>} />
      {!canManage ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Seu perfil não pode administrar templates, campos ou políticas de
            importação.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Política padrão de duplicidade</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <select
                className="h-10 rounded-md border bg-background px-2"
                value={policy}
                onChange={event =>
                  setPolicy(event.target.value as DuplicatePolicy)
                }
              >
                <option value="reject">REJECT — recusar duplicados</option>
                <option value="allow">ALLOW — permitir duplicados</option>
                <option value="update_safe_fields">
                  UPDATE_SAFE_FIELDS — atualizar campos seguros
                </option>
              </select>
              <select
                className="h-10 rounded-md border bg-background px-2"
                value={matchStrategy}
                onChange={event =>
                  setMatchStrategy(event.target.value as MatchStrategy)
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
                    policy,
                    matchStrategy,
                    safeUpdateFields: [
                      "name",
                      "phone",
                      "email",
                      "sourceId",
                      "customData",
                    ],
                  })
                }
              >
                Salvar padrão
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Campos personalizados de lead</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Input
                  value={field.key}
                  onChange={event =>
                    setField({ ...field, key: event.target.value })
                  }
                  placeholder="Chave"
                />
                <Input
                  value={field.label}
                  onChange={event =>
                    setField({ ...field, label: event.target.value })
                  }
                  placeholder="Nome exibido"
                />
                <select
                  className="h-10 rounded-md border bg-background px-2"
                  value={field.fieldType}
                  onChange={event =>
                    setField({
                      ...field,
                      fieldType: event.target.value as FieldType,
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
                  disabled={field.fieldType !== "select"}
                  value={field.options}
                  onChange={event =>
                    setField({ ...field, options: event.target.value })
                  }
                  placeholder="Opções por vírgula"
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.isRequired}
                      onCheckedChange={value =>
                        setField({ ...field, isRequired: value === true })
                      }
                    />{" "}
                    Obrigatório
                  </label>
                  <Button
                    size="sm"
                    disabled={saveField.isPending}
                    onClick={() =>
                      saveField.mutate({
                        key: field.key,
                        label: field.label,
                        fieldType: field.fieldType,
                        options:
                          field.fieldType === "select"
                            ? field.options
                                .split(",")
                                .map(value => value.trim())
                                .filter(Boolean)
                            : null,
                        isRequired: field.isRequired,
                        isActive: true,
                        sortOrder: (fields.data?.length ?? 0) + 1,
                      })
                    }
                  >
                    Salvar
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {fields.data?.map(item => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{item.label ?? item.key}</p>
                      <p className="text-muted-foreground">
                        {item.key} · {item.fieldType}
                        {item.isRequired ? " · obrigatório" : ""}
                      </p>
                    </div>
                    <Badge variant={item.isActive ? "secondary" : "outline"}>
                      {item.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                ))}
                {!fields.data?.length && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum campo personalizado cadastrado.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Templates de importação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {templates.data?.map(template => (
                <div
                  key={template.id}
                  className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="font-medium">{template.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {template.currentVersion
                        ? `Versão atual: v${template.currentVersion.versionNumber} · ${template.currentVersion.fields.length} campo(s)`
                        : "Sem versão"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setTemplateActive.isPending}
                    onClick={() =>
                      setTemplateActive.mutate({
                        templateId: template.id,
                        isActive: !template.isActive,
                      })
                    }
                  >
                    {template.isActive ? "Inativar" : "Reativar"}
                  </Button>
                </div>
              ))}
              {!templates.data?.length && (
                <p className="text-sm text-muted-foreground">
                  Salve um mapeamento no assistente de importação para criar o
                  primeiro template.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
