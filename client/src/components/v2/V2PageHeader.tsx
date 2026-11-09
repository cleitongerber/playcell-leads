import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { V2BackButton } from "./V2BackButton";

export function V2PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  backFallback,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  backFallback?: string;
}) {
  return (
    <header className={cn("v2-page-header", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="v2-eyebrow">{eyebrow}</p>}
        <div className="v2-page-title-row">
          <V2BackButton fallbackPath={backFallback} />
          <h1>{title}</h1>
        </div>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="v2-page-header-actions">{actions}</div>}
    </header>
  );
}
