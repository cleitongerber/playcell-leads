import { Button } from "@/components/ui/button";
import { v2trpc } from "@/lib/v2trpc";
import { BellOff, BellRing, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type BrowserState = "loading" | "unsupported" | "blocked" | "ready";

function browserSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function vapidKeyBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

export function V2PushNotificationControl({ enabled }: { enabled: boolean }) {
  const [browserState, setBrowserState] = useState<BrowserState>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const config = v2trpc.pushNotifications.config.useQuery(undefined, { enabled });
  const current = v2trpc.pushNotifications.current.useQuery(
    { endpoint: endpoint ?? "https://invalid.local" },
    { enabled: enabled && Boolean(endpoint) }
  );
  const subscribe = v2trpc.pushNotifications.subscribe.useMutation();
  const revoke = v2trpc.pushNotifications.revokeCurrent.useMutation();
  const sendControlledTest = v2trpc.pushNotifications.sendControlledTest.useMutation();

  const refreshBrowserState = useCallback(async () => {
    if (!enabled || !browserSupportsPush()) {
      setBrowserState("unsupported");
      setEndpoint(null);
      return;
    }
    if (Notification.permission === "denied") {
      setBrowserState("blocked");
      setEndpoint(null);
      return;
    }
    setBrowserState("ready");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    setEndpoint(subscription?.endpoint ?? null);
  }, [enabled]);

  useEffect(() => {
    refreshBrowserState().catch(() => {
      setBrowserState("unsupported");
      setEndpoint(null);
    });
  }, [refreshBrowserState]);

  if (!enabled) return null;
  if (browserState === "loading") return null;
  if (browserState === "unsupported") {
    return (
      <p className="px-2 text-xs text-muted-foreground">Avisos não são compatíveis com este navegador.</p>
    );
  }
  if (browserState === "blocked") {
    return (
      <p className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <ShieldAlert aria-hidden="true" className="size-4" /> Avisos bloqueados no navegador.
      </p>
    );
  }

  const activate = async () => {
    let browserSubscription: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setBrowserState("blocked");
        return;
      }
      if (!config.data?.publicKey) {
        toast.error("Os avisos ainda não estão configurados para este ambiente.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      browserSubscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(config.data.publicKey),
        }));
      const data = browserSubscription.toJSON();
      if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth)
        throw new Error("O navegador não retornou uma subscription válida.");
      await subscribe.mutateAsync({
        endpoint: data.endpoint,
        keys: { p256dh: data.keys.p256dh, auth: data.keys.auth },
        userAgent: navigator.userAgent,
      });
      setEndpoint(data.endpoint);
      await current.refetch();
      toast.success("Avisos ativados neste dispositivo.");
    } catch (error) {
      await browserSubscription?.unsubscribe().catch(() => false);
      toast.error(error instanceof Error ? error.message : "Não foi possível ativar os avisos.");
    }
  };

  const deactivate = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await revoke.mutateAsync({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      await current.refetch();
      toast.success("Avisos desativados neste dispositivo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desativar os avisos.");
    }
  };

  const active = Boolean(endpoint && current.data?.active);
  return active ? (
    <div className="flex flex-col gap-1">
      {config.data?.controlledTestEnabled && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          onClick={() =>
            sendControlledTest.mutate(undefined, {
              onSuccess: () => toast.success("Teste de aviso enviado."),
              onError: error => toast.error(error.message),
            })
          }
          disabled={sendControlledTest.isPending}
        >
          <BellRing aria-hidden="true" className="mr-2 size-4" /> {sendControlledTest.isPending ? "Enviando teste…" : "Enviar teste de aviso"}
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" className="justify-start" onClick={deactivate} disabled={revoke.isPending}>
        <BellOff aria-hidden="true" className="mr-2 size-4" /> Desativar avisos
      </Button>
    </div>
  ) : (
    <Button type="button" size="sm" variant="ghost" className="justify-start" onClick={activate} disabled={subscribe.isPending || config.isLoading}>
      <BellRing aria-hidden="true" className="mr-2 size-4" /> {subscribe.isPending ? "Ativando…" : "Ativar avisos"}
    </Button>
  );
}
