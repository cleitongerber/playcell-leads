import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { v2trpc } from "@/lib/v2trpc";
import { V2PageHeader } from "@/components/v2/V2PageHeader";
import { useV2Session } from "@/components/v2/V2AppShell";
import {
  DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
  WHATSAPP_TEMPLATE_VARIABLES,
  renderWhatsAppInitialMessage,
} from "@shared/whatsappContact";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ManagementUsersPanel } from "@/components/v2/ManagementUsersPanel";

type Role = "partner_admin" | "manager" | "seller";
type AdminSection = "users" | "access" | "pdvs" | "settings";
type SalesScriptCategory = "opening" | "introduction" | "discovery" | "offer" | "objections" | "closing" | "follow_up";
type SalesScriptScope = "all_campaigns" | "specific_campaigns";
const salesScriptCategoryLabel: Record<SalesScriptCategory, string> = {
  opening: "Abertura", introduction: "Apresentação", discovery: "Descoberta", offer: "Oferta",
  objections: "Objeções", closing: "Fechamento", follow_up: "Retomada",
};
const roleLabel: Record<Role, string> = {
  partner_admin: "Administrador do parceiro",
  manager: "Gestor",
  seller: "Vendedor",
};

export default function V2Administration() {
  const session = useV2Session();
  return (
    <V2AdministrationContent
      isSuperAdmin={session.systemRole === "super_admin"}
    />
  );
}

