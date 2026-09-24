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
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <Link href="/v2/admin">
        <Button variant="outline">← Administração V2</Button>
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
          V2 / Administração
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Governança operacional</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Defina os requisitos padrão de qualidade das tratativas deste
          parceiro. Uma campanha pode usar este padrão ou declarar seu próprio
          override.
        </p>
      </header>
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
