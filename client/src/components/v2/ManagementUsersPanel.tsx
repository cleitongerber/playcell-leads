import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, SectionCard } from "@/components/v2/V2Layout";
import { v2trpc } from "@/lib/v2trpc";
import { KeyRound, Pencil, Plus, UsersRound } from "lucide-react";
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [candidatePartnerId, setCandidatePartnerId] = useState("");
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const active = editing ?? form;
  const candidateId = Number(candidatePartnerId) || 0;
  const partnerPdvs = v2trpc.managementUsers.partnerPdvs.useQuery({ partnerId: candidateId }, { enabled: candidateId > 0 });
  const currentScope = active.scopes.find((scope) => scope.partnerId === candidateId);
  const selectablePartners = useMemo(
    () => (partners.data ?? []).filter((partner) => partner.isActive && !active.scopes.some((scope) => scope.partnerId === partner.id)),
    [active.scopes, partners.data],
  );

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setCandidatePartnerId("");
  };
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setCandidatePartnerId("");
    setEditorOpen(true);
  };
  const updateScopes = (scopes: Scope[]) => editing ? setEditing({ ...editing, scopes }) : setForm({ ...form, scopes });
  const addScope = () => {
    if (!candidateId || currentScope) return;
    updateScopes([...active.scopes, { partnerId: candidateId, isActive: true, pdvScopeMode: "all", pdvIds: [] }]);
  };
  const updateScope = (partnerId: number, patch: Partial<Scope>) =>
    updateScopes(active.scopes.map((scope) => scope.partnerId === partnerId ? { ...scope, ...patch } : scope));
  const openEdit = (user: any) => {
    setEditing({
      userId: user.userId,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      scopes: user.scopes.map((scope: any) => ({
        partnerId: scope.partnerId,
        isActive: scope.isActive,
        pdvScopeMode: scope.pdvScopeMode,
        pdvIds: scope.pdvIds,
      })),
    });
    setCandidatePartnerId("");
    setEditorOpen(true);
  };

  const create = v2trpc.managementUsers.create.useMutation({
    onSuccess: () => {
      utils.managementUsers.list.invalidate();
      closeEditor();
      toast.success("Usuário Gestão criado com senha temporária.");
    },
    onError: (error) => toast.error(error.message),
  });
  const update = v2trpc.managementUsers.update.useMutation({
    onSuccess: () => {
      utils.managementUsers.list.invalidate();
      closeEditor();
      toast.success("Acesso Gestão atualizado.");
    },
    onError: (error) => toast.error(error.message),
  });
  const resetPassword = v2trpc.managementUsers.resetPassword.useMutation({
    onSuccess: () => {
      setResetUserId(null);
      setTemporaryPassword("");
      toast.success("Senha temporária redefinida; a troca será exigida no próximo acesso.");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <SectionCard className="v2-management-access">
      <CardHeader className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <UsersRound className="size-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.12em]">Gestão de acessos</span>
          </div>
          <CardTitle>Usuários Gestão</CardTitle>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Acesso analítico, multi-parceiro e estritamente de consulta. Somente Super Admin administra este perfil.
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="shrink-0"><Plus className="size-4" aria-hidden="true" />Novo acesso Gestão</Button>
      </CardHeader>
      <CardContent className="pt-5">
        <DataTable className="hidden md:block">
          <table>
            <thead><tr><th>Usuário</th><th>Perfil</th><th>Escopo autorizado</th><th>Situação</th><th className="text-right">Ações</th></tr></thead>
            <tbody>
              {users.data?.map((user) => (
                <tr key={user.userId}>
                  <td><strong className="block font-medium text-foreground">{user.name}</strong><span className="text-xs text-muted-foreground">{user.email}</span></td>
                  <td>Gestão</td>
                  <td className="max-w-md">{user.scopes.map((scope: any) => <span key={scope.partnerId} className="block text-sm text-muted-foreground">{scope.partnerName} · {scope.pdvScopeMode === "all" ? "todos os PDVs" : `${scope.pdvIds.length} PDV(s)`}</span>)}</td>
                  <td><Badge variant={user.isActive ? "secondary" : "outline"}>{user.isActive ? "Ativo" : "Inativo"}</Badge></td>
                  <td><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => openEdit(user)}><Pencil className="size-3.5" aria-hidden="true" />Editar</Button><Button type="button" size="sm" variant="ghost" onClick={() => setResetUserId(user.userId)}><KeyRound className="size-3.5" aria-hidden="true" />Senha</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>

        <div className="space-y-3 md:hidden">
          {users.data?.map((user) => (
            <article key={user.userId} className="rounded-xl border border-border/80 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{user.name}</p><p className="text-sm text-muted-foreground">{user.email}</p></div><Badge variant={user.isActive ? "secondary" : "outline"}>{user.isActive ? "Ativo" : "Inativo"}</Badge></div>
              <p className="mt-3 text-sm text-muted-foreground">{user.scopes.map((scope: any) => `${scope.partnerName} · ${scope.pdvScopeMode === "all" ? "todos os PDVs" : `${scope.pdvIds.length} PDV(s)`}`).join(" | ")}</p>
              <div className="mt-4 flex gap-2"><Button type="button" variant="outline" className="flex-1" onClick={() => openEdit(user)}>Editar acesso</Button><Button type="button" variant="ghost" aria-label={`Redefinir senha de ${user.name}`} onClick={() => setResetUserId(user.userId)}><KeyRound className="size-4" aria-hidden="true" /></Button></div>
            </article>
          ))}
        </div>
        {!users.data?.length ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum usuário Gestão cadastrado.</p> : null}
      </CardContent>

      <Dialog open={editorOpen} onOpenChange={(open) => open ? setEditorOpen(true) : closeEditor()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Editar acesso Gestão" : "Novo acesso Gestão"}</DialogTitle><DialogDescription>Defina o usuário e os parceiros ou PDVs autorizados sem alterar as regras de escopo existentes.</DialogDescription></DialogHeader>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (editing) update.mutate(editing); else create.mutate(form); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="management-user-name">Nome</Label><Input id="management-user-name" required value={active.name} onChange={(event) => editing ? setEditing({ ...editing, name: event.target.value }) : setForm({ ...form, name: event.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="management-user-email">E-mail</Label><Input id="management-user-email" required type="email" value={active.email} onChange={(event) => editing ? setEditing({ ...editing, email: event.target.value }) : setForm({ ...form, email: event.target.value })} /></div>
            </div>
            {!editing ? <div className="space-y-2"><Label htmlFor="management-user-password">Senha temporária</Label><Input id="management-user-password" required type="password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></div> : null}
            {editing ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={editing.isActive} onCheckedChange={(value) => setEditing({ ...editing, isActive: value === true })} /> Usuário global ativo</label> : null}

            <section className="space-y-3 border-t pt-5">
              <div><Label>Parceiros autorizados</Label><p className="mt-1 text-sm text-muted-foreground">Conceda o escopo somente aos parceiros que este perfil pode consultar.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row"><Select value={candidatePartnerId} onValueChange={setCandidatePartnerId}><SelectTrigger><SelectValue placeholder="Selecione o parceiro" /></SelectTrigger><SelectContent>{selectablePartners.map((partner) => <SelectItem key={partner.id} value={String(partner.id)}>{partner.name} · {partner.code}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={addScope} disabled={!candidateId || Boolean(currentScope)}>Conceder parceiro</Button></div>
              {active.scopes.map((scope) => {
                const partner = partners.data?.find((item) => item.id === scope.partnerId);
                const pdvRows = scope.partnerId === candidateId ? partnerPdvs.data ?? [] : [];
                return <section key={scope.partnerId} className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{partner?.name ?? `Parceiro #${scope.partnerId}`}</p><Button type="button" size="sm" variant="ghost" onClick={() => updateScopes(active.scopes.filter((item) => item.partnerId !== scope.partnerId))}>Remover</Button></div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" checked={scope.pdvScopeMode === "all"} onChange={() => updateScope(scope.partnerId, { pdvScopeMode: "all", pdvIds: [] })} /> Todos os PDVs</label><label className="flex items-center gap-2"><input type="radio" checked={scope.pdvScopeMode === "specific"} onChange={() => { setCandidatePartnerId(String(scope.partnerId)); updateScope(scope.partnerId, { pdvScopeMode: "specific" }); }} /> PDVs específicos</label></div>{scope.pdvScopeMode === "specific" ? <div className="grid gap-2 sm:grid-cols-2">{scope.partnerId !== candidateId ? <Button type="button" size="sm" variant="outline" onClick={() => setCandidatePartnerId(String(scope.partnerId))}>Carregar PDVs</Button> : null}{pdvRows.map((pdv) => <label key={pdv.id} className="flex items-center gap-2 text-sm"><Checkbox checked={scope.pdvIds.includes(pdv.id)} onCheckedChange={(value) => updateScope(scope.partnerId, { pdvIds: value === true ? [...scope.pdvIds, pdv.id] : scope.pdvIds.filter((id) => id !== pdv.id) })} />{pdv.name}</label>)}</div> : null}</section>;
              })}
            </section>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={closeEditor}>Cancelar</Button><Button type="submit" disabled={create.isPending || update.isPending || !active.scopes.length}>{editing ? "Salvar acesso" : "Criar acesso"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetUserId !== null} onOpenChange={(open) => !open && setResetUserId(null)}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Redefinir senha temporária</DialogTitle><DialogDescription>A pessoa deverá trocar a senha no próximo acesso.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (resetUserId) resetPassword.mutate({ userId: resetUserId, password: temporaryPassword }); }}><div className="space-y-2"><Label htmlFor="management-reset-password">Nova senha temporária</Label><Input id="management-reset-password" required type="password" minLength={8} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setResetUserId(null)}>Cancelar</Button><Button type="submit" disabled={resetPassword.isPending}>Redefinir senha</Button></div></form></DialogContent>
      </Dialog>
    </SectionCard>
  );
}
