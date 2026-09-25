import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  blankGovernanceRule,
  GovernanceRuleEditor,
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
  return (
    <main className="v2-page space-y-6">
      <V2PageHeader eyebrow="V2 / Administração" title="Governança operacional" description="Defina os requisitos padrão de qualidade das tratativas deste parceiro. Uma campanha pode usar este padrão ou declarar seu próprio override." actions={<Link href="/v2/admin"><Button variant="outline">← Administração V2</Button></Link>} />
      <Card>
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
              <GovernanceRuleEditor value={form} onChange={setForm} />
              <p className="text-xs text-muted-foreground">
                Print de WhatsApp é tratado como evidência anexada; o sistema
                não o interpreta como comprovação automática de uma conversa.
              </p>
              <Button
                disabled={save.isPending}
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
