import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildV2Path, currentV2Path } from "@/lib/operationalNavigation";
import { v2trpc } from "@/lib/v2trpc";
import { Bell } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

const labels = { PRE30: "Follow-up em 30 min", DUE: "Follow-up no horário", LATE60: "Follow-up atrasado há 1 hora", OVERDUE: "Follow-up vencido" } as const;

/** In-app only: visible while FLUXO is open; never asks browser notification permission. */
export function V2FollowUpAlertBell({ enabled }: { enabled: boolean }) {
  const utils = v2trpc.useUtils();
  const summaryShown = useRef(false);
  const alerts = v2trpc.followUps.alerts.useQuery(undefined, {
    enabled,
    refetchInterval: () => typeof document !== "undefined" && document.visibilityState === "visible" ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void utils.followUps.alerts.invalidate();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled, utils.followUps.alerts]);
  useEffect(() => {
    if (!enabled) summaryShown.current = false;
  }, [enabled]);
  useEffect(() => {
    if (!enabled || summaryShown.current || !alerts.data) return;
    summaryShown.current = true;
    if (alerts.data.overdue > 0) {
      toast.warning(`${alerts.data.overdue} follow-up(s) vencido(s) aguardam atendimento.`, {
        id: "v2-follow-up-session-summary",
      });
    }
  }, [alerts.data, enabled]);
  const items = useMemo(() => {
    const unique = new Set<string>();
    return (alerts.data?.items ?? []).filter((item) => {
      const key = `${item.id}:${item.stage}`;
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    });
  }, [alerts.data?.items]);
  if (!enabled) return null;
  const overdue = alerts.data?.overdue ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="relative" aria-label={`Alertas internos de follow-up${overdue ? `: ${overdue} vencidos` : ""}`} title="Alertas internos — funcionam com o FLUXO aberto">
          <Bell className="size-4" aria-hidden="true" />
          {overdue > 0 && <Badge className="absolute -right-1 -top-1 min-w-5 justify-center px-1 text-[10px]" variant="destructive">{overdue > 99 ? "99+" : overdue}</Badge>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Alertas de follow-up</DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs text-muted-foreground">Avisos internos enquanto o FLUXO estiver aberto.</p>
        <DropdownMenuSeparator />
        {items.slice(0, 6).map(item => (
          <DropdownMenuItem key={`${item.id}:${item.stage}`} asChild>
            <Link href={buildV2Path(`/v2/leads/${item.leadId}`, { from: currentV2Path() })}>
              <span className="flex w-full flex-col gap-0.5"><strong>{labels[item.stage]}</strong><span className="text-xs text-muted-foreground">{item.leadName || "Lead"} · {new Date(item.dueAt).toLocaleString("pt-BR")}</span></span>
            </Link>
          </DropdownMenuItem>
        ))}
        {!items.length && <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum aviso no momento.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/v2/follow-ups?view=overdue">Abrir follow-ups vencidos</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
