import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  blankGovernanceRule,
  GovernanceRuleEditor,
  governanceFormToInput,
  governanceRuleToForm,
  type GovernanceRuleFormValue,
} from "@/components/v2/GovernanceRuleEditor";
import { CampaignLeadManagement } from "@/components/v2/CampaignLeadManagement";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { V2ErrorState, V2LoadingState } from "@/components/v2/V2QueryState";
import { v2trpc } from "@/lib/v2trpc";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useRoute } from "wouter";

type CampaignForm = {
  code: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  pdvIds: number[];
};
const blank: CampaignForm = {
  code: "",
  name: "",
  description: "",
  startsAt: "",
  endsAt: "",
  pdvIds: [],
};
const statusLabel = {
  draft: "Rascunho",
  active: "Ativa",
  closed: "Fechada",
  archived: "Arquivada",
} as const;

function toDate(value: string) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

export default function V2Campaigns() {
  const [form, setForm] = useState<CampaignForm>(blank);
  const campaigns = v2trpc.campaigns.list.useQuery({ includeArchived: true });
  const pdvs = v2trpc.pdvs.list.useQuery({ includeInactive: false });
  const access = v2trpc.access.context.useQuery();
  const utils = v2trpc.useUtils();
  const canManage =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const create = v2trpc.campaigns.create.useMutation({
    onSuccess: () => {
      setForm(blank);
      utils.campaigns.list.invalidate();
      toast.success("Campanha criada como rascunho");
    },
    onError: error => toast.error(error.message),
  });
  const activePdvs = useMemo(() => pdvs.data ?? [], [pdvs.data]);
  const toggle = (id: number) =>
    setForm(current => ({
      ...current,
      pdvIds: current.pdvIds.includes(id)
        ? current.pdvIds.filter(value => value !== id)
        : [...current.pdvIds, id],
    }));

  return (
    <main className="v2-page space-y-6">
      <V2PageHeader eyebrow="V2 / Operação" title="Campanhas" description="Crie a campanha, defina os PDVs e deixe-a pronta para a importação de Leads." />
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Nova campanha</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                create.mutate({
                  code: form.code,
                  name: form.name,
                  description: form.description || null,
                  startsAt: toDate(form.startsAt),
                  endsAt: toDate(form.endsAt),
                  pdvIds: form.pdvIds,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  required
                  placeholder="Código da campanha"
                  value={form.code}
                  onChange={event =>
                    setForm({ ...form, code: event.target.value })
                  }
                />
                <Input
                  required
                  placeholder="Nome"
                  value={form.name}
                  onChange={event =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </div>
              <Textarea
                placeholder="Descrição (opcional)"
                value={form.description}
                onChange={event =>
                  setForm({ ...form, description: event.target.value })
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  value={form.startsAt}
                  onChange={event =>
                    setForm({ ...form, startsAt: event.target.value })
                  }
                />
                <Input
                  type="date"
                  value={form.endsAt}
                  onChange={event =>
                    setForm({ ...form, endsAt: event.target.value })
                  }
                />
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">PDVs participantes</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {activePdvs.map(pdv => (
                    <label
                      key={pdv.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={form.pdvIds.includes(pdv.id)}
                        onCheckedChange={() => toggle(pdv.id)}
                      />
                      {pdv.name}
                    </label>
                  ))}
                </div>
              </div>
              <Button
                className="w-fit"
                disabled={create.isPending || !form.pdvIds.length}
              >
                Salvar rascunho
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Campanhas do parceiro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {campaigns.data?.map(campaign => (
            <Link key={campaign.id} href={`/v2/campaigns/${campaign.id}`}>
              <div className="cursor-pointer rounded-lg border p-4 transition hover:bg-muted/40">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{campaign.name}</p>
                  <Badge
                    variant={
                      campaign.status === "active" ? "secondary" : "outline"
                    }
                  >
                    {statusLabel[campaign.status]}
                  </Badge>
                  {campaign.isFrozen && (
                    <Badge variant="destructive">Congelada</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {campaign.code}
                  {campaign.description ? ` · ${campaign.description}` : ""}
                </p>
              </div>
            </Link>
          ))}
          {!campaigns.data?.length && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma campanha visível neste escopo.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export function V2CampaignDetail() {
  const [, params] = useRoute("/v2/campaigns/:id");
  const id = Number(params?.id);
  const detail = v2trpc.campaigns.get.useQuery(
    { id },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const access = v2trpc.access.context.useQuery();
  const pdvs = v2trpc.pdvs.list.useQuery({ includeInactive: false });
  const utils = v2trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CampaignForm>(blank);
  const [governanceMode, setGovernanceMode] = useState<"inherit" | "override">(
    "inherit"
  );
  const [governanceForm, setGovernanceForm] =
    useState<GovernanceRuleFormValue>(blankGovernanceRule);
  const transition = v2trpc.campaigns.transition.useMutation({
    onSuccess: () => {
      utils.campaigns.get.invalidate({ id });
      utils.campaigns.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const freeze = v2trpc.campaigns.setFrozen.useMutation({
    onSuccess: () => utils.campaigns.get.invalidate({ id }),
    onError: error => toast.error(error.message),
  });
  const update = v2trpc.campaigns.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      utils.campaigns.get.invalidate({ id });
      utils.campaigns.list.invalidate();
      toast.success("Campanha atualizada");
    },
    onError: error => toast.error(error.message),
  });
  const campaign = detail.data?.campaign;
  const canManage =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin";
  const canImport =
    access.data?.role === "super_admin" ||
    access.data?.role === "partner_admin" ||
    access.data?.role === "manager";
  const canDistribute = canImport;
  const campaignGovernance = v2trpc.governance.campaign.useQuery(
    { campaignId: id },
    { enabled: canManage && Number.isInteger(id) && id > 0 }
  );
  useEffect(() => {
    if (!campaignGovernance.data) return;
    setGovernanceMode(
      campaignGovernance.data.source === "campaign" ? "override" : "inherit"
    );
    setGovernanceForm(governanceRuleToForm(campaignGovernance.data.rule));
  }, [campaignGovernance.data]);
  const setCampaignGovernance = v2trpc.governance.setCampaign.useMutation({
    onSuccess: data => {
      setGovernanceMode(data.source === "campaign" ? "override" : "inherit");
      setGovernanceForm(governanceRuleToForm(data.rule));
      toast.success("Regra de governança da campanha atualizada");
    },
    onError: error => toast.error(error.message),
  });
  const beginEdit = () =>
    setForm({
      code: campaign?.code ?? "",
      name: campaign?.name ?? "",
      description: campaign?.description ?? "",
      startsAt: campaign?.startsAt
        ? campaign.startsAt.toISOString().slice(0, 10)
        : "",
      endsAt: campaign?.endsAt
        ? campaign.endsAt.toISOString().slice(0, 10)
        : "",
      pdvIds: detail.data?.pdvs.map(pdv => pdv.id) ?? [],
    });
  const togglePdv = (pdvId: number) =>
    setForm(current => ({
      ...current,
      pdvIds: current.pdvIds.includes(pdvId)
        ? current.pdvIds.filter(item => item !== pdvId)
        : [...current.pdvIds, pdvId],
    }));
  if (detail.isLoading) return <main className="v2-page"><V2LoadingState label="Carregando campanha" /></main>;
  if (!campaign)
    return <main className="v2-page"><V2ErrorState message="Campanha não encontrada ou sem acesso." /></main>;
  const nextStatus =
    campaign.status === "draft"
      ? "active"
      : campaign.status === "active"
        ? "closed"
        : campaign.status === "closed"
          ? "archived"
          : null;
  return (
    <main className="v2-page space-y-6">
      <V2PageHeader eyebrow="V2 / Campanha" title={campaign.name} description={`${campaign.code} · ${campaign.description || "Sem descrição"}`} actions={<><Badge>{statusLabel[campaign.status]}</Badge>{campaign.isFrozen && <Badge variant="destructive">Congelada</Badge>}<Link href="/v2/campaigns"><Button variant="outline">← Campanhas</Button></Link></>} />
      <Card>
        <CardHeader>
          <CardTitle>{editing ? "Editar rascunho" : "Visão geral"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <form
              className="space-y-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                update.mutate({
                  id,
                  code: form.code,
                  name: form.name,
                  description: form.description || null,
                  startsAt: toDate(form.startsAt),
                  endsAt: toDate(form.endsAt),
                  pdvIds: form.pdvIds,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  required
                  value={form.code}
                  onChange={event =>
                    setForm({ ...form, code: event.target.value })
                  }
                  placeholder="Código"
                />
                <Input
                  required
                  value={form.name}
                  onChange={event =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Nome"
                />
              </div>
              <Textarea
                value={form.description}
                onChange={event =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="Descrição"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  value={form.startsAt}
                  onChange={event =>
                    setForm({ ...form, startsAt: event.target.value })
                  }
                />
                <Input
                  type="date"
                  value={form.endsAt}
                  onChange={event =>
                    setForm({ ...form, endsAt: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {pdvs.data?.map(pdv => (
                  <label
                    key={pdv.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={form.pdvIds.includes(pdv.id)}
                      onCheckedChange={() => togglePdv(pdv.id)}
                    />
                    {pdv.name}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button disabled={update.isPending || !form.pdvIds.length}>
                  Salvar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-sm">
                  <strong>Início:</strong>{" "}
                  {campaign.startsAt?.toLocaleDateString("pt-BR") ||
                    "Não definido"}
                </p>
                <p className="text-sm">
                  <strong>Fim:</strong>{" "}
                  {campaign.endsAt?.toLocaleDateString("pt-BR") ||
                    "Não definido"}
                </p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">
                  PDVs participantes visíveis no seu escopo
                </p>
                <div className="flex flex-wrap gap-2">
                  {detail.data?.pdvs.map(pdv => (
                    <Badge key={pdv.id} variant="outline">
                      {pdv.name}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
                <span>
                  <strong>Total:</strong> {detail.data?.metrics.total}
                </span>
                <span>
                  <strong>Disponíveis:</strong> {detail.data?.metrics.available}
                </span>
                <span>
                  <strong>Em tratamento:</strong>{" "}
                  {detail.data?.metrics.inProgress}
                </span>
                <span>
                  <strong>Concluídos:</strong> {detail.data?.metrics.completed}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/v2/leads?campaignId=${id}`}>
                  <Button variant="outline">Ver leads</Button>
                </Link>
                {canImport &&
                  (campaign.status === "draft" ||
                    campaign.status === "active") &&
                  !campaign.isFrozen && (
                    <Link href={`/v2/campaigns/${id}/imports`}>
                      <Button variant="outline">Importações</Button>
                    </Link>
                  )}
                {canManage && campaign.status === "draft" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      beginEdit();
                      setEditing(true);
                    }}
                  >
                    Editar
                  </Button>
                )}
                {canManage && nextStatus && (
                  <Button
                    onClick={() =>
                      transition.mutate({ id, status: nextStatus })
                    }
                  >
                    {nextStatus === "active"
                      ? "Ativar"
                      : nextStatus === "closed"
                        ? "Fechar"
                        : "Arquivar"}
                  </Button>
                )}
                {canManage && campaign.status !== "archived" && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      freeze.mutate({ id, isFrozen: !campaign.isFrozen })
                    }
                  >
                    {campaign.isFrozen ? "Descongelar" : "Congelar"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {canDistribute && (
        <CampaignLeadManagement
          campaign={{
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            isFrozen: campaign.isFrozen,
          }}
        />
      )}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Governança da campanha</CardTitle>
            <p className="text-sm text-muted-foreground">
              A campanha pode herdar a regra padrão do parceiro ou usar um
              override próprio.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={governanceMode === "inherit" ? "default" : "outline"}
                onClick={() => setGovernanceMode("inherit")}
              >
                Usar padrão do parceiro
              </Button>
              <Button
                size="sm"
                variant={governanceMode === "override" ? "default" : "outline"}
                onClick={() => setGovernanceMode("override")}
              >
                Criar override
              </Button>
            </div>
            {governanceMode === "inherit" ? (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                A regra efetiva vem do parceiro. Nenhuma cópia da configuração
                será mantida nesta campanha.
              </p>
            ) : (
              <GovernanceRuleEditor
                value={governanceForm}
                onChange={setGovernanceForm}
              />
            )}
            <Button
              disabled={setCampaignGovernance.isPending}
              onClick={() =>
                setCampaignGovernance.mutate({
                  campaignId: id,
                  setting:
                    governanceMode === "inherit"
                      ? { mode: "inherit" }
                      : {
                          mode: "override",
                          rule: governanceFormToInput(governanceForm),
                        },
                })
              }
            >
              Salvar regra da campanha
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Importações</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            O importador V2 usa mapeamento configurável, prévia obrigatória e
            histórico versionado. Distribuição automática permanece em etapa
            futura.
          </p>
          {canImport &&
            (campaign.status === "draft" || campaign.status === "active") &&
            !campaign.isFrozen && (
              <Link href={`/v2/campaigns/${id}/imports`}>
                <Button className="mt-4" variant="outline">
                  Abrir importações
                </Button>
              </Link>
            )}
        </CardContent>
      </Card>
    </main>
  );
}
