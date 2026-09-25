import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function V2LoadingState({ label = "Carregando dados…" }: { label?: string }) {
  return (
    <div className="grid gap-4" role="status" aria-label={label}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function V2ErrorState({
  message = "Não foi possível carregar os dados.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Card role="alert">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
        <p className="font-medium">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            Tentar novamente
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
