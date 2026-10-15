"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarCheck2,
  CalendarDays,
  CheckSquare,
  FileText,
  FlaskConical,
  Kanban,
  LayoutDashboard,
  Mail,
  Repeat,
  Settings,
  ShoppingBag,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "cn";
import { BrandLogo } from "@/components/brand";

export type SidebarCounts = {
  today: number;
  replies: number;
  approvals: number;
  reports: number;
};

const NAV = [
  { section: "Au quotidien" },
  { href: "/aujourdhui", label: "Ma journée", icon: CalendarCheck2, count: "today" as const },
  { href: "/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/taches", label: "Tâches", icon: CheckSquare },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/emails", label: "Emails", icon: Mail, count: "replies" as const },
  { href: "/relances", label: "Relances", icon: Repeat, count: "approvals" as const },
  { href: "/assistant", label: "Assistant IA", icon: Sparkles, count: "reports" as const },
  { section: "Clients" },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/organisations", label: "Organisations", icon: Building2 },
  { href: "/devis", label: "Devis", icon: FileText },
  { href: "/essais", label: "Essais & pilotes", icon: FlaskConical },
  { href: "/commandes", label: "Commandes", icon: ShoppingBag },
  { section: "Administration" },
  { href: "/parametres", label: "Paramètres", icon: Settings },
] as const;

export function SidebarNav({ counts, onNavigate }: { counts: SidebarCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav data-tour="nav" className="flex flex-1 flex-col gap-px overflow-y-auto px-3 pb-4">
      {NAV.map((item, i) => {
        if ("section" in item) {
          return (
            <div key={i} className="mt-5 mb-1.5 px-2.5 text-[11px] font-medium tracking-wide text-slate-400 first:mt-2">
              {item.section}
            </div>
          );
        }
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const countKey = (item as { count?: keyof SidebarCounts }).count;
        const count = countKey ? counts[countKey] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-all",
              active ? "bg-white text-brand-navy shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-sidebar-border" : "text-sidebar-foreground hover:bg-slate-900/[0.04] hover:text-foreground",
            )}
          >
            <Icon className={cn("size-[17px] transition-colors", active ? "text-sidebar-primary" : "text-slate-400 group-hover:text-slate-600")} />
            <span className="flex-1">{item.label}</span>
            {count > 0 && (
              <span className={cn("min-w-5 rounded-md px-1.5 py-px text-center text-[10.5px] font-semibold tabular-nums", countKey === "today" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ counts }: { counts: SidebarCounts }) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-15 items-center px-5">
        <Link href="/aujourdhui" className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
          <BrandLogo />
        </Link>
      </div>
      <SidebarNav counts={counts} />
    </aside>
  );
}
