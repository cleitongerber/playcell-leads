import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  blankGovernanceRule,
  GovernanceRuleEditor,
  governanceRuleIssueAnchor,
  governanceRuleValidationIssues,
  governanceFormToInput,
  governanceRuleToForm,
  type GovernanceRuleFormValue,
} from "@/components/v2/GovernanceRuleEditor";
import { v2trpc } from "@/lib/v2trpc";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { KpiCard, SectionCard } from "@/components/v2/V2Layout";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function V2Governance() {
  const access = v2trpc.access.context.useQuery();
  const governance = v2trpc.governance.partner.useQuery(undefined, {
    enabled:
      access.data?.role === "super_admin" ||
      access.data?.role === "partner_admin",
  });
  const treatmentResults = v2trpc.interactionResults.list.useQuery(
    { interactionKind: "effective_contact" },
    {
      enabled:
        access.data?.role === "super_admin" ||
        access.data?.role === "partner_admin",
    }
  );
  const [form, setForm] =
    useState<GovernanceRuleFormValue>(blankGovernanceRule);
  const [editingRule, setEditingRule] = useState(false);
  useEffect(() => {
    if (governance.data) setForm(governanceRuleToForm(governance.data));
  }, [governance.data]);
  const save = v2trpc.governance.updatePartner.useMutation({
    onSuccess: data => {
      setForm(governanceRuleToForm(data));
      setEditingRule(false);
      toast.success("Governança operacional atualizada");
    },
    onError: error => toast.error(error.message),
  });
  const canManage =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const validationIssues = governanceRuleValidationIssues(
    form,
    treatmentResults.data ?? []
  );
  return (
    <main className="v2-page v2-governance-page space-y-6">
      <V2PageHeader
        eyebrow="Administração"
        title="Governança operacional"
        description="Defina os requisitos padrão de qualidade das tratativas deste parceiro. Uma campanha pode usar este padrão ou declarar seu próprio override."
        actions={
          <Link href="/v2/admin">
            <Button variant="outline">← Administração</Button>
          </Link>
        }
      />
      <section className="v2-metric-grid v2-governance-summary">
        <KpiCard label="Canais autorizados" value={form.allowedChannels?.length ?? "Todos"} detail={form.allowedChannels ? "configurados" : "sem restrição"} />
        <KpiCard label="Resultados permitidos" value={form.allowedOutcomes?.length ?? "Todos"} detail={form.allowedOutcomes ? "selecionados" : "sem restrição"} />
        <KpiCard label="Evidência" value={form.evidenceRequired ? "Obrigatória" : "Por canal"} detail={form.evidenceRequired ? "em todas as tratativas" : `${form.evidenceRequiredChannels.length} canal(is)`} />
        <KpiCard label="Follow-up" value={form.followUpRequired ? "Obrigatório" : "Conforme resultado"} detail="regra vigente" />
      </section>
      <SectionCard className="v2-governance-rule-card">
        <CardHeader className="border-b border-border/70 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Regra em vigor</p>
          <CardTitle>Regra padrão do parceiro</CardTitle>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Consulte o resumo acima antes de ajustar os requisitos operacionais. Campanhas podem herdar esta regra ou usar um override próprio.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {!canManage ? (
            <p className="text-sm text-muted-foreground">
              Seu perfil não pode alterar as regras de governança.
            </p>
          ) : (
            <>
              {validationIssues.length > 0 && (
                <div
                  role="alert"
                  className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
                >
                  <p className="font-medium">
                    Revise {validationIssues.length} configuraç
                    {validationIssues.length === 1 ? "ão" : "ões"} antes de
                    salvar.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {validationIssues.map(issue => (
                      <li key={issue.field}>
                        <a
                          className="underline"
                          href={`#${governanceRuleIssueAnchor(issue.field)}`}
                        >
                          {issue.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!editingRule && validationIssues.length === 0 ? (
                <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">Configuração pronta para consulta</p>
                    <p className="text-sm text-muted-foreground">Edite apenas quando precisar revisar requisitos, canais, evidências ou resultados permitidos.</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setEditingRule(true)}>Editar regra padrão</Button>
                </div>
              ) : null}
              {(editingRule || validationIssues.length > 0) && (
                <div className="v2-governance-editor space-y-5">
                  <GovernanceRuleEditor
                    value={form}
                    outcomes={treatmentResults.data ?? []}
                    onChange={setForm}
                    disabled={treatmentResults.isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    Print de WhatsApp é tratado como evidência anexada; o sistema não o interpreta como comprovação automática de uma conversa.
                  </p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => { setForm(governance.data ? governanceRuleToForm(governance.data) : blankGovernanceRule); setEditingRule(false); }} disabled={save.isPending}>Cancelar</Button>
                    <Button
                      disabled={save.isPending || treatmentResults.isLoading || validationIssues.length > 0}
                      onClick={() => save.mutate(governanceFormToInput(form))}
                    >
                      Salvar regra padrão
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </SectionCard>
    </main>
  );
}
