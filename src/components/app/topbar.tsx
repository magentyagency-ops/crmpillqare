"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  CalendarPlus,
  CheckSquare,
  FileText,
  Kanban,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  User,
  UserPlus,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/common/ui-bits";
import { BrandLogo } from "@/components/brand";
import { useAppData } from "./app-data";
import { SidebarNav, type SidebarCounts } from "./sidebar";
import { ContactDialog } from "@/components/dialogs/contact-dialog";
import { DealDialog } from "@/components/dialogs/deal-dialogs";
import { TaskDialog } from "@/components/dialogs/task-dialog";
import { MeetingDialog } from "@/components/dialogs/meeting-dialog";
import { getNotificationsAction, globalSearchAction, markNotificationsReadAction, type SearchResult } from "@/actions/app";
import { logoutAction } from "@/actions/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { formatRelative } from "@/lib/dates";
import { GuideButton } from "@/components/guide/guide";

const TYPE_ICON = { contact: User, company: Building2, deal: Kanban, quote: FileText, order: ShoppingBag } as const;
const TYPE_LABEL = { contact: "Contacts", company: "Organisations", deal: "Dossiers", quote: "Devis", order: "Commandes" } as const;

function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onQuery = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    if (value.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await globalSearchAction(value);
        if (id === seq.current) setResults(res);
      } catch {
        if (id === seq.current) setResults([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 200);
  };

  const groups = (Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[])
    .map((type) => ({ type, items: results.filter((r) => r.type === type) }))
    .filter((g) => g.items.length);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-transparent bg-slate-900/[0.045] px-3 text-sm text-muted-foreground transition-all hover:border-border hover:bg-white hover:shadow-xs"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">
          <span className="hidden sm:inline">Rechercher un contact, une organisation, un dossier…</span>
          <span className="sm:hidden">Rechercher…</span>
        </span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Recherche" description="Rechercher dans le CRM">
        {/* Résultats fournis par le serveur : pas de filtrage local par cmdk */}
        <Command shouldFilter={false}>
        <CommandInput placeholder="Nom, email, téléphone, n° de devis…" value={q} onValueChange={onQuery} />
        <CommandList className="max-h-[60vh]">
          {loading && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}
          {!loading && q.trim().length >= 2 && <CommandEmpty>Aucun résultat</CommandEmpty>}
          {groups.map((g) => {
            const Icon = TYPE_ICON[g.type];
            return (
              <CommandGroup key={g.type} heading={TYPE_LABEL[g.type]}>
                {g.items.map((r) => (
                  <CommandItem
                    key={`${r.type}-${r.id}`}
                    value={`${r.type}-${r.id}`}
                    onSelect={() => {
                      setOpen(false);
                      onQuery("");
                      router.push(r.href);
                    }}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate">{r.title}</div>
                      {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

type NotificationItem = Awaited<ReturnType<typeof getNotificationsAction>>["items"][number];

function Notifications({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(initialUnread);

  const load = useCallback(async () => {
    try {
      const res = await getNotificationsAction();
      setItems(res.items);
      setUnread(res.unread);
    } catch {
      // session expirée : ignoré
    }
  }, []);

  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={async () => {
                await markNotificationsReadAction();
                load();
              }}
            >
              Tout marquer comme lu
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Aucune notification</p>}
          {items.map((n) => (
            <button
              key={n.id}
              className={cn("block w-full border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent", !n.readAt && "bg-sky-50/70")}
              onClick={async () => {
                setOpen(false);
                if (!n.readAt) await markNotificationsReadAction([n.id]);
                if (n.link) router.push(n.link);
                load();
              }}
            >
              <div className="flex items-start gap-2">
                {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{formatRelative(new Date(n.createdAt))}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Topbar({ counts, unread }: { counts: SidebarCounts; unread: number }) {
  const { me } = useAppData();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<"contact" | "deal" | "task" | "meeting" | null>(null);

  return (
    <header className="no-print sticky top-0 z-20 flex h-15 items-center gap-3 border-b border-border/80 bg-white/75 px-4 backdrop-blur-xl backdrop-saturate-150 lg:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
        <Menu className="size-5" />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-15 items-center px-5">
            <BrandLogo />
          </div>
          <SidebarNav counts={counts} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 justify-center lg:justify-start">
        <div data-tour="search" className="rounded-lg">
          <GlobalSearch />
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" data-tour="create">
            <Plus /> <span className="hidden sm:inline">Créer</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setDialog("contact")}>
            <UserPlus /> Contact / prospect
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("deal")}>
            <Kanban /> Dossier commercial
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("task")}>
            <CheckSquare /> Tâche / appel
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("meeting")}>
            <CalendarPlus /> Rendez-vous
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/devis/nouveau">
              <FileText /> Devis
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/assistant/nouveau">
              <Sparkles /> Assistant IA (appel, visio, RDV)
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GuideButton />

      <span data-tour="notifications" className="inline-flex rounded-full">
        <Notifications initialUnread={unread} />
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-tour="account" className="flex items-center gap-2 rounded-full outline-none" aria-label="Mon compte">
            <UserAvatar user={me} size="md" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <div className="font-semibold">
              {me.firstName} {me.lastName}
            </div>
            <div className="text-xs font-normal text-muted-foreground">
              {me.email} · {ROLE_LABELS[me.role]}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/parametres/profil">
              <User /> Mon profil et ma signature
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/parametres/rendez-vous">
              <CalendarPlus /> Mon lien de prise de RDV
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/parametres/integrations">
              <Settings /> Mes intégrations (email, agenda)
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logoutAction()}>
            <LogOut /> Se déconnecter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "contact" && <ContactDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "deal" && <DealDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "task" && <TaskDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "meeting" && <MeetingDialog open onOpenChange={(o) => !o && setDialog(null)} />}
    </header>
  );
}
