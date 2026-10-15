import Image from "next/image";
import { cn } from "cn";

export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return <Image src="/pillqare-mark.png" alt="PillQare" width={size} height={size} className={cn("shrink-0", className)} priority />;
}

export function BrandLogo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("flex items-center justify-center rounded-lg", inverted ? "bg-white p-1" : "")}>
        <BrandMark size={inverted ? 22 : 28} />
      </span>
      <span className={cn("text-[17px] font-bold tracking-[-0.02em]", inverted ? "text-white" : "text-brand-navy")}>
        PillQare{" "}
        <span className={cn("rounded-md px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide", inverted ? "bg-white/15 text-white/80" : "bg-brand-navy/[0.07] text-brand-navy/70")}>CRM</span>
      </span>
    </span>
  );
}
