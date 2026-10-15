import Link from "next/link";
import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileText,
  FileX2,
  FlaskConical,
  Inbox,
  Info,
  Repeat,
  Send,
  ShoppingBag,
  Sparkles,
  Star,
  StickyNote,
  UserCog,
  Eye,
  Phone,
  PlusCircle,
} from "lucide-react";
import type { ActivityType } from "@/generated/prisma/enums";
import { cn } from "cn";
import { ACTIVITY_LABELS, CALL_OUTCOME_LABELS } from "@/lib/labels";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { formatDuration } from "@/lib/format";
import { UserAvatar } from "@/components/common/ui-bits";

const ICONS: Record<ActivityType, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  CALL: { icon: Phone, color: "bg-sky-100 text-sky-700" },
  EMAIL_SENT: { icon: Send, color: "bg-indigo-100 text-indigo-700" },
  EMAIL_RECEIVED: { icon: Inbox, color: "bg-emerald-100 text-emerald-700" },
  MEETING: { icon: CalendarCheck, color: "bg-violet-100 text-violet-700" },
  MEETING_BOOKED: { icon: CalendarPlus, color: "bg-violet-100 text-violet-700" },
  MEETING_CANCELLED: { icon: CalendarX, color: "bg-rose-100 text-rose-700" },
  MEETING_REPORT: { icon: Sparkles, color: "bg-fuchsia-100 text-fuchsia-700" },
  NOTE: { icon: StickyNote, color: "bg-amber-100 text-amber-800" },
  TASK_COMPLETED: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700" },
  DEAL_CREATED: { icon: PlusCircle, color: "bg-slate-100 text-slate-700" },
  STAGE_CHANGED: { icon: ArrowRightLeft, color: "bg-slate-100 text-slate-700" },
  OWNER_CHANGED: { icon: UserCog, color: "bg-slate-100 text-slate-700" },
  QUOTE_CREATED: { icon: FileText, color: "bg-amber-100 text-amber-800" },
  QUOTE_SENT: { icon: FileText, color: "bg-amber-100 text-amber-800" },
  QUOTE_VIEWED: { icon: Eye, color: "bg-amber-100 text-amber-800" },
  QUOTE_ACCEPTED: { icon: FileCheck2, color: "bg-emerald-100 text-emerald-700" },
  QUOTE_REFUSED: { icon: FileX2, color: "bg-rose-100 text-rose-700" },
  ORDER_PLACED: { icon: ShoppingBag, color: "bg-emerald-100 text-emerald-700" },
  FORM_SUBMITTED: { icon: ClipboardList, color: "bg-sky-100 text-sky-700" },
  TRIAL_EVENT: { icon: FlaskConical, color: "bg-teal-100 text-teal-700" },
  SEQUENCE_EVENT: { icon: Repeat, color: "bg-violet-50 text-violet-600" },
  SATISFACTION: { icon: Star, color: "bg-yellow-100 text-yellow-800" },
  SYSTEM: { icon: Info, color: "bg-slate-100 text-slate-600" },
};

export type TimelineItem = {
  id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  occurredAt: Date;
  callOutcome: keyof typeof CALL_OUTCOME_LABELS | null;
  callDurationSec: number | null;
  user: { firstName: string; lastName: string; color: string } | null;
  deal?: { id: string; title: string } | null;
  contact?: { id: string; firstName: string | null; lastName: string | null } | null;
  emailMessageId: string | null;
  meetingId: string | null;
  quoteId: string | null;
  orderId: string | null;
  trialId: string | null;
  aiSessionId: string | null;
};

function linkFor(a: TimelineItem): string | null {
  if (a.aiSessionId) return `/assistant/${a.aiSessionId}`;
  if (a.quoteId) return `/devis/${a.quoteId}`;
  if (a.orderId) return `/commandes/${a.orderId}`;
  if (a.trialId) return `/essais/${a.trialId}`;
  if (a.meetingId) return `/agenda/${a.meetingId}`;
  return null;
}

export function ActivityTimeline({ items, showDeal = true, showContact = false }: { items: TimelineItem[]; showDeal?: boolean; showContact?: boolean }) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Aucune activité pour le moment.</p>;
  }
  return (
    <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
      {items.map((a) => {
        const { icon: Icon, color } = ICONS[a.type];
        const href = linkFor(a);
        const longBody = a.type === "MEETING_REPORT" || a.type === "NOTE";
        return (
          <li key={a.id} className="relative flex gap-3 pl-0">
            <span className={cn("z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", color)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div className="text-sm">
                  <span className="font-medium">{href ? <Link href={href} className="hover:underline">{a.title}</Link> : a.title}</span>
                  {a.type === "CALL" && a.callDurationSec ? <span className="text-muted-foreground"> · {formatDuration(a.callDurationSec)}</span> : null}
                </div>
                <time className="text-xs text-muted-foreground" title={formatDateTime(a.occurredAt)}>
                  {formatRelative(a.occurredAt)}
                </time>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{ACTIVITY_LABELS[a.type]}</span>
                {a.user && (
                  <span className="inline-flex items-center gap-1">
                    <UserAvatar user={a.user} size="xs" /> {a.user.firstName}
                  </span>
                )}
                {showDeal && a.deal && (
                  <Link href={`/pipeline/${a.deal.id}`} className="hover:underline">
                    {a.deal.title}
                  </Link>
                )}
                {showContact && a.contact && (
                  <Link href={`/contacts/${a.contact.id}`} className="hover:underline">
                    {[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ")}
                  </Link>
                )}
              </div>
              {a.body && (
                <div
                  className={cn(
                    "mt-1.5 rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-line text-foreground/85",
                    !longBody && "line-clamp-4",
                  )}
                >
                  {a.body}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const timelineInclude = {
  user: { select: { firstName: true, lastName: true, color: true } },
  deal: { select: { id: true, title: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const;
