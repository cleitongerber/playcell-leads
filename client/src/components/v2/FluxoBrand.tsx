import { cn } from "@/lib/utils";

/**
 * Textual FLUXO lockup.
 *
 * The official flowing-symbol asset has not been supplied to this repository.
 * Keeping the wordmark textual is intentional: it avoids fabricating or
 * approximating a logo until the approved asset can be added unchanged.
 */
export function FluxoBrand({
  compact = false,
  inverse = false,
  className,
}: {
  compact?: boolean;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fluxo-brand",
        inverse && "fluxo-brand-inverse",
        compact && "fluxo-brand-compact",
        className
      )}
      aria-label="FLUXO — Gestão de leads e performance comercial"
    >
      <span className="fluxo-wordmark">FLUXO</span>
      {!compact && (
        <span className="fluxo-brand-descriptor">
          Gestão de leads e performance comercial
        </span>
      )}
    </div>
  );
}
