import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function V2PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("v2-page-header", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="v2-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="v2-page-header-actions">{actions}</div>}
    </header>
  );
}
