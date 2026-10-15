"use client";

import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { addNoteAction } from "@/actions/contacts";

export function NoteComposer({ contactId, dealId, companyId }: { contactId?: string | null; dealId?: string | null; companyId?: string | null }) {
  const [body, setBody] = useState("");
  const [focused, setFocused] = useState(false);
  const save = useAction(addNoteAction, { onSuccess: () => setBody("") });
  return (
    <form
      className="mb-5 rounded-lg border bg-background p-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ contactId, dealId, companyId, body });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={() => setFocused(true)}
        rows={focused || body ? 3 : 1}
        placeholder="Ajouter une note (compte rendu d'échange, information utile…)"
        className="resize-none border-0 shadow-none focus-visible:ring-0"
      />
      {(focused || body) && (
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => { setBody(""); setFocused(false); }}>
            Annuler
          </Button>
          <Button type="submit" size="sm" disabled={!body.trim() || save.pending}>
            {save.pending ? <Spinner /> : <StickyNote />} Enregistrer la note
          </Button>
        </div>
      )}
    </form>
  );
}
