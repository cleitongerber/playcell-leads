import { cn } from "@/lib/utils";

/**
 * FLUXO lockup using the approved master asset and its exact symbol crop.
 *
 * The supplied official asset has a dark application only. The dark sidebar
 * therefore keeps its existing high-contrast textual wordmark until an
 * approved light logo variant is provided; no recoloring or approximation is
 * applied to the official mark.
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
      {inverse ? (
        <span className="fluxo-wordmark">FLUXO</span>
      ) : (
        <img
          className={cn(
            "fluxo-brand-logo",
            compact && "fluxo-brand-symbol"
          )}
          src={compact ? "/brand/fluxo-symbol.png" : "/brand/fluxo-logo.png"}
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      )}
      {!compact && (
        <span className="fluxo-brand-descriptor">
          Gestão de leads e performance comercial
        </span>
      )}
    </div>
  );
}
