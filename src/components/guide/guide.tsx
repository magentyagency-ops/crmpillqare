"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, GraduationCap, Hand, ListOrdered, Pause, Play, RotateCcw, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { guideSamplesAction } from "@/actions/guide";
import { ALL_STEPS, CHAPTERS } from "./steps";

/* ------------------------------------------------------------------ */
/* État partagé (conservé dans le navigateur : on reprend après un rechargement) */

type GuideState = { status: "off" | "running" | "paused"; index: number; seen: boolean };
const KEY = "pq:guide";
const DEFAULT: GuideState = { status: "off", index: 0, seen: false };
let state: GuideState = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    // stockage indisponible : le guide fonctionne sans mémoire
  }
  if (state.index >= ALL_STEPS.length) state = { ...state, index: 0 };
}

function setGuide(patch: Partial<GuideState>) {
  state = { ...state, ...patch, seen: true };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignoré
  }
  listeners.forEach((l) => l());
}

function useGuide() {
  return useSyncExternalStore(
    (l) => {
      load();
      listeners.add(l);
      l();
      return () => listeners.delete(l);
    },
    () => state,
    () => DEFAULT,
  );
}

/* ------------------------------------------------------------------ */
/* Recherche de l'élément à mettre en avant */

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function findTarget(spec?: string): HTMLElement | null {
  if (!spec) return null;
  for (const part of spec.split("||").map((s) => s.trim())) {
    if (part.startsWith("text:")) {
      const text = part.slice(5).trim().toLowerCase();
      const heading = [...document.querySelectorAll("main h1, main h2, main h3")].find((h) => h.textContent?.trim().toLowerCase().startsWith(text));
      const card = heading?.closest("section, .surface") ?? heading;
      if (visible(card ?? null)) return card as HTMLElement;
      continue;
    }
    try {
      const el = [...document.querySelectorAll(part)].find(visible);
      if (el) return el as HTMLElement;
    } catch {
      // sélecteur invalide : on passe au suivant
    }
  }
  return null;
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const EASE = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
// Styles essentiels en ligne : le guide reste correct même si la feuille de style n'est pas encore rechargée
const VEIL: React.CSSProperties = { position: "fixed", background: "rgba(15, 23, 42, 0.58)", transition: EASE };
const HOLE: React.CSSProperties = {
  position: "fixed",
  borderRadius: 14,
  boxShadow: "0 0 0 3px rgba(139, 92, 246, 0.95), 0 0 0 9px rgba(139, 92, 246, 0.25)",
  transition: EASE,
  pointerEvents: "auto",
};

/* ------------------------------------------------------------------ */
/* Bouton « Guide » (barre du haut) + superposition */

export function GuideButton() {
  const guide = useGuide();
  const [menu, setMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- le portail n'existe que côté navigateur
  useEffect(() => setMounted(true), []);

  const start = (index: number) => {
    setMenu(false);
    setGuide({ status: "running", index });
  };
  const current = ALL_STEPS[guide.index];

  return (
    <>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="relative gap-1.5" aria-label="Guide interactif">
            <GraduationCap /> <span className="hidden md:inline">Guide</span>
            {mounted && !guide.seen && <span className="absolute -top-1 -right-1 size-2.5 animate-pulse rounded-full bg-violet-500 ring-2 ring-white" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b px-4 py-3">
            <p className="font-semibold">Guide interactif</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Une visite pas à pas de toutes les fonctionnalités. Mettez en pause pour essayer, reprenez quand vous voulez.</p>
          </div>
          <div className="space-y-1.5 p-3">
            {guide.status !== "off" && guide.index > 0 ? (
              <>
                <Button className="w-full justify-start" onClick={() => start(guide.index)}>
                  <Play /> Reprendre · étape {guide.index + 1}/{ALL_STEPS.length}
                </Button>
                <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => start(0)}>
                  <RotateCcw /> Recommencer depuis le début
                </Button>
              </>
            ) : (
              <Button className="w-full justify-start" onClick={() => start(0)}>
                <Play /> Démarrer la visite ({ALL_STEPS.length} étapes, ~5 min)
              </Button>
            )}
          </div>
          <div className="max-h-[50vh] overflow-y-auto border-t px-2 py-2">
            <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Chapitres</p>
            {CHAPTERS.map((c) => {
              const first = ALL_STEPS.findIndex((s) => s.chapter.id === c.id);
              const active = guide.status !== "off" && current?.chapter.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => start(first)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", active && "bg-violet-50 text-violet-900")}
                >
                  <span className="w-5 text-center">{c.icon}</span>
                  <span className="flex-1">{c.title}</span>
                  <span className="text-xs text-muted-foreground">{c.steps.length}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {mounted && guide.status === "running" && createPortal(<GuideOverlay index={guide.index} />, document.body)}
      {mounted && guide.status === "paused" && createPortal(<PausedPill index={guide.index} />, document.body)}
    </>
  );
}

function PausedPill({ index }: { index: number }) {
  const step = ALL_STEPS[index];
  return (
    <div className="pq-guide-in fixed bottom-5 left-4 z-[60] flex items-center gap-1 rounded-full bg-slate-900 py-1.5 pr-1.5 pl-1.5 text-white shadow-2xl lg:left-[264px]">
      <button
        type="button"
        onClick={() => setGuide({ status: "running" })}
        className="flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 text-left transition-colors hover:bg-white/10"
        title="Reprendre le guide"
      >
        <span className="grid size-8 place-items-center rounded-full bg-violet-500">
          <Play className="size-4 fill-current" />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold">Reprendre le guide</span>
          <span className="block max-w-[220px] truncate text-[11px] text-white/70">
            Étape {index + 1}/{ALL_STEPS.length} · {step?.title}
          </span>
        </span>
      </button>
      <button type="button" onClick={() => setGuide({ status: "off" })} className="grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" aria-label="Quitter le guide">
        <X className="size-4" />
      </button>
    </div>
  );
}

let samplesCache: Promise<{ contactId: string | null; dealId: string | null }> | null = null;

function GuideOverlay({ index }: { index: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const step = ALL_STEPS[index]!;
  const [route, setRoute] = useState<string | null | undefined>(undefined);
  const [rect, setRect] = useState<Rect | null>(null);
  const [searching, setSearching] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 380, h: 240 });
  const targetRef = useRef<HTMLElement | null>(null);

  const total = ALL_STEPS.length;
  const go = useCallback((i: number) => {
    if (i < 0) return;
    if (i >= total) return setGuide({ status: "off", index: 0 });
    setGuide({ index: i });
  }, [total]);

  // 1. Page de l'étape (fiche d'exemple réelle pour « contact » / « deal »)
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!step.route) return null;
      if (step.route !== "contact" && step.route !== "deal") return step.route;
      samplesCache ??= guideSamplesAction().catch(() => ({ contactId: null, dealId: null }));
      const s = await samplesCache;
      const id = step.route === "contact" ? s.contactId : s.dealId;
      return id ? `/${step.route === "contact" ? "contacts" : "pipeline"}/${id}` : null;
    };
    void resolve().then((r) => {
      if (cancelled) return;
      // Pas d'exemple disponible (base vide) : étape affichée sans navigation
      if (r === null && (step.route === "contact" || step.route === "deal")) setRoute("/contacts");
      else setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [step.route]);

  useEffect(() => {
    if (route && pathname !== route) router.push(route);
  }, [route, pathname, router]);

  // 2. Recherche de l'élément, défilement jusqu'à lui, puis suivi de sa position
  useEffect(() => {
    if (route === undefined || (route && pathname !== route)) return;
    let raf = 0;
    let stop = false;
    const startedAt = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- réinitialisation à chaque étape
    setSearching(true);
    setRect(null);
    const find = () => {
      if (stop) return;
      const el = findTarget(step.target);
      if (el) {
        targetRef.current = el;
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
        if (step.zoom) {
          el.style.transition = "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
          el.style.transform = "scale(1.12)";
        }
        setSearching(false);
        track();
      } else if (!step.target || Date.now() - startedAt > 5000) {
        targetRef.current = null;
        setSearching(false);
      } else raf = window.setTimeout(find, 120) as unknown as number;
    };
    const track = () => {
      if (stop) return;
      const el = targetRef.current;
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect();
        setRect((prev) => (prev && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5 ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
      }
      raf = requestAnimationFrame(track);
    };
    // Laisse React finir d'hydrater la page avant de toucher au DOM (classe de zoom)
    const t = window.setTimeout(find, 400);
    return () => {
      stop = true;
      clearTimeout(t);
      clearTimeout(raf);
      cancelAnimationFrame(raf);
      const el = targetRef.current;
      if (el && step.zoom) {
        el.style.transform = "";
        el.style.transition = "";
      }
    };
  }, [route, pathname, step.target, step.zoom, index]);

  // Taille de la carte pour la placer à côté de l'élément
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clavier : → suivant, ← précédent, Échap pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "Enter") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Escape") setGuide({ status: "paused" });
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, index]);

  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const hole = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;
  const card = placeCard(hole, cardSize, vw, vh, step.placement ?? "auto");
  const chapterSteps = step.chapter.steps.length;
  const inChapter = step.chapter.steps.findIndex((s) => s.id === step.id) + 1;

  return (
    <div className="fixed inset-0 z-[100]" style={{ position: "fixed", inset: 0, zIndex: 100 }} aria-live="polite">
      {/* Voile sombre (4 bandes autour de l'élément) : bloque les clics hors du guide */}
      {hole ? (
        <>
          <div className="pq-guide-veil" style={{ ...VEIL, top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className="pq-guide-veil" style={{ ...VEIL, top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className="pq-guide-veil" style={{ ...VEIL, top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="pq-guide-veil" style={{ ...VEIL, top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          <div className="pq-guide-hole" style={{ ...HOLE, top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
        </>
      ) : (
        <div className="pq-guide-veil" style={{ ...VEIL, inset: 0 }} />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={step.title}
        className="pq-guide-card absolute w-[min(380px,calc(100vw-24px))] rounded-2xl bg-white text-sm text-foreground shadow-[0_24px_60px_-12px_rgba(15,23,42,.45)]"
        style={{ position: "absolute", top: card.top, left: card.left, zIndex: 2, width: "min(380px, calc(100vw - 24px))", background: "#fff", borderRadius: 16, boxShadow: "0 24px 60px -12px rgba(15,23,42,.45)", transition: "top 0.35s cubic-bezier(0.4, 0, 0.2, 1), left 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}
      >
        <div className="flex items-center gap-2 px-5 pt-4">
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
            {step.chapter.icon} {step.chapter.title} · {inChapter}/{chapterSteps}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {index + 1}/{total}
          </span>
          <button type="button" onClick={() => setGuide({ status: "off" })} className="-mr-2 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Quitter le guide" title="Quitter le guide">
            <X className="size-4" />
          </button>
        </div>
        <div className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <div key={step.id} className="pq-guide-in px-5 pt-3.5 pb-1">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{step.title}</h3>
          <p className="mt-1.5 leading-relaxed whitespace-pre-line text-muted-foreground">{step.body}</p>
          {searching && step.target && <p className="mt-2 text-xs text-muted-foreground">Chargement de la page…</p>}
          {step.tryIt && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
              <Hand className="mt-0.5 size-4 shrink-0" />
              <div className="flex-1">
                <span className="font-medium">À vous : </span>
                {step.tryIt}
                <button type="button" onClick={() => setGuide({ status: "paused" })} className="mt-1 block font-semibold text-amber-950 underline underline-offset-2">
                  Mettre en pause pour essayer
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 pt-2 pb-4">
          <Button variant="ghost" size="sm" onClick={() => setGuide({ status: "paused" })} title="Pause (Échap)">
            <Pause /> Pause
          </Button>
          <ChapterJump index={index} />
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => go(index - 1)} aria-label="Étape précédente">
                <ArrowLeft />
              </Button>
            )}
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => go(index + 1)}>
              {index + 1 >= total ? "Terminer" : index === 0 ? "C'est parti" : "Suivant"} {index + 1 < total && <ArrowRight />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChapterJump({ index }: { index: number }) {
  const [open, setOpen] = useState(false);
  const current = ALL_STEPS[index]?.chapter.id;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" title="Chapitres">
          <ListOrdered />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="z-[110] w-64 p-1.5">
        {CHAPTERS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setOpen(false);
              setGuide({ index: ALL_STEPS.findIndex((s) => s.chapter.id === c.id) });
            }}
            className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted", c.id === current && "bg-violet-50 font-medium text-violet-900")}
          >
            <span className="w-5 text-center">{c.icon}</span> {c.title}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Position de la carte : à côté de l'élément si la place le permet, sinon centrée en bas. */
function placeCard(hole: Rect | null, size: { w: number; h: number }, vw: number, vh: number, pref: "auto" | "right" | "left" | "top" | "bottom") {
  const M = 12;
  const GAP = 14;
  const clampX = (x: number) => Math.min(Math.max(M, x), vw - size.w - M);
  const clampY = (y: number) => Math.min(Math.max(M, y), vh - size.h - M);
  if (!hole) return { top: Math.max(M, (vh - size.h) / 2), left: Math.max(M, (vw - size.w) / 2) };
  const options = {
    bottom: { ok: hole.top + hole.height + GAP + size.h < vh - M, pos: { top: hole.top + hole.height + GAP, left: clampX(hole.left + hole.width / 2 - size.w / 2) } },
    top: { ok: hole.top - GAP - size.h > M, pos: { top: hole.top - GAP - size.h, left: clampX(hole.left + hole.width / 2 - size.w / 2) } },
    right: { ok: hole.left + hole.width + GAP + size.w < vw - M, pos: { top: clampY(hole.top), left: hole.left + hole.width + GAP } },
    left: { ok: hole.left - GAP - size.w > M, pos: { top: clampY(hole.top), left: hole.left - GAP - size.w } },
  };
  const order = pref === "auto" ? (["bottom", "right", "top", "left"] as const) : ([pref, "bottom", "right", "top", "left"] as const);
  for (const k of order) if (options[k].ok) return options[k].pos;
  // Élément très grand : carte posée en bas à droite, par-dessus
  return { top: vh - size.h - 24, left: vw - size.w - 24 };
}
