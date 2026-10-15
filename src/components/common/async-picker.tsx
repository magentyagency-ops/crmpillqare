"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { PickerOption } from "@/actions/contacts";

/**
 * Sélecteur avec recherche côté serveur (contacts, organisations…).
 * `onCreate` permet de créer une valeur libre (ex. nouvelle organisation).
 */
export function AsyncPicker({
  value,
  onChange,
  search,
  placeholder = "Rechercher…",
  emptyLabel = "Aucun résultat",
  onCreate,
  createLabel = "Créer",
  disabled,
  className,
  id,
}: {
  id?: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  search: (q: string) => Promise<PickerOption[]>;
  placeholder?: string;
  emptyLabel?: string;
  onCreate?: (text: string) => void;
  createLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const runSearch = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await search(text);
        if (id === seq.current) setOptions(res);
      } catch {
        if (id === seq.current) setOptions([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 200);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) runSearch(query);
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" disabled={disabled} className={cn("h-9 w-full justify-between font-normal", !value && "text-muted-foreground", className)}>
          <span className="truncate">{value ? value.label : placeholder}</span>
          <span className="flex items-center gap-1">
            {value && !disabled && (
              <X
                className="size-3.5 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              />
            )}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              runSearch(v);
            }}
          />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-4">
                <Spinner />
              </div>
            )}
            {!loading && <CommandEmpty>{emptyLabel}</CommandEmpty>}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === o.id ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0">
                    <div className="truncate">{o.label}</div>
                    {o.sublabel && <div className="truncate text-xs text-muted-foreground">{o.sublabel}</div>}
                  </div>
                </CommandItem>
              ))}
              {onCreate && query.trim() && !loading && !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) && (
                <CommandItem
                  value={`__create__${query}`}
                  onSelect={() => {
                    onCreate(query.trim());
                    setOpen(false);
                  }}
                >
                  <Plus className="size-4" />
                  {createLabel} « {query.trim()} »
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
