"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

/** Met à jour un paramètre d'URL (filtres côté serveur). */
export function useUrlParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return { params, set, pending };
}

export function SearchFilter({ param = "q", placeholder = "Rechercher…", className }: { param?: string; placeholder?: string; className?: string }) {
  const { params, set, pending } = useUrlParam();
  const [value, setValue] = useState(params.get(param) ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get(param) ?? "") !== value) set({ [param]: value || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="h-9 w-full pl-8 sm:w-64" />
      {pending && <Spinner className="absolute top-1/2 right-2.5 -translate-y-1/2" />}
    </div>
  );
}

export function SelectFilter({ param, options, placeholder, className }: { param: string; options: { value: string; label: string }[]; placeholder: string; className?: string }) {
  const { params, set } = useUrlParam();
  return (
    <NativeSelect value={params.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value || null })} className={cn("w-auto max-w-56 [&_select]:h-9", className)}>
      <NativeSelectOption value="">{placeholder}</NativeSelectOption>
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function TabLinks({ param, tabs, className }: { param: string; tabs: { value: string; label: string; count?: number; tone?: "warning" | "danger" }[]; className?: string }) {
  const { params, set } = useUrlParam();
  const current = params.get(param) ?? tabs[0]?.value ?? "";
  return (
    <div role="tablist" className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={current === t.value}
          onClick={() => set({ [param]: t.value === tabs[0]?.value ? null : t.value })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            current === t.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-bold",
                t.tone === "danger" && t.count > 0 ? "bg-rose-100 text-rose-700" : t.tone === "warning" && t.count > 0 ? "bg-amber-100 text-amber-800" : "bg-foreground/10",
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const { params } = useUrlParam();
  const router = useRouter();
  const pathname = usePathname();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} sur {total}
      </span>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => go(page - 1)} className="rounded-md border px-3 py-1 disabled:opacity-40 hover:bg-accent">
          Précédent
        </button>
        <button disabled={page >= pages} onClick={() => go(page + 1)} className="rounded-md border px-3 py-1 disabled:opacity-40 hover:bg-accent">
          Suivant
        </button>
      </div>
    </div>
  );
}
