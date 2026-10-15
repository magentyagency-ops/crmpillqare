"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { unsubscribeAction } from "@/actions/public";

export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  if (state === "done") return <p className="text-sm text-emerald-800">C&apos;est noté : vous ne recevrez plus nos messages.</p>;
  return (
    <>
      <Button
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          const res = await unsubscribeAction(token);
          setState(res.ok ? "done" : "error");
        }}
      >
        {state === "pending" && <Spinner />} Me désinscrire
      </Button>
      {state === "error" && <p className="mt-2 text-sm text-rose-600">Une erreur est survenue, réessayez.</p>}
    </>
  );
}
