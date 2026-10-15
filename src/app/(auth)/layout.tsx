import { BrandLogo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f6f7f9] px-4 py-10">
      {/* Halo discret aux couleurs PillQare */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgba(18,41,90,0.10),transparent),radial-gradient(40rem_24rem_at_90%_110%,rgba(27,122,69,0.08),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(16,24,40,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(16,24,40,0.035)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="relative mb-8">
        <BrandLogo />
      </div>
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-white/90 p-8 shadow-[0_20px_50px_-20px_rgba(16,24,40,0.18)] backdrop-blur">{children}</div>
      <p className="relative mt-6 text-xs text-muted-foreground">PillQare — une solution française de gestion des médicaments</p>
    </div>
  );
}
