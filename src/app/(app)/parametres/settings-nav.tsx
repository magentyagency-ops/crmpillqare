"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function SettingsNav({ items }: { items: { href: string; label: string; group: string }[] }) {
  const pathname = usePathname();
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <nav className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-brand-navy">Paramètres</h1>
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g}</div>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className={cn("block rounded-md px-2 py-1.5 text-sm", pathname === i.href ? "bg-card font-medium text-brand-navy shadow-xs surface" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
