import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { v2trpc } from "@/lib/v2trpc";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Scope = { partnerId: number; isActive: boolean; pdvScopeMode: "all" | "specific"; pdvIds: number[] };
type Editing = { userId: number; name: string; email: string; isActive: boolean; scopes: Scope[] };

const emptyForm = { name: "", email: "", password: "", scopes: [] as Scope[] };

export function ManagementUsersPanel() {
  const utils = v2trpc.useUtils();
  const partners = v2trpc.partners.available.useQuery();
  const users = v2trpc.managementUsers.list.useQuery();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [candidatePartnerId, setCandidatePartnerId] = useState("");
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const active = editing ?? form;
  const candidateId = Number(candidatePartnerId) || 0;
  const partnerPdvs = v2trpc.managementUsers.partnerPdvs.useQuery(
    { partnerId: candidateId },
    { enabled: candidateId > 0 }
  );
  const currentScope = active.scopes.find(scope => scope.partnerId === candidateId);
  const selectablePartners = useMemo(
    () => (partners.data ?? []).filter(partner => partner.isActive && !active.scopes.some(scope => scope.partnerId === partner.id)),
    [active.scopes, partners.data]
  );
  const updateScopes = (scopes: Scope[]) => {
    if (editing) setEditing({ ...editing, scopes });
    else setForm({ ...form, scopes });
  };
  const addScope = () => {
    if (!candidateId || currentScope) return;
    updateScopes([...active.scopes, { partnerId: candidateId, isActive: true, pdvScopeMode: "all", pdvIds: [] }]);
  };
  const updateScope = (partnerId: number, update: Partial<Scope>) =>
    updateScopes(active.scopes.map(scope => scope.partnerId === partnerId ? { ...scope, ...update } : scope));
  const create = v2trpc.managementUsers.create.useMutation({
    onSuccess: () => { setForm(emptyForm); utils.managementUsers.list.invalidate(); toast.success("Usuário Gestão criado com senha temporária."); },
    onError: error => toast.error(error.message),
  });
  const update = v2trpc.managementUsers.update.useMutation({
    onSuccess: () => { setEditing(null); utils.managementUsers.list.invalidate(); toast.success("Acesso Gestão atualizado."); },
    onError: error => toast.error(error.message),
  });
  const resetPassword = v2trpc.managementUsers.resetPassword.useMutation({
    onSuccess: () => { setResetUserId(null); setTemporaryPassword(""); toast.success("Senha temporária redefinida; a troca será exigida no próximo acesso."); },
    onError: error => toast.error(error.message),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Usuários Gestão</CardTitle><p className="text-sm text-muted-foreground">Acesso analítico, multi-parceiro e estritamente de consulta. Somente Super Admin administra este perfil.</p></CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-3 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); if (editing) update.mutate(editing); else create.mutate(form); }}>
          <div className="flex items-center justify-between gap-3"><p className="font-medium">{editing ? "Editar usuário Gestão" : "Novo usuário Gestão"}</p>{editing && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar edição</Button>}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Nome</Label><Input required value={active.name} onChange={event => editing ? setEditing({ ...editing, name: event.target.value }) : setForm({ ...form, name: event.target.value })} /></div>
            <div><Label>E-mail</Label><Input required type="email" value={active.email} onChange={event => editing ? setEditing({ ...editing, email: event.target.value }) : setForm({ ...form, email: event.target.value })} /></div>
          </div>
          {!editing && <div><Label>Senha temporária</Label><Input required type="password" minLength={8} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></div>}
          {editing && <label className="flex items-center gap-2 text-sm"><Checkbox checked={editing.isActive} onCheckedChange={value => setEditing({ ...editing, isActive: value === true })} /> Usuário global ativo</label>}
          <div className="space-y-2 border-t pt-3"><Label>Adicionar parceiro autorizado</Label><div className="flex flex-col gap-2 sm:flex-row"><Select value={candidatePartnerId} onValueChange={setCandidatePartnerId}><SelectTrigger><SelectValue placeholder="Selecione o parceiro" /></SelectTrigger><SelectContent>{selectablePartners.map(partner => <SelectItem key={partner.id} value={String(partner.id)}>{partner.name} · {partner.code}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={addScope} disabled={!candidateId || Boolean(currentScope)}>Conceder parceiro</Button></div></div>
          {active.scopes.map(scope => {
            const partner = partners.data?.find(item => item.id === scope.partnerId);
            const pdvRows = scope.partnerId === candidateId ? partnerPdvs.data ?? [] : [];
            return <section key={scope.partnerId} className="space-y-3 rounded-lg border bg-muted/20 p-3"><div className="flex items-center justify-between"><p className="font-medium">{partner?.name ?? `Parceiro #${scope.partnerId}`}</p><Button type="button" size="sm" variant="ghost" onClick={() => updateScopes(active.scopes.filter(item => item.partnerId !== scope.partnerId))}>Remover acesso</Button></div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" checked={scope.pdvScopeMode === "all"} onChange={() => updateScope(scope.partnerId, { pdvScopeMode: "all", pdvIds: [] })} /> Todos os PDVs</label><label className="flex items-center gap-2"><input type="radio" checked={scope.pdvScopeMode === "specific"} onChange={() => { setCandidatePartnerId(String(scope.partnerId)); updateScope(scope.partnerId, { pdvScopeMode: "specific" }); }} /> PDVs específicos</label></div>{scope.pdvScopeMode === "specific" && <div className="grid gap-2 sm:grid-cols-2">{scope.partnerId !== candidateId && <Button type="button" size="sm" variant="outline" onClick={() => setCandidatePartnerId(String(scope.partnerId))}>Carregar PDVs</Button>}{pdvRows.map(pdv => <label key={pdv.id} className="flex items-center gap-2 text-sm"><Checkbox checked={scope.pdvIds.includes(pdv.id)} onCheckedChange={value => updateScope(scope.partnerId, { pdvIds: value === true ? [...scope.pdvIds, pdv.id] : scope.pdvIds.filter(id => id !== pdv.id) })} />{pdv.name}</label>)}</div>}</section>;
          })}
          <Button type="submit" disabled={create.isPending || update.isPending || !active.scopes.length}>{editing ? "Salvar usuário Gestão" : "Criar usuário Gestão"}</Button>
        </form>
        <div className="space-y-2">{users.data?.map(user => <div key={user.userId} className="rounded-lg border p-3"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><p className="font-medium">{user.name}</p><p className="text-sm text-muted-foreground">{user.email}</p><p className="text-xs text-muted-foreground">{user.scopes.map((scope: any) => `${scope.partnerName} · ${scope.pdvScopeMode === "all" ? "todos os PDVs" : `${scope.pdvIds.length} PDV(s)`}`).join(" | ")}</p></div><div className="flex items-center gap-2"><Badge variant={user.isActive ? "secondary" : "outline"}>{user.isActive ? "Ativo" : "Inativo"}</Badge><Button size="sm" variant="outline" onClick={() => setEditing({ userId: user.userId, name: user.name, email: user.email, isActive: user.isActive, scopes: user.scopes.map((scope: any) => ({ partnerId: scope.partnerId, isActive: scope.isActive, pdvScopeMode: scope.pdvScopeMode, pdvIds: scope.pdvIds })) })}>Editar</Button><Button size="sm" variant="outline" onClick={() => setResetUserId(resetUserId === user.userId ? null : user.userId)}>Redefinir senha</Button></div></div>{resetUserId === user.userId && <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); resetPassword.mutate({ userId: user.userId, password: temporaryPassword }); }}><Input required type="password" minLength={8} value={temporaryPassword} onChange={event => setTemporaryPassword(event.target.value)} placeholder="Nova senha temporária" /><Button type="submit" disabled={resetPassword.isPending}>Confirmar senha temporária</Button></form>}</div>) ?? <p className="text-sm text-muted-foreground">Nenhum usuário Gestão cadastrado.</p>}</div>
      </CardContent>
    </Card>
  );
}
