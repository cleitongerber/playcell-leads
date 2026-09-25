import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { InstallAppButton } from "@/components/InstallAppButton";
import { v2trpc } from "@/lib/v2trpc";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  BarChartBig,
  BellRing,
  Building2,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import {
  isV2NavigationActive,
  visibleV2Navigation,
  type V2NavigationItem,
  type V2NavigationRole,
} from "./v2Navigation";

type V2SessionUser = {
  id: number;
  name: string;
  email: string;
  systemRole: "none" | "super_admin";
  isActive: boolean;
};

const V2SessionContext = createContext<V2SessionUser | null>(null);

export function useV2Session() {
  const session = useContext(V2SessionContext);
  if (!session) throw new Error("A sessão V2 não está disponível.");
  return session;
}

const icons: Record<V2NavigationItem["key"], LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: ClipboardList,
  followUps: BellRing,
  campaigns: Target,
  productivity: BarChart3,
  reports: FileText,
  administration: UsersRound,
  governance: ShieldCheck,
  importSettings: SlidersHorizontal,
};

const roleLabel: Record<V2NavigationRole, string> = {
  super_admin: "Super Admin",
  partner_admin: "Administrador do parceiro",
  manager: "Gestor",
  seller: "Vendedor",
};

function V2Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const utils = v2trpc.useUtils();
  const login = v2trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Acesso realizado");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <main className="v2-login-shell">
      <section className="v2-login-card" aria-labelledby="v2-login-title">
        <div className="v2-brand-mark" aria-hidden="true">
          P
        </div>
        <div>
          <p className="v2-eyebrow">Playcell Leads</p>
          <h1 id="v2-login-title" className="v2-login-title">
            Acesse sua operação
          </h1>
          <p className="v2-login-description">
            Entre para acompanhar Leads, campanhas e follow-ups no contexto do
            seu parceiro.
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            login.mutate({ email, password });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="v2-login-email">E-mail</Label>
            <Input
              id="v2-login-email"
              autoComplete="email"
              autoFocus
              required
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="voce@empresa.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v2-login-password">Senha</Label>
            <Input
              id="v2-login-password"
              autoComplete="current-password"
              minLength={8}
              required
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Sua senha"
            />
          </div>
          <Button className="w-full" size="lg" disabled={login.isPending}>
            {login.isPending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
        <InstallAppButton className="pt-1" />
      </section>
    </main>
  );
}

function ShellLoading() {
  return (
    <main className="v2-login-shell">
      <section className="v2-login-card" aria-label="Carregando aplicação">
        <Skeleton className="size-12 rounded-xl" />
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
    </main>
  );
}

