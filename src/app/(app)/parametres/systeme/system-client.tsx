"use client";

import { Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { retryFailedJobsAction, runSchedulerNowAction } from "@/actions/settings";

export function SystemActions() {
  const run = useAction(runSchedulerNowAction, { success: false, onSuccess: (r) => toast.success(`Exécuté : ${r?.ran.join(", ")}`) });
  const retry = useAction(retryFailedJobsAction, { success: false, onSuccess: (r) => toast.success(`${r?.count ?? 0} tâche(s) relancée(s)`) });
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" disabled={retry.pending} onClick={() => retry.run()}>
        <RotateCw /> Relancer les échecs
      </Button>
      <Button size="sm" disabled={run.pending} onClick={() => run.run()}>
        <Play /> Exécuter maintenant
      </Button>
    </div>
  );
}
