import { cn } from "@/lib/utils";

/**
 * FLUXO lockup using the approved master asset and its exact symbol crop.
 * The inverse sidebar treatment keeps that official symbol untouched and uses
 * a high-contrast textual product label on the dark navigation surface.
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
        <>
          <img
            className="fluxo-brand-sidebar-symbol"
            src="/brand/fluxo-symbol.png"
            alt=""
            aria-hidden="true"
            decoding="async"
          />
          <div className="fluxo-brand-sidebar-copy">
            <span className="fluxo-wordmark">FLUXO</span>
            {!compact && (
              <span className="fluxo-brand-descriptor">
                Gestão de leads e performance comercial
              </span>
            )}
          </div>
        </>
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
      {!inverse && !compact && (
        <span className="fluxo-brand-descriptor">
          Gestão de leads e performance comercial
        </span>
      )}
    </div>
  );
}
