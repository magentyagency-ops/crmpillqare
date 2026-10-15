import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-7 text-muted-foreground" />
      </span>
      <h1 className="text-xl font-semibold text-brand-navy">Élément introuvable</h1>
      <p className="max-w-md text-sm text-muted-foreground">Il a peut-être été supprimé, fusionné avec un doublon, ou vous n&apos;y avez pas accès.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/aujourdhui">Retour à ma journée</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/contacts">Contacts</Link>
        </Button>
      </div>
    </div>
  );
}
