import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FluxoBrand } from "@/components/v2/FluxoBrand";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fluxo-login-shell">
          <Card className="w-full max-w-lg fluxo-login-card">
            <CardContent className="space-y-8 px-6 py-8 text-center sm:px-8">
              <div className="flex justify-center">
                <FluxoBrand />
              </div>
              <div className="flex justify-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <AlertTriangle aria-hidden="true" className="size-6" />
                </div>
              </div>

              <div className="space-y-3">
                <h1 className="font-manrope text-xl font-bold text-foreground">Não foi possível carregar esta tela</h1>
                <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                  Tente atualizar a página. Se o problema persistir, entre em contato com o administrador da operação.
                </p>
              </div>

              <div>
                <Button type="button" onClick={() => window.location.reload()}>
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Atualizar página
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
