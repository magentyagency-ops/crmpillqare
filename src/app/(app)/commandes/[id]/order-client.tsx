"use client";

import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction } from "@/hooks/use-action";
import { markOrderStepAction, startPostPurchaseAction } from "@/actions/orders";

export function OrderFollowUp({ orderId, installation, onboarding, started, cancelled }: { orderId: string; installation: boolean; onboarding: boolean; started: boolean; cancelled: boolean }) {
  const mark = useAction((step: "installation" | "onboarding", done: boolean) => markOrderStepAction(orderId, step, done));
  const start = useAction(() => startPostPurchaseAction(orderId));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={installation} disabled={mark.pending || cancelled} onCheckedChange={(c) => mark.run("installation", Boolean(c))} /> Installation réalisée
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={onboarding} disabled={mark.pending || cancelled} onCheckedChange={(c) => mark.run("onboarding", Boolean(c))} /> Prise en main validée
        </label>
      </div>
      {!started && !cancelled && (
        <Button size="sm" variant="outline" disabled={start.pending} onClick={() => start.run()}>
          <Play /> Démarrer le suivi après-achat
        </Button>
      )}
    </div>
  );
}
