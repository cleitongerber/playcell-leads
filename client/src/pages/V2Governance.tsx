import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  useEffect(() => {
    if (governance.data) setForm(governanceRuleToForm(governance.data));
  }, [governance.data]);
  const save = v2trpc.governance.updatePartner.useMutation({
    onSuccess: data => {
      setForm(governanceRuleToForm(data));
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
    <main className="v2-page space-y-6">
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
      <Card className="v2-section-card">
        <CardHeader>
          <CardTitle>Regra padrão do parceiro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!canManage ? (
            <p className="text-sm text-muted-foreground">
              Seu perfil não pode alterar as regras de governança.
            </p>
          ) : (
            <>
              <GovernanceRuleEditor
                value={form}
                outcomes={treatmentResults.data ?? []}
                onChange={setForm}
                disabled={treatmentResults.isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Print de WhatsApp é tratado como evidência anexada; o sistema
                não o interpreta como comprovação automática de uma conversa.
              </p>
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
              <Button
                disabled={
                  save.isPending ||
                  treatmentResults.isLoading ||
                  validationIssues.length > 0
                }
                onClick={() => save.mutate(governanceFormToInput(form))}
              >
                Salvar regra padrão
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
