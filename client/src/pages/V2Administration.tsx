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
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type Role = "partner_admin" | "manager" | "seller";
const roleLabel: Record<Role, string> = {
  partner_admin: "Administrador do parceiro",
  manager: "Gestor",
  seller: "Vendedor",
};

function V2Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const utils = v2trpc.useUtils();
  const login = v2trpc.auth.login.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: error => toast.error(error.message),
  });
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-5">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Playcell Leads V2</CardTitle>
          <p className="text-sm text-muted-foreground">
            Acesso administrativo da nova plataforma.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              login.mutate({ email, password });
            }}
          >
            <Input
              type="email"
              required
              placeholder="E-mail"
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
            <Input
              type="password"
              minLength={8}
              required
              placeholder="Senha"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
            <Button className="w-full" disabled={login.isPending}>
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export default function V2Administration() {
  const me = v2trpc.auth.me.useQuery(undefined, { retry: false });
  if (me.isLoading)
    return (
      <main className="p-8 text-center text-sm text-muted-foreground">
        Carregando acesso V2…
      </main>
    );
  if (!me.data) return <V2Login />;
  return (
    <V2AdministrationContent
      isSuperAdmin={me.data.systemRole === "super_admin"}
    />
  );
}

function V2AdministrationContent({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const utils = v2trpc.useUtils();
  const logout = v2trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      toast.success("Sessão encerrada");
    },
    onError: error => toast.error(error.message),
  });
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
    role: Role;
    isActive: boolean;
    pdvIds: number[];
  } | null>(null);
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
  const refresh = () => {
    utils.pdvs.list.invalidate();
    utils.users.list.invalidate();
  };
  const selectPartner = (value: string) => {
    try {
      if (value) localStorage.setItem("v2-active-partner", value);
      else localStorage.removeItem("v2-active-partner");
    } catch {
      /* browser storage is optional */
    }
    setPartnerId(value);
    refresh();
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
      const active = selectablePartners.data.filter(partner => partner.isActive);
      if (active.length === 1) selectPartner(String(active[0].id));
    }
  }, [partnerId, selectablePartners.data]);
  const createPartner = v2trpc.partners.create.useMutation({
    onSuccess: id => {
      setPartnerForm({ code: "", name: "" });
      utils.partners.available.invalidate();
      selectPartner(String(id));
      toast.success("Parceiro criado");
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
  const globalStatus = v2trpc.users.setGlobalActive.useMutation({
    onSuccess: refresh,
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
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">
            V2 / Administração
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            PDVs e acessos operacionais
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O usuário global, o acesso ao parceiro e os PDVs atribuídos são
            controlados separadamente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sair
          </Button>
          <Link href="/v2/campaigns">
            <Button variant="outline">Campanhas</Button>
          </Link>
          <Link href="/v2/leads">
            <Button variant="outline">Leads</Button>
          </Link>
          <Link href="/v2/follow-ups">
            <Button variant="outline">Follow-ups</Button>
          </Link>
          <Link href="/v2/governance">
            <Button variant="outline">Governança operacional</Button>
          </Link>
          <Link href="/v2/import-settings">
            <Button variant="outline">Importações</Button>
          </Link>
        </div>
      </header>
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
                  <Input
                    required
                    placeholder="Nome"
                    value={userForm.name}
                    onChange={event =>
                      setUserForm({ ...userForm, name: event.target.value })
                    }
                  />
                  <Input
                    required
                    type="email"
                    placeholder="E-mail"
                    value={userForm.email}
                    onChange={event =>
                      setUserForm({ ...userForm, email: event.target.value })
                    }
                  />
                  <Input
                    required
                    type="password"
                    minLength={8}
                    placeholder="Senha inicial"
                    value={userForm.password}
                    onChange={event =>
                      setUserForm({ ...userForm, password: event.target.value })
                    }
                  />
                  <Select
                    value={userForm.role}
                    onValueChange={value =>
                      setUserForm({ ...userForm, role: value as Role })
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
                <CardTitle>Editar escopo da membership</CardTitle>
              </CardHeader>
              <CardContent>
                {editing ? (
                  <form
                    className="space-y-3"
                    onSubmit={event => {
                      event.preventDefault();
                      updateMembership.mutate(editing);
                    }}
                  >
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
                        disabled={updateMembership.isPending}
                      >
                        Salvar escopo
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
                    Selecione “Editar acesso” em um usuário para mudar perfil,
                    PDVs ou status apenas neste parceiro.
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
                  className="flex flex-col justify-between gap-3 rounded-lg border p-4 md:flex-row md:items-center"
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
                          role: person.role,
                          isActive: person.membershipIsActive,
                          pdvIds: person.pdvs
                            .filter(pdv => pdv.isActive)
                            .map(pdv => pdv.id),
                        })
                      }
                    >
                      Editar acesso
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
