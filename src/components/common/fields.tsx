"use client";

import { Children, cloneElement, isValidElement, useId, useState } from "react";
import { cn } from "cn";
import { DatePicker, TimePicker } from "@/components/common/date-time-pickers";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function FormField({
  label,
  hint,
  error,
  required,
  className,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Identifiant du champ quand celui-ci est enveloppé dans un autre élément */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  // Associe le libellé au champ (accessibilité, clic sur le libellé) : identifiant transmis au premier enfant
  const generatedId = useId();
  let controlId: string | undefined = htmlFor;
  let control = children;
  if (!htmlFor) {
    const items = Children.toArray(children);
    const first = items[0];
    if (isValidElement<{ id?: string }>(first)) {
      controlId = first.props.id ?? generatedId;
      if (!first.props.id) control = [cloneElement(first, { id: controlId }), ...items.slice(1)];
    }
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={controlId} className="text-xs font-medium text-foreground/80">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {control}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  className,
  name,
  disabled,
  id,
  ariaLabel,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  name?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <NativeSelect id={id} aria-label={ariaLabel} name={name} value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)} className={cn("w-full [&_select]:h-9", className)}>
      {placeholder !== undefined && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Date + heure optionnelle → valeur « yyyy-MM-dd » ou « yyyy-MM-ddTHH:mm » (fuseau de l'utilisateur). */
export function DateTimeField({ value, onChange, allowNoTime = true, className, id }: { value: string; onChange: (v: string) => void; allowNoTime?: boolean; className?: string; id?: string }) {
  const [date, time] = value.split("T");
  return (
    <div className={cn("flex gap-2", className)}>
      <DatePicker id={id} className="min-w-0 flex-1" value={date ?? ""} onChange={(d) => onChange(d ? (time ? `${d}T${time}` : allowNoTime ? d : `${d}T09:00`) : "")} />
      <TimePicker
        ariaLabel="Heure"
        placeholder={allowNoTime ? "Heure" : "09:00"}
        allowEmpty={allowNoTime}
        value={time ?? ""}
        onChange={(t) => {
          const d = date || new Date().toISOString().slice(0, 10);
          onChange(t ? `${d}T${t}` : allowNoTime ? d : `${d}T09:00`);
        }}
      />
    </div>
  );
}

/** Raccourcis de date (aujourd'hui, demain, +2 j, +1 sem.) */
export function QuickDates({ onPick, tz }: { onPick: (v: string) => void; tz?: string }) {
  // Calcul sur la date du jour dans le fuseau de l'utilisateur ; un samedi ou un dimanche est reporté au lundi
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const add = (days: number) => {
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d + days, 12));
    if (days > 0) {
      const dow = date.getUTCDay();
      if (dow === 6) date.setUTCDate(date.getUTCDate() + 2);
      if (dow === 0) date.setUTCDate(date.getUTCDate() + 1);
    }
    return date.toISOString().slice(0, 10);
  };
  const items = [
    { label: "Aujourd'hui", v: add(0) },
    { label: "Demain", v: add(1) },
    { label: "Dans 3 j", v: add(3) },
    { label: "1 semaine", v: add(7) },
    { label: "2 semaines", v: add(14) },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <button key={i.label} type="button" onClick={() => onPick(i.v)} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirmer",
  onConfirm,
  children,
  destructive,
  variant = "outline",
  size = "sm",
  disabled,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<unknown>;
  children: React.ReactNode;
  destructive?: boolean;
  variant?: "outline" | "ghost" | "destructive" | "default" | "secondary";
  size?: "sm" | "default" | "xs" | "icon-sm" | "icon";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={async () => {
              await onConfirm();
              setOpen(false);
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
