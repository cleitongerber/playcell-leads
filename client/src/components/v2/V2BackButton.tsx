import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { currentV2Path, resolveV2BackPath } from "@/lib/operationalNavigation";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import {
  useV2NavigationRole,
  useV2PreviousInternalPath,
} from "./V2AppShell";

export function V2BackButton({ fallbackPath }: { fallbackPath?: string }) {
  const [, navigate] = useLocation();
  const role = useV2NavigationRole();
  const previousPath = useV2PreviousInternalPath();
  const currentPath = currentV2Path();
  const from =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("from");
  const target = resolveV2BackPath({
    currentPath,
    from,
    previousPath,
    fallbackPath,
    role,
  });
  const canUseBrowserBack = Boolean(target && previousPath === target);

  if (!target) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="v2-back-button"
          aria-label="Voltar"
          onClick={() => {
            if (canUseBrowserBack) {
              window.history.back();
              return;
            }
            navigate(target, { replace: true });
          }}
        >
          <ArrowLeft className="size-[18px]" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Voltar</TooltipContent>
    </Tooltip>
  );
}