function V2AdministrationContent({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const utils = v2trpc.useUtils();
  const [partnerId, setPartnerId] = useState(() => {
    try {
      return localStorage.getItem("v2-active-partner") ?? "";
    } catch {
      return "";
    }
  });
 const [adminSection, setAdminSection] = useState<AdminSection>("users");
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createPdvOpen, setCreatePdvOpen] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ code: "", name: "" });
  const [pdvForm, setPdvForm] = useState({
    code: "",
    name: "",
    city: "",
    region: "",
  });
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "seller" as Role,
    pdvIds: [] as number[],
  });
  const [editing, setEditing] = useState<{
    membershipId: number;
    name: string;
    email: string;
    role: Role;
    isActive: boolean;
    pdvIds: number[];
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<{
    membershipId: number;
    name: string;
  } | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [whatsappTemplate, setWhatsappTemplate] = useState("");
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [scriptCategory, setScriptCategory] = useState<"all" | SalesScriptCategory>("all");
  const [scriptCampaign, setScriptCampaign] = useState("all");
  const [editingScript, setEditingScript] = useState<any>(null);
  const [deleteScript, setDeleteScript] = useState<any>(null);
  const [confirmSuggestedLibrary, setConfirmSuggestedLibrary] = useState(false);
  const emptyScript = () => ({ category: "opening" as SalesScriptCategory, title: "", content: "", scope: "all_campaigns" as SalesScriptScope, campaignIds: [] as number[] });
  const [scriptForm, setScriptForm] = useState(emptyScript);
  const whatsappTemplateInputRef = useRef<HTMLTextAreaElement>(null);
  const enabled = Boolean(partnerId);
  const selectablePartners = v2trpc.partners.available.useQuery();
  const partnerAccess = v2trpc.access.context.useQuery(undefined, { enabled });
  const canAdminister =
    isSuperAdmin || partnerAccess.data?.role === "partner_admin";
  const pdvs = v2trpc.pdvs.list.useQuery(
    { includeInactive: true },
    { enabled: enabled && canAdminister }
  );
  const users = v2trpc.users.list.useQuery(undefined, {
    enabled: enabled && canAdminister,
  });
  const whatsappTemplateQuery =
    v2trpc.partnerSettings.whatsappTemplate.useQuery(undefined, {
      enabled: enabled && canAdminister,
    });
  const campaigns = v2trpc.campaigns.list.useQuery(
    { includeArchived: true }, { enabled: enabled && canAdminister }
  );
  const salesScripts = v2trpc.salesScripts.list.useQuery(
    {
      category: scriptCategory === "all" ? undefined : scriptCategory,
      campaignId: scriptCampaign === "all" ? undefined : Number(scriptCampaign),
    }, { enabled: enabled && canAdminister }
  );
  const refresh = () => {
    utils.pdvs.list.invalidate();
    utils.users.list.invalidate();
  };
  const refreshScripts = () => utils.salesScripts.list.invalidate();
  useEffect(() => {
    if (whatsappTemplateQuery.data?.template) {
      setWhatsappTemplate(whatsappTemplateQuery.data.template);
    }
  }, [whatsappTemplateQuery.data?.template]);
  const selectPartner = (value: string) => {
    if (value === partnerId) return;
    try {
      if (value) localStorage.setItem("v2-active-partner", value);
      else localStorage.removeItem("v2-active-partner");
    } catch {
      /* browser storage is optional */
    }
    setPartnerId(value);
    // The shell and tRPC cache both derive their tenant context from this
    // value. Reloading makes the visible partner and every query switch as one
    // operation, rather than leaving Administration in a different context.
    if (typeof window !== "undefined") window.location.reload();
  };
  useEffect(() => {
    if (!selectablePartners.data) return;
    const selected = selectablePartners.data.find(
      partner => String(partner.id) === partnerId
    );
    if (partnerId && !selected) {
      selectPartner("");
      return;
    }
    if (!partnerId) {
      const active = selectablePartners.data.filter(
        partner => partner.isActive
      );
      if (active.length === 1) selectPartner(String(active[0].id));
    }
  }, [partnerId, selectablePartners.data]);
  const createPartner = v2trpc.partners.create.useMutation({
    onSuccess: id => {
      setPartnerForm({ code: "", name: "" });
      utils.partners.available.invalidate();
      toast.success("Parceiro criado. Abrindo o novo contexto.");
      selectPartner(String(id));
    },
    onError: error => toast.error(error.message),
  });
  const createPdv = v2trpc.pdvs.create.useMutation({
    onSuccess: () => {
      setPdvForm({ code: "", name: "", city: "", region: "" });
      setCreatePdvOpen(false);
      refresh();
      toast.success("PDV criado");
    },
    onError: error => toast.error(error.message),
  });
  const togglePdv = v2trpc.pdvs.setActive.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const createUser = v2trpc.users.create.useMutation({
    onSuccess: () => {
      setUserForm({
        name: "",
        email: "",
        password: "",
        role: "seller",
        pdvIds: [],
      });
      setCreateUserOpen(false);
      refresh();
      toast.success("Usuário e acesso criados");
    },
    onError: error => toast.error(error.message),
  });
  const updateMembership = v2trpc.users.updateMembership.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
      toast.success("Acesso atualizado");
    },
    onError: error => toast.error(error.message),
  });
  const updateUser = v2trpc.users.update.useMutation({
    onError: error => toast.error(error.message),
  });
  const resetPassword = v2trpc.users.resetPassword.useMutation({
    onSuccess: () => {
      setResetTarget(null);
      setTemporaryPassword("");
      toast.success(
        "Senha temporária definida. O usuário deverá alterá-la no próximo acesso."
      );
    },
    onError: error => toast.error(error.message),
  });
  const globalStatus = v2trpc.users.setGlobalActive.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const saveWhatsappTemplate =
    v2trpc.partnerSettings.updateWhatsappTemplate.useMutation({
      onSuccess: data => {
        setWhatsappTemplate(data.template);
        utils.partnerSettings.whatsappTemplate.setData(undefined, data);
        toast.success("Mensagem inicial do WhatsApp atualizada");
      },
      onError: error => toast.error(error.message),
    });
  const createSalesScript = v2trpc.salesScripts.create.useMutation({
    onSuccess: () => { setScriptsOpen(false); setScriptForm(emptyScript()); refreshScripts(); toast.success("Script criado"); },
    onError: error => toast.error(error.message),
  });
  const updateSalesScript = v2trpc.salesScripts.update.useMutation({
    onSuccess: () => { setScriptsOpen(false); setEditingScript(null); setScriptForm(emptyScript()); refreshScripts(); toast.success("Script atualizado"); },
    onError: error => toast.error(error.message),
  });
  const deleteSalesScript = v2trpc.salesScripts.delete.useMutation({
    onSuccess: () => { setDeleteScript(null); refreshScripts(); toast.success("Script excluído"); },
    onError: error => toast.error(error.message),
  });
  const materializeSuggestedScripts = v2trpc.salesScripts.materializeSuggested.useMutation({
    onSuccess: data => { setConfirmSuggestedLibrary(false); refreshScripts(); toast.success(data.created ? "Biblioteca sugerida adicionada" : "A biblioteca sugerida já foi adicionada"); },
    onError: error => toast.error(error.message),
  });
  const activePdvs = useMemo(
    () => (pdvs.data ?? []).filter(pdv => pdv.isActive),
    [pdvs.data]
  );
  const toggle = (
    id: number,
    selected: number[],
    setter: (ids: number[]) => void
  ) =>
    setter(
      selected.includes(id)
        ? selected.filter(item => item !== id)
        : [...selected, id]
    );
  const insertWhatsappVariable = (placeholder: string) => {
    const input = whatsappTemplateInputRef.current;
    const start = input?.selectionStart ?? whatsappTemplate.length;
    const end = input?.selectionEnd ?? whatsappTemplate.length;
    const next = `${whatsappTemplate.slice(0, start)}${placeholder}${whatsappTemplate.slice(end)}`;
    setWhatsappTemplate(next);
    requestAnimationFrame(() => {
      input?.focus();
      const cursor = start + placeholder.length;
      input?.setSelectionRange(cursor, cursor);
    });
  };
  const whatsappPreview = renderWhatsAppInitialMessage(
    whatsappTemplate || DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
    {
      nome: "Maria da Silva",
      vendedor: "João",
      pdv: "Loja Centro",
      campanha: "Campanha Setembro",
    }
  );
  return (
    <main className="v2-page v2-administration-page space-y-6">
      <V2PageHeader
        eyebrow="Administração"
        title="Administração"
        description="Gerencie usuários, acessos, PDVs e configurações operacionais no contexto autorizado."
      />
      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Novo parceiro</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]"
              onSubmit={event => {
                event.preventDefault();
                createPartner.mutate(partnerForm);
              }}
            >
              <Input
                required
                placeholder="Código"
                value={partnerForm.code}
                onChange={event =>
                  setPartnerForm({ ...partnerForm, code: event.target.value })
                }
              />
              <Input
                required
                placeholder="Nome do parceiro"
                value={partnerForm.name}
                onChange={event =>
                  setPartnerForm({ ...partnerForm, name: event.target.value })
                }
              />
              <Button disabled={createPartner.isPending}>Criar parceiro</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card className="v2-filter-panel v2-administration-context">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">
              Parceiro ativo
            </label>
            <Select value={partnerId} onValueChange={selectPartner}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um parceiro" />
              </SelectTrigger>
              <SelectContent>
                {selectablePartners.data?.map(partner => (
                  <SelectItem
                    key={partner.id}
                    value={String(partner.id)}
                    disabled={!partner.isActive}
                  >
                    {partner.name} · {partner.code}
                    {!partner.isActive ? " (inativo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {selectablePartners.isLoading
              ? "Carregando parceiros…"
              : `${selectablePartners.data?.length ?? 0} parceiro(s) disponíveis`}
          </div>
        </CardContent>
      </Card>
      {!enabled ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {isSuperAdmin
              ? "Crie ou selecione um parceiro para iniciar a operação."
              : "Nenhum parceiro ativo está associado a este usuário."}
          </CardContent>
        </Card>
      ) : !canAdminister ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Seu perfil não administra PDVs e usuários. Use os atalhos acima para
            acessar sua operação de leads e follow-ups.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="v2-tab-list v2-administration-tabs" aria-label="Seções de administração">
            <Button type="button" size="sm" variant="ghost" className={adminSection === "users" ? "is-active" : undefined} aria-pressed={adminSection === "users"} onClick={() => setAdminSection("users")}>Usuários</Button>
            {isSuperAdmin && <Button type="button" size="sm" variant="ghost" className={adminSection === "access" ? "is-active" : undefined} aria-pressed={adminSection === "access"} onClick={() => setAdminSection("access")}>Perfis e acessos</Button>}
            <Button type="button" size="sm" variant="ghost" className={adminSection === "pdvs" ? "is-active" : undefined} aria-pressed={adminSection === "pdvs"} onClick={() => setAdminSection("pdvs")}>PDVs</Button>
            <Button type="button" size="sm" variant="ghost" className={adminSection === "settings" ? "is-active" : undefined} aria-pressed={adminSection === "settings"} onClick={() => setAdminSection("settings")}>Configurações</Button>
          </div>
          {adminSection === "pdvs" && <section className={`grid gap-6 ${createPdvOpen ? "lg:grid-cols-2" : ""}`}>
            {createPdvOpen && <Card>
              <CardHeader>
                <CardTitle>Novo PDV</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-3"
                  onSubmit={event => {
                    event.preventDefault();
                    createPdv.mutate({
                      ...pdvForm,
                      city: pdvForm.city || null,
                      region: pdvForm.region || null,
                    });
                  }}
                >
                  <Input
                    required
                    placeholder="Código"
                    value={pdvForm.code}
                    onChange={event =>
                      setPdvForm({ ...pdvForm, code: event.target.value })
                    }
                  />
                  <Input
                    required
                    placeholder="Nome"
                    value={pdvForm.name}
                    onChange={event =>
                      setPdvForm({ ...pdvForm, name: event.target.value })
                    }
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      placeholder="Cidade"
                      value={pdvForm.city}
                      onChange={event =>
                        setPdvForm({ ...pdvForm, city: event.target.value })
                      }
                    />
                    <Input
                      placeholder="Região"
                      value={pdvForm.region}
                      onChange={event =>
                        setPdvForm({ ...pdvForm, region: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex gap-2"><Button disabled={createPdv.isPending}>Criar PDV</Button><Button type="button" variant="outline" onClick={() => setCreatePdvOpen(false)}>Cancelar</Button></div>
                </form>
              </CardContent>
            </Card>}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3"><CardTitle>PDVs do parceiro</CardTitle><Button size="sm" onClick={() => setCreatePdvOpen(true)}>Novo PDV</Button></div>
              </CardHeader>
              <CardContent className="space-y-2">
                {pdvs.data?.map(pdv => (
                  <div
                    key={pdv.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{pdv.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pdv.code} · {pdv.city ?? "Cidade não informada"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={pdv.isActive ? "secondary" : "outline"}>
                        {pdv.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          togglePdv.mutate({
                            id: pdv.id,
                            isActive: !pdv.isActive,
                          })
                        }
                      >
                        {pdv.isActive ? "Inativar" : "Reativar"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>}
          {adminSection === "settings" && <section className="space-y-4">
            <p className="v2-settings-section-label">Comunicação com Leads</p>
          <Card className="v2-section-card">
            <CardHeader>
              <CardTitle>Mensagem inicial do WhatsApp</CardTitle>
              <p className="text-sm text-muted-foreground">
                Esta mensagem é preparada no atalho do Lead. O vendedor sempre
                revisa e envia a mensagem dentro do WhatsApp.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp-initial-template">
                  Mensagem do parceiro
                </Label>
                <Textarea
                  ref={whatsappTemplateInputRef}
                  id="whatsapp-initial-template"
                  value={whatsappTemplate}
                  disabled={whatsappTemplateQuery.isLoading}
                  maxLength={4000}
                  rows={5}
                  onChange={event => setWhatsappTemplate(event.target.value)}
                  aria-describedby="whatsapp-template-help"
                />
                <p
                  id="whatsapp-template-help"
                  className="text-xs text-muted-foreground"
                >
                  Use somente as variáveis disponíveis. Campos personalizados
                  ainda não participam desta mensagem.
                </p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Inserir variável</p>
                <div className="flex flex-wrap gap-2">
                  {WHATSAPP_TEMPLATE_VARIABLES.map(variable => (
                    <Button
                      key={variable.key}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={whatsappTemplateQuery.isLoading}
                      onClick={() =>
                        insertWhatsappVariable(variable.placeholder)
                      }
                    >
                      {variable.placeholder} · {variable.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">Pré-visualização</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {whatsappPreview ||
                    "A mensagem ficará vazia com este modelo."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Exemplo seguro: Maria, João, Loja Centro e Campanha Setembro.
                </p>
              </div>
              <Button
                type="button"
                disabled={
                  whatsappTemplateQuery.isLoading ||
                  saveWhatsappTemplate.isPending ||
                  !whatsappTemplate.trim()
                }
                onClick={() =>
                  saveWhatsappTemplate.mutate({ template: whatsappTemplate })
                }
              >
                {saveWhatsappTemplate.isPending
                  ? "Salvando…"
                  : "Salvar mensagem inicial"}
              </Button>
            </CardContent>
          </Card>
          <Card className="v2-section-card">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Scripts de venda</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Conteúdos de apoio disponíveis aos vendedores durante o atendimento.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!salesScripts.data?.suggestedLibraryAdded && <Button type="button" variant="outline" size="sm" onClick={() => setConfirmSuggestedLibrary(true)}>Adicionar biblioteca sugerida</Button>}
                  <Button type="button" size="sm" onClick={() => { setEditingScript(null); setScriptForm(emptyScript()); setScriptsOpen(true); }}>+ Novo script</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={scriptCategory} onValueChange={value => setScriptCategory(value as "all" | SalesScriptCategory)}><SelectTrigger aria-label="Filtrar scripts por categoria"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as categorias</SelectItem>{Object.entries(salesScriptCategoryLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
                <Select value={scriptCampaign} onValueChange={setScriptCampaign}><SelectTrigger aria-label="Filtrar scripts por campanha"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as campanhas</SelectItem>{(campaigns.data ?? []).map(campaign => <SelectItem key={campaign.id} value={String(campaign.id)}>{campaign.name}</SelectItem>)}</SelectContent></Select>
              </div>
              {salesScripts.isLoading ? <p className="text-sm text-muted-foreground">Carregando scripts…</p> : salesScripts.data?.scripts.length ? <div className="space-y-2">{salesScripts.data.scripts.map(script => <div key={script.id} className="rounded-md border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{script.title}</p><Badge variant="secondary">{salesScriptCategoryLabel[script.category as SalesScriptCategory]}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{script.content.length > 180 ? `${script.content.slice(0, 180)}…` : script.content}</p><p className="mt-2 text-xs text-muted-foreground">{script.scope === "all_campaigns" ? "Todas as campanhas" : "Campanhas selecionadas"}</p></div><div className="flex gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => { setEditingScript(script); setScriptForm({ category: script.category, title: script.title, content: script.content, scope: script.scope, campaignIds: script.campaigns.map(campaign => campaign.id) }); setScriptsOpen(true); }}>Editar</Button><Button type="button" variant="ghost" size="sm" onClick={() => setDeleteScript(script)}>Excluir</Button></div></div></div>)}</div> : <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground"><p>Nenhum script cadastrado.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setConfirmSuggestedLibrary(true)}>Adicionar biblioteca sugerida</Button><Button type="button" size="sm" onClick={() => { setEditingScript(null); setScriptForm(emptyScript()); setScriptsOpen(true); }}>Novo script</Button></div></div>}
            </CardContent>
          </Card>
          </section>}
          {adminSection === "users" && <>
          {(createUserOpen || editing) && <section className="grid gap-6 lg:grid-cols-2">
            {createUserOpen && <Card>
              <CardHeader>
                <CardTitle>Criar usuário e acesso</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={event => {
                    event.preventDefault();
                    createUser.mutate(userForm);
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="new-user-name">Nome</Label>
                    <Input
                      id="new-user-name"
                      required
                      value={userForm.name}
                      onChange={event =>
                        setUserForm({ ...userForm, name: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-user-email">E-mail</Label>
                    <Input
                      id="new-user-email"
                      required
                      type="email"
                      value={userForm.email}
                      onChange={event =>
                        setUserForm({ ...userForm, email: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-user-password">Senha inicial</Label>
                    <Input
                      id="new-user-password"
                      required
                      type="password"
                      minLength={8}
                      value={userForm.password}
                      onChange={event =>
                        setUserForm({
                          ...userForm,
                          password: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-user-role">Perfil de acesso</Label>
                    <Select
                      value={userForm.role}
                      onValueChange={value =>
                        setUserForm({ ...userForm, role: value as Role })
                      }
                    >
                      <SelectTrigger id="new-user-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(roleLabel).map(([role, label]) => (
                          <SelectItem key={role} value={role}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <PdvChecklist
                    pdvs={activePdvs}
                    selected={userForm.pdvIds}
                    onChange={ids => setUserForm({ ...userForm, pdvIds: ids })}
                    toggle={toggle}
                  />
                  <div className="flex gap-2"><Button disabled={createUser.isPending}>Criar acesso</Button><Button type="button" variant="outline" onClick={() => setCreateUserOpen(false)}>Cancelar</Button></div>
                </form>
              </CardContent>
            </Card>}
            {editing && <Card>
              <CardHeader>
                <CardTitle>Editar usuário</CardTitle>
              </CardHeader>
              <CardContent>
                {editing ? (
                  <form
                    className="space-y-3"
                    onSubmit={event => {
                      event.preventDefault();
                      if (!editing.name.trim()) {
                        toast.error("Nome é obrigatório");
                        return;
                      }
                      updateUser.mutate(
                        {
                          membershipId: editing.membershipId,
                          name: editing.name,
                          email: editing.email,
                        },
                        {
                          onSuccess: () =>
                            updateMembership.mutate({
                              membershipId: editing.membershipId,
                              role: editing.role,
                              isActive: editing.isActive,
                              pdvIds: editing.pdvIds,
                            }),
                        }
                      );
                    }}
                  >
                    <p className="text-sm text-muted-foreground">
                      A alteração vale para os próximos acessos e não modifica o
                      histórico comercial já registrado.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Nome</Label>
                        <Input
                          required
                          value={editing.name}
                          onChange={event =>
                            setEditing({ ...editing, name: event.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>E-mail</Label>
                        <Input
                          required
                          type="email"
                          value={editing.email}
                          onChange={event =>
                            setEditing({
                              ...editing,
                              email: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Acesso ao parceiro
                    </p>
                    <Select
                      value={editing.role}
                      onValueChange={value =>
                        setEditing({ ...editing, role: value as Role })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(roleLabel).map(([role, label]) => (
                          <SelectItem key={role} value={role}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editing.isActive}
                        onCheckedChange={value =>
                          setEditing({ ...editing, isActive: value === true })
                        }
                      />{" "}
                      Acesso ativo neste parceiro
                    </label>
                    <PdvChecklist
                      pdvs={activePdvs}
                      selected={editing.pdvIds}
                      onChange={ids => setEditing({ ...editing, pdvIds: ids })}
                      toggle={toggle}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={
                          updateMembership.isPending || updateUser.isPending
                        }
                      >
                        Salvar usuário
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditing(null)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Selecione “Editar usuário” para mudar os dados do cadastro e
                    o acesso ao parceiro.
                  </p>
                )}
              </CardContent>
            </Card>}
          </section>}
          <Card className="v2-section-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-3"><CardTitle>Usuários do parceiro</CardTitle><Button size="sm" onClick={() => setCreateUserOpen(true)}>Novo usuário</Button></div>
            </CardHeader>
            <CardContent className="space-y-3">
              {users.data?.map(person => (
                <div
                  key={person.membershipId}
                  className="v2-admin-list-item flex flex-col justify-between gap-3 rounded-lg border p-4 md:flex-row md:items-center"
                >
                  <div>
                    <p className="font-medium">{person.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {person.email} · {roleLabel[person.role as Role]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PDVs:{" "}
                      {person.pdvs
                        .filter(pdv => pdv.isActive)
                        .map(pdv => pdv.name)
                        .join(", ") || "Nenhum atribuído"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        person.userIsActive ? "secondary" : "destructive"
                      }
                    >
                      {person.userIsActive
                        ? "Usuário global ativo"
                        : "Usuário global inativo"}
                    </Badge>
                    <Badge
                      variant={
                        person.membershipIsActive ? "secondary" : "outline"
                      }
                    >
                      {person.membershipIsActive
                        ? "Acesso ao parceiro ativo"
                        : "Acesso ao parceiro inativo"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditing({
                          membershipId: person.membershipId,
                          name: person.name,
                          email: person.email,
                          role: person.role as Role,
                          isActive: person.membershipIsActive,
                          pdvIds: person.pdvs
                            .filter(pdv => pdv.isActive)
                            .map(pdv => pdv.id),
                        })
                      }
                    >
                      Editar usuário
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setResetTarget({
                          membershipId: person.membershipId,
                          name: person.name,
                        })
                      }
                    >
                      Redefinir senha
                    </Button>
                    {isSuperAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          globalStatus.mutate({
                            userId: person.userId,
                            isActive: !person.userIsActive,
                          })
                        }
                      >
                        {person.userIsActive
                          ? "Inativar usuário"
                          : "Reativar usuário"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          </>}
          {adminSection === "access" && isSuperAdmin && <ManagementUsersPanel />}
          <Dialog
            open={Boolean(resetTarget)}
            onOpenChange={open => {
              if (!open) {
                setResetTarget(null);
                setTemporaryPassword("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Redefinir senha</DialogTitle>
                <DialogDescription>
                  Defina uma senha temporária para {resetTarget?.name}. A senha
                  atual nunca é exibida e o usuário deverá criar uma nova senha
                  no próximo acesso.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={event => {
                  event.preventDefault();
                  if (resetTarget)
                    resetPassword.mutate({
                      membershipId: resetTarget.membershipId,
                      password: temporaryPassword,
                    });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="temporary-password">Senha temporária</Label>
                  <Input
                    id="temporary-password"
                    type="password"
                    minLength={8}
                    required
                    value={temporaryPassword}
                    onChange={event => setTemporaryPassword(event.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setResetTarget(null)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={resetPassword.isPending}>
                    {resetPassword.isPending
                      ? "Redefinindo…"
                      : "Redefinir senha"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
      <Dialog open={scriptsOpen} onOpenChange={open => { setScriptsOpen(open); if (!open) { setEditingScript(null); setScriptForm(emptyScript()); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editingScript ? "Editar script" : "Novo script"}</DialogTitle><DialogDescription>Scripts são sugestões de apoio e não alteram o atendimento do Lead.</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>Categoria *</Label><Select value={scriptForm.category} onValueChange={value => setScriptForm({ ...scriptForm, category: value as SalesScriptCategory })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(salesScriptCategoryLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor="sales-script-title">Título *</Label><Input id="sales-script-title" maxLength={160} value={scriptForm.title} onChange={event => setScriptForm({ ...scriptForm, title: event.target.value })} /></div></div><div className="space-y-1"><Label htmlFor="sales-script-content">Mensagem *</Label><Textarea id="sales-script-content" rows={7} maxLength={5000} value={scriptForm.content} onChange={event => setScriptForm({ ...scriptForm, content: event.target.value })} /></div><div className="space-y-2"><Label>Disponível em *</Label><div className="flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm"><input type="radio" checked={scriptForm.scope === "all_campaigns"} onChange={() => setScriptForm({ ...scriptForm, scope: "all_campaigns", campaignIds: [] })} /> Todas as campanhas</label><label className="flex items-center gap-2 text-sm"><input type="radio" checked={scriptForm.scope === "specific_campaigns"} onChange={() => setScriptForm({ ...scriptForm, scope: "specific_campaigns" })} /> Campanhas específicas</label></div>{scriptForm.scope === "specific_campaigns" && <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">{(campaigns.data ?? []).map(campaign => <label key={campaign.id} className="flex items-center gap-2 text-sm"><Checkbox checked={scriptForm.campaignIds.includes(campaign.id)} onCheckedChange={() => setScriptForm({ ...scriptForm, campaignIds: scriptForm.campaignIds.includes(campaign.id) ? scriptForm.campaignIds.filter(id => id !== campaign.id) : [...scriptForm.campaignIds, campaign.id] })} /> {campaign.name}</label>)}</div>}</div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setScriptsOpen(false)}>Cancelar</Button><Button type="button" disabled={!scriptForm.title.trim() || !scriptForm.content.trim() || (scriptForm.scope === "specific_campaigns" && !scriptForm.campaignIds.length) || createSalesScript.isPending || updateSalesScript.isPending} onClick={() => editingScript ? updateSalesScript.mutate({ id: editingScript.id, ...scriptForm }) : createSalesScript.mutate(scriptForm)}>{editingScript ? "Salvar alterações" : "Criar script"}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleteScript)} onOpenChange={open => !open && setDeleteScript(null)}><DialogContent><DialogHeader><DialogTitle>Excluir script?</DialogTitle><DialogDescription>Esta ação remove o script da biblioteca do parceiro.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteScript(null)}>Cancelar</Button><Button variant="destructive" disabled={deleteSalesScript.isPending} onClick={() => deleteSalesScript.mutate({ id: deleteScript.id })}>Excluir</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={confirmSuggestedLibrary} onOpenChange={setConfirmSuggestedLibrary}><DialogContent><DialogHeader><DialogTitle>Adicionar biblioteca sugerida?</DialogTitle><DialogDescription>Os scripts serão copiados para este parceiro e poderão ser editados ou excluídos depois. A biblioteca só é adicionada uma vez.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmSuggestedLibrary(false)}>Cancelar</Button><Button disabled={materializeSuggestedScripts.isPending} onClick={() => materializeSuggestedScripts.mutate()}>Adicionar biblioteca</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}

function PdvChecklist({
  pdvs,
  selected,
  onChange,
  toggle,
}: {
  pdvs: Array<{ id: number; name: string }>;
  selected: number[];
  onChange: (ids: number[]) => void;
  toggle: (
    id: number,
    selected: number[],
    setter: (ids: number[]) => void
  ) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-sm font-medium">PDVs atribuídos</p>
      <p className="mb-3 text-xs text-muted-foreground">
        O usuário verá e poderá trabalhar apenas os Leads destes PDVs, conforme
        o perfil selecionado.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {pdvs.map(pdv => (
          <label key={pdv.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(pdv.id)}
              onCheckedChange={() => toggle(pdv.id, selected, onChange)}
            />
            {pdv.name}
          </label>
        ))}
      </div>
      {!pdvs.length && (
        <p className="text-xs text-muted-foreground">
          Cadastre um PDV ativo antes de criar um escopo.
        </p>
      )}
    </div>
  );
}
