import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function InstallAppButton({ className = "" }: { className?: string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const receivePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", receivePrompt);
    return () => window.removeEventListener("beforeinstallprompt", receivePrompt);
  }, []);
  const install = async () => {
    if (!installPrompt) { setHelp(true); return; }
    await installPrompt.prompt();
    const selection = await installPrompt.userChoice;
    if (selection.outcome === "accepted") setInstallPrompt(null);
  };
  return <div className={className}><Button type="button" variant="outline" onClick={install} className="w-full"><Download className="mr-2 h-4 w-4" /> Instalar aplicativo</Button>{help && <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">No iPhone/iPad, abra o menu Compartilhar do Safari e escolha <strong>Adicionar à Tela de Início</strong>. No Android ou computador, use o menu do navegador e escolha <strong>Instalar app</strong>.</p>}</div>;
}
