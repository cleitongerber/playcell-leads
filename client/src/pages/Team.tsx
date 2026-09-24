import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  KeyRound,
  RotateCcw,
  Save,
  Trash2,
  UserCog,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

type TeamPerson = {
  id: number;
  name: string | null;
  email: string | null;
  role: "admin" | "supervisor" | "user";
  isActive: boolean;
  store: string | null;
  displayName: string | null;
  pdvs: Array<{ id: number; name: string }>;
};
type NewUser = {
  name: string;
  email: string;
  password: string;
  role: "admin" | "supervisor" | "user";
  pdvIds: number[];
};
const emptyUser: NewUser = {
  name: "",
  email: "",
  password: "",
  role: "user",
  pdvIds: [],
};

export default function Team() {
  const team = trpc.team.list.useQuery();
  const resetRequests = trpc.users.resetRequests.useQuery();
  const pdvs = trpc.pdvs.list.useQuery({ includeInactive: true });
  const utils = trpc.useUtils();
  const [openCreate, setOpenCreate] = useState(false);
  const [newUser, setNewUser] = useState<NewUser>(emptyUser);
  const [drafts, setDrafts] = useState<
    Record<number, { store: string; displayName: string }>
  >({});
  const [resetTarget, setResetTarget] = useState<TeamPerson | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<TeamPerson | null>(
    null
  );
  const invalidate = () => {
    utils.team.list.invalidate();
    utils.users.resetRequests.invalidate();
  };
  const assign = trpc.team.assign.useMutation({
    onSuccess: () => {
      toast.success("Vínculo atualizado");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const create = trpc.users.create.useMutation({
    onSuccess: () => {
      toast.success("Usuário criado com sucesso");
      setOpenCreate(false);
      setNewUser(emptyUser);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const reset = trpc.users.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("Senha redefinida com sucesso");
      setResetTarget(null);
      setNewPassword("");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const deactivate = trpc.users.deactivate.useMutation({
    onSuccess: () => {
      toast.success("Usuário inativado e acesso bloqueado");
      setDeactivateTarget(null);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const reactivate = trpc.users.updateAccess.useMutation({
    onSuccess: () => {
      toast.success("Usuário reativado com sucesso");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const activePdvs = (pdvs.data ?? []).filter(pdv => pdv.isActive);
  const togglePdv = (pdvId: number, checked: boolean) =>
    setNewUser(current => ({
      ...current,
      pdvIds: checked
        ? [...current.pdvIds, pdvId]
        : current.pdvIds.filter(id => id !== pdvId),
    }));
  const updateDraft = (
    person: TeamPerson,
    field: "store" | "displayName",
    value: string
  ) =>
    setDrafts(current => ({
      ...current,
      [person.id]: {
        ...(current[person.id] ?? {
          store: person.store ?? "",
          displayName: person.displayName ?? person.name ?? "",
        }),
        [field]: value,
      },
    }));
  const saveProfile = (person: TeamPerson) =>
    assign.mutate({
      userId: person.id,
      ...(drafts[person.id] ?? {
        store: person.store ?? "",
        displayName: person.displayName ?? person.name ?? "",
      }),
    });
  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(newUser);
  };
  const submitReset = (event: FormEvent) => {
    event.preventDefault();
    if (resetTarget)
      reset.mutate({ userId: resetTarget.id, password: newPassword });
  };
  const reactivateUser = (person: TeamPerson) =>
    reactivate.mutate({
      userId: person.id,
      role: person.role,
      isActive: true,
      pdvIds: person.pdvs.map(pdv => pdv.id),
    });
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1050px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#6da768]">
              Administração
            </div>
            <h1 className="text-3xl font-semibold tracking-[-.04em] text-[#102b35]">
              Usuários
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Crie, gerencie acessos e mantenha os PDVs autorizados.
            </p>
          </div>
          <Button
            onClick={() => setOpenCreate(true)}
            className="h-10 rounded-xl bg-[#102b35] hover:bg-[#173b47]"
          >
            <UserPlus className="mr-2 h-4 w-4" /> Incluir usuário
          </Button>
        </div>
        {(resetRequests.data?.length ?? 0) > 0 && (
          <Card className="border-[#e8d39f] bg-[#fff9ea]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-[#80672d]">
                <KeyRound className="h-5 w-5" /> Solicitações de senha (
                {resetRequests.data?.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {resetRequests.data?.map(request => (
                <div
                  key={request.id}
                  className="flex flex-col justify-between gap-2 rounded-xl bg-white/75 p-3 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="font-medium text-[#473d31]">
                      {request.userName || request.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {request.email} ·{" "}
                      {request.requestedAt.toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      const person = team.data?.find(
                        item => item.id === request.userId
                      );
                      if (person) setResetTarget(person as TeamPerson);
                    }}
                  >
                    Redefinir senha
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <Card className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]">
          <CardHeader className="border-b border-[#e8eeed]">
            <CardTitle className="flex items-center gap-2 text-lg">
              <UsersRound className="h-5 w-5 text-[#6da768]" /> Usuários
              cadastrados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {team.isLoading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Carregando usuários...
              </p>
            ) : team.data?.length === 0 ? (
              <p className="rounded-2xl bg-[#f5faf5] p-8 text-center text-sm text-muted-foreground">
                Use <strong>Incluir usuário</strong> para criar o primeiro
                acesso.
              </p>
            ) : (
              <div className="space-y-3">
                {team.data?.map((person: TeamPerson) => {
                  const draft = drafts[person.id] ?? {
                    store: person.store ?? "",
                    displayName: person.displayName ?? person.name ?? "",
                  };
                  return (
                    <div
                      key={person.id}
                      className="grid gap-4 rounded-2xl border border-[#e5eee7] bg-[#fbfdfb] p-4 lg:grid-cols-[1.1fr_1fr_1fr_auto]"
                    >
                      <div>
                        <p className="font-semibold text-[#1d3d45]">
                          {person.name || "Usuário"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {person.email}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Badge variant="outline" className="rounded-full">
                            {person.role === "admin"
                              ? "Administrador"
                              : person.role === "supervisor"
                                ? "Supervisor"
                                : "Vendedor"}
                          </Badge>
                          <Badge
                            variant={
                              person.isActive ? "secondary" : "destructive"
                            }
                            className="rounded-full"
                          >
                        {person.isActive ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                      </div>
                      <Input
                        disabled={!person.isActive}
                        value={draft.displayName}
                        aria-label="Nome na carteira"
                        onChange={event =>
                          updateDraft(person, "displayName", event.target.value)
                        }
                      />
                      <Select
                        disabled={!person.isActive}
                        value={draft.store || "unassigned"}
                        onValueChange={value =>
                          updateDraft(
                            person,
                            "store",
                            value === "unassigned" ? "" : value
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="PDV" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Sem PDV</SelectItem>
                          {activePdvs.map(pdv => (
                            <SelectItem key={pdv.id} value={pdv.name}>
                              {pdv.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={
                            !person.isActive ||
                            !draft.store ||
                            !draft.displayName ||
                            assign.isPending
                          }
                          onClick={() => saveProfile(person)}
                        >
                          <Save className="mr-1 h-3.5 w-3.5" /> Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!person.isActive}
                          onClick={() => setResetTarget(person)}
                        >
                          <KeyRound className="mr-1 h-3.5 w-3.5" /> Senha
                        </Button>
                      {person.isActive ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeactivateTarget(person)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Inativar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reactivate.isPending}
                          onClick={() => reactivateUser(person)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reativar
                        </Button>
                      )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-[#6da768]" /> Incluir usuário
              </DialogTitle>
              <DialogDescription>
                A senha é guardada com segurança e nunca em texto puro.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitCreate} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium">Nome completo</label>
                  <Input
                    required
                    value={newUser.name}
                    onChange={event =>
                      setNewUser({ ...newUser, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">E-mail</label>
                  <Input
                    required
                    type="email"
                    value={newUser.email}
                    onChange={event =>
                      setNewUser({ ...newUser, email: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Senha inicial</label>
                  <Input
                    required
                    type="password"
                    minLength={8}
                    value={newUser.password}
                    onChange={event =>
                      setNewUser({ ...newUser, password: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium">Perfil</label>
                  <Select
                    value={newUser.role}
                    onValueChange={(role: NewUser["role"]) =>
                      setNewUser({ ...newUser, role })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Vendedor</SelectItem>
                      <SelectItem value="supervisor">Supervisor</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  PDVs autorizados{" "}
                  {newUser.role === "user" && (
                    <span className="text-destructive">*</span>
                  )}
                </label>
                <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2">
                  {activePdvs.map(pdv => (
                    <label
                      key={pdv.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={newUser.pdvIds.includes(pdv.id)}
                        onCheckedChange={checked =>
                          togglePdv(pdv.id, checked === true)
                        }
                      />
                      {pdv.name}
                    </label>
                  ))}
                  {!activePdvs.length && (
                    <p className="text-sm text-muted-foreground">
                      Cadastre um PDV antes de criar vendedores.
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpenCreate(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    create.isPending ||
                    (newUser.role === "user" && !newUser.pdvIds.length)
                  }
                >
                  {create.isPending ? "Criando..." : "Criar usuário"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!resetTarget}
          onOpenChange={open => !open && setResetTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Redefinir senha</DialogTitle>
              <DialogDescription>
                Defina uma nova senha para {resetTarget?.name ?? "este usuário"}
                .
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitReset} className="space-y-4">
              <Input
                autoFocus
                required
                type="password"
                minLength={8}
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                placeholder="Nova senha (mínimo 8 caracteres)"
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setResetTarget(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={reset.isPending}>
                  {reset.isPending ? "Salvando..." : "Redefinir senha"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!deactivateTarget}
          onOpenChange={open => !open && setDeactivateTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Inativar usuário?</DialogTitle>
              <DialogDescription>
                {deactivateTarget?.name} perderá o acesso imediatamente. O
                histórico de leads e auditoria será preservado.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeactivateTarget(null)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={deactivate.isPending}
                onClick={() =>
                  deactivateTarget &&
                  deactivate.mutate({ userId: deactivateTarget.id })
                }
              >
                {deactivate.isPending ? "Inativando..." : "Inativar usuário"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
