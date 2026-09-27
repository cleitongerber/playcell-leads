import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FluxoBrand } from "@/components/v2/FluxoBrand";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="fluxo-login-shell">
      <Card className="w-full max-w-lg fluxo-login-card">
        <CardContent className="space-y-8 px-6 py-8 text-center sm:px-8">
          <div className="flex justify-center">
            <FluxoBrand />
          </div>
          <div className="flex justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
              <AlertCircle aria-hidden="true" className="size-6" />
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-manrope text-3xl font-bold tracking-tight text-foreground">404</p>
            <h1 className="font-manrope text-xl font-bold text-foreground">Página não encontrada</h1>
            <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
              O endereço pode estar incorreto ou o conteúdo não está mais disponível.
            </p>
          </div>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="min-w-44"
            >
              <Home className="w-4 h-4 mr-2" />
              Voltar ao início
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
