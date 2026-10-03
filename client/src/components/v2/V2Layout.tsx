import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Visual primitives only. They deliberately do not own data, permissions, or actions. */
export function SectionCard({ className, ...props }: ComponentProps<"div">) {
  return <Card className={cn("v2-section-card", className)} {...props} />;
}

export function PageToolbar({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("v2-page-toolbar", className)} {...props}>
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <article className={cn("v2-kpi-card", `is-${tone}`, className)}>
      <div className="v2-kpi-card-heading">
        {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
        <span>{label}</span>
      </div>
      <strong className="v2-kpi-value">{value}</strong>
      {detail ? <span className="v2-kpi-detail">{detail}</span> : null}
    </article>
  );
}

export function DataTable({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("v2-data-table", className)} {...props}>
      {children}
    </div>
  );
}

/** Use when a toolbar needs standard card spacing while preserving arbitrary controls. */
export function ToolbarCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card className={cn("v2-page-toolbar", className)}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
