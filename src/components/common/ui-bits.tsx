import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "cn";
import type { DealStage, QuoteStatus, TaskPriority, TrialStatus, ContactStatus } from "@/generated/prisma/enums";
import {
  CONTACT_STATUS_COLORS,
  CONTACT_STATUS_LABELS,
  initials,
  QUOTE_STATUS_COLORS,
  QUOTE_STATUS_LABELS,
  STAGE_COLORS,
  STAGE_LABELS,
  TASK_PRIORITY_COLORS,
  TASK_PRIORITY_LABELS,
  TRIAL_STATUS_COLORS,
  TRIAL_STATUS_LABELS,
} from "@/lib/labels";

export function PageHeader({
  title,
  description,
  actions,
  className,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  back?: { href: string; label: string };
}) {
  return (
    <div data-tour="page-header" className={cn("mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -ml-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-[1.6rem] leading-tight font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
        {description && <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div data-tour="page-actions" className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap", className)}>{children}</span>;
}

export function StageBadge({ stage, className }: { stage: DealStage; className?: string }) {
  return (
    <Pill className={cn(STAGE_COLORS[stage].badge, className)}>
      <span className={cn("size-1.5 rounded-full", STAGE_COLORS[stage].dot)} />
      {STAGE_LABELS[stage]}
    </Pill>
  );
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Pill className={QUOTE_STATUS_COLORS[status]}>{QUOTE_STATUS_LABELS[status]}</Pill>;
}

export function TrialStatusBadge({ status }: { status: TrialStatus }) {
  return <Pill className={TRIAL_STATUS_COLORS[status]}>{TRIAL_STATUS_LABELS[status]}</Pill>;
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Pill className={CONTACT_STATUS_COLORS[status]}>{CONTACT_STATUS_LABELS[status]}</Pill>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "NORMAL") return null;
  return <Pill className={TASK_PRIORITY_COLORS[priority]}>{TASK_PRIORITY_LABELS[priority]}</Pill>;
}

export function SegmentBadge({ segment }: { segment: { name: string; color: string } | null | undefined }) {
  if (!segment) return null;
  return (
    <Pill className="bg-white ring-1 ring-border ring-inset">
      <span className="size-2 rounded-full" style={{ backgroundColor: segment.color }} />
      <span className="text-foreground/80">{segment.name}</span>
    </Pill>
  );
}

export function UserAvatar({ user, size = "sm", className }: { user: { firstName: string; lastName: string; color: string } | null | undefined; size?: "xs" | "sm" | "md"; className?: string }) {
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`;
  const sizes = { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-8 text-xs" };
  return (
    <span title={name} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", sizes[size], className)} style={{ backgroundColor: user.color }}>
      {initials(name)}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger";
  href?: string;
}) {
  const tones = {
    default: { value: "text-foreground", icon: "bg-[#eef2fa] text-brand-navy" },
    success: { value: "text-emerald-700", icon: "bg-emerald-50 text-emerald-700" },
    warning: { value: "text-amber-600", icon: "bg-amber-50 text-amber-600" },
    danger: { value: "text-rose-600", icon: "bg-rose-50 text-rose-600" },
  };
  const content = (
    <div className={cn("h-full rounded-xl bg-card p-4 surface", href && "surface-hover")}>
      <div className="flex items-start justify-between gap-2">
        <span className="pt-0.5 text-[13px] font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tones[tone].icon)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className={cn("mt-1 text-[1.65rem] leading-tight font-semibold tracking-[-0.02em] tabular-nums", tones[tone].value)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl bg-card surface", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyHint({ icon: Icon, title, children, action }: { icon?: ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      {Icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-gradient-to-b from-white to-muted ring-1 ring-border ring-inset shadow-xs">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-xs text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}