function PartnerSelector({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const partners = v2trpc.partners.available.useQuery();
  return (
    <div className={cn("min-w-0", compact ? "w-full" : "w-full sm:w-64")}>
      {!compact && <Label className="sr-only">Parceiro ativo</Label>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label="Parceiro ativo"
          className={cn("w-full", compact && "h-9 bg-background/70")}
        >
          <Building2 className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <SelectValue
            placeholder={partners.isLoading ? "Carregando parceiro…" : "Selecionar parceiro"}
          />
        </SelectTrigger>
        <SelectContent>
          {partners.data
            ?.filter(partner => partner.isActive)
            .map(partner => (
              <SelectItem key={partner.id} value={String(partner.id)}>
                {partner.name} · {partner.code}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NavigationLink({
  item,
  location,
  mobile = false,
  onNavigate,
}: {
  item: V2NavigationItem;
  location: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = icons[item.key];
  const active = isV2NavigationActive(item.path, location);
  return (
    <Link
      href={item.path}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        mobile
          ? "v2-mobile-nav-item"
          : "v2-sidebar-nav-item",
        active && "is-active"
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

function UserMenu({
  user,
  role,
  onLogout,
  compact = false,
}: {
  user: V2SessionUser;
  role: V2NavigationRole | null;
  onLogout: () => void;
  compact?: boolean;
}) {
  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(name => name.charAt(0))
    .join("")
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
            compact && "w-full"
          )}
          aria-label="Abrir menu do perfil"
        >
          <Avatar className="size-8 border">
            <AvatarFallback className="text-xs font-semibold">
              {initials || "PL"}
            </AvatarFallback>
          </Avatar>
          <span className={cn("min-w-0", !compact && "hidden sm:block")}>
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {role ? roleLabel[role] : "Selecione um parceiro"}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:text-destructive"
          onClick={onLogout}
        >
          <LogOut className="mr-2 size-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShellFrame({
  user,
  children,
}: {
  user: V2SessionUser;
  children: ReactNode;
}) {
  const [location, setLocation] = useLocation();
  const [partnerId, setPartnerId] = useState(() => {
    try {
      return localStorage.getItem("v2-active-partner") ?? "";
    } catch {
      return "";
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const initialSelection = useRef(false);
  const utils = v2trpc.useUtils();
  const partners = v2trpc.partners.available.useQuery();
  const access = v2trpc.access.context.useQuery(undefined, {
    enabled: Boolean(partnerId),
    retry: false,
  });
  const logout = v2trpc.auth.logout.useMutation({
    onSuccess: () => {
      try {
        localStorage.removeItem("v2-active-partner");
      } catch {
        // Browser storage is optional.
      }
      utils.auth.me.setData(undefined, null);
      toast.success("Sessão encerrada");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!partners.data || initialSelection.current) return;
    const activePartners = partners.data.filter(partner => partner.isActive);
    const currentIsValid = activePartners.some(
      partner => String(partner.id) === partnerId
    );
    if (currentIsValid) {
      initialSelection.current = true;
      return;
    }
    initialSelection.current = true;
    if (activePartners.length === 1) {
      try {
        localStorage.setItem("v2-active-partner", String(activePartners[0].id));
      } catch {
        // Browser storage is optional.
      }
      window.location.reload();
    }
  }, [partnerId, partners.data]);

  const role = (access.data?.role ??
    (user.systemRole === "super_admin" && partnerId ? "super_admin" : null)) as
    | V2NavigationRole
    | null;
  const navigation = useMemo(() => visibleV2Navigation(role), [role]);
  const mobileNavigation = navigation.filter(item => item.mobilePrimary);
  const moreNavigation = navigation.filter(item => !item.mobilePrimary);
  const activeItem = navigation.find(item =>
    isV2NavigationActive(item.path, location)
  );
  const selectedPartner = partners.data?.find(
    partner => String(partner.id) === partnerId
  );

  const selectPartner = (value: string) => {
    if (!value || value === partnerId) return;
    try {
      localStorage.setItem("v2-active-partner", value);
    } catch {
      // Browser storage is optional.
    }
    setPartnerId(value);
    // The tenant header is resolved per request. A hard reload intentionally
    // drops all cached tenant data before querying the newly selected partner.
    window.location.reload();
  };
  const closeMore = () => setMoreOpen(false);
  const goToAdmin = () => {
    closeMore();
    setLocation("/v2/admin");
  };

  return (
    <div className="v2-app-shell">
      <aside className="v2-desktop-sidebar">
        <div className="v2-sidebar-brand">
          <div className="v2-brand-mark" aria-hidden="true">
            P
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Playcell Leads</p>
            <p className="truncate text-xs text-muted-foreground">V2 operacional</p>
          </div>
        </div>
        <PartnerSelector value={partnerId} onChange={selectPartner} compact />
        <nav aria-label="Navegação principal" className="v2-sidebar-nav">
          {navigation.map(item => (
            <NavigationLink key={item.key} item={item} location={location} />
          ))}
          {!role && (
            <button type="button" className="v2-sidebar-nav-item" onClick={goToAdmin}>
              <UsersRound aria-hidden="true" className="size-5" />
              <span>Selecionar contexto</span>
            </button>
          )}
        </nav>
        <div className="v2-sidebar-footer">
          <InstallAppButton />
          <UserMenu
            user={user}
            role={role}
            compact
            onLogout={() => logout.mutate()}
          />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="v2-topbar">
          <div className="flex min-w-0 items-center gap-2">
            <div className="v2-mobile-brand lg:hidden" aria-hidden="true">
              <PanelLeftOpen className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {activeItem?.label ?? "Playcell Leads"}
              </p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {selectedPartner?.name ?? "Selecione um parceiro"}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden md:block">
              <PartnerSelector value={partnerId} onChange={selectPartner} />
            </div>
            <UserMenu
              user={user}
              role={role}
              onLogout={() => logout.mutate()}
            />
          </div>
        </header>
        <div className="v2-mobile-partner md:hidden">
          <PartnerSelector value={partnerId} onChange={selectPartner} compact />
        </div>
        {!partnerId && (
          <div className="v2-context-notice" role="status">
            <ChevronRight className="size-4" aria-hidden="true" />
            Selecione um parceiro para abrir os dados operacionais autorizados.
          </div>
        )}
        <div className="v2-shell-content">{children}</div>
      </div>

      <nav aria-label="Navegação móvel" className="v2-mobile-bottom-nav">
        {mobileNavigation.map(item => (
          <NavigationLink
            key={item.key}
            item={item}
            location={location}
            mobile
          />
        ))}
        <button
          type="button"
          className={cn("v2-mobile-nav-item", moreOpen && "is-active")}
          onClick={() => setMoreOpen(true)}
          aria-label="Abrir mais opções"
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
          <span>Mais</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="v2-mobile-more-sheet">
          <SheetHeader>
            <SheetTitle>Mais opções</SheetTitle>
            <SheetDescription>
              Gestão, relatórios e configurações disponíveis no seu perfil.
            </SheetDescription>
          </SheetHeader>
          <nav className="space-y-1 px-4 pb-4" aria-label="Mais opções">
            {moreNavigation.map(item => (
              <NavigationLink
                key={item.key}
                item={item}
                location={location}
                onNavigate={closeMore}
              />
            ))}
            {!role && (
              <button
                type="button"
                className="v2-sidebar-nav-item w-full"
                onClick={goToAdmin}
              >
                <Menu aria-hidden="true" className="size-5" />
                <span>Selecionar contexto</span>
              </button>
            )}
            <div className="pt-3">
              <InstallAppButton />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function V2AppShell({ children }: { children: ReactNode }) {
  const me = v2trpc.auth.me.useQuery(undefined, { retry: false });
  if (me.isLoading) return <ShellLoading />;
  if (!me.data) return <V2Login />;
  return (
    <V2SessionContext.Provider value={me.data as V2SessionUser}>
      <ShellFrame user={me.data as V2SessionUser}>{children}</ShellFrame>
    </V2SessionContext.Provider>
  );
}
