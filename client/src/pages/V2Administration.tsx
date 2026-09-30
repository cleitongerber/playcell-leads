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

type Role = "partner_admin" | "manager" | "seller";
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
  const refresh = () => {
    utils.pdvs.list.invalidate();
    utils.users.list.invalidate();
  };
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
    <main className="v2-page space-y-6">
      <V2PageHeader
        eyebrow="Administração"
        title="PDVs e acessos operacionais"
        description="O usuário global, o acesso ao parceiro e os PDVs atribuídos são controlados separadamente."
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
      <Card>
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
          <section className="grid gap-6 lg:grid-cols-2">
            <Card>
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
                  <Button disabled={createPdv.isPending}>Criar PDV</Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>PDVs do parceiro</CardTitle>
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
          </section>
          <Card>
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
          <section className="grid gap-6 lg:grid-cols-2">
            <Card>
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
                  <Button disabled={createUser.isPending}>Criar acesso</Button>
                </form>
              </CardContent>
            </Card>
            <Card>
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
            </Card>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Usuários do parceiro</CardTitle>
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
                      {person.email} · {roleLabel[person.role]}
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
                          role: person.role,
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
