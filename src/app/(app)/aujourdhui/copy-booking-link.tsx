"use client";

import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyBookingLink({ url }: { url: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast.success("Lien de prise de RDV copié", { description: url });
        } catch {
          toast.info(url);
        }
      }}
    >
      <Link2 /> Mon lien de RDV
    </Button>
  );
}
