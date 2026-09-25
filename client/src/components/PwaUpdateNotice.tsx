import { Button } from "@/components/ui/button";
import { RefreshCw, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Registers the service worker and exposes a safe, user-controlled update. */
export function PwaUpdateNotice() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const inspectRegistration = (next: ServiceWorkerRegistration) => {
      registration = next;
      if (next.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(next.waiting);
        setDismissed(false);
      }
      next.addEventListener("updatefound", () => {
        const installing = next.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            setWaitingWorker(installing);
            setDismissed(false);
          }
        });
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(inspectRegistration)
      .catch(() => undefined);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      registration?.update().catch(() => undefined);
    };
  }, []);

  return (
    <>
      {offline && (
        <div className="v2-offline-banner" role="status">
          <WifiOff aria-hidden="true" className="size-4" />
          <span>Você está offline. Dados operacionais exigem conexão.</span>
        </div>
      )}
      {waitingWorker && !dismissed && (
        <div className="v2-update-banner" role="status">
          <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">Uma nova versão está disponível.</span>
          <Button
            type="button"
            size="sm"
            onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })}
          >
            Atualizar
          </Button>
          <button
            type="button"
            className="v2-banner-dismiss"
            aria-label="Dispensar aviso de atualização"
            onClick={() => setDismissed(true)}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
