"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { listTemplatesAction, renderTemplateAction, sendEmailAction } from "@/actions/emails";
import { TEMPLATE_CATEGORY_LABELS } from "@/lib/labels";
import { AiEmailAssist } from "./ai-email-assist";

export type ComposerProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  to?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  dealId?: string | null;
  replyTo?: { id: string; subject: string } | null;
  defaultSubject?: string;
  defaultBody?: string;
  /** Ouvre l'éditeur avec une proposition de réponse rédigée par l'IA */
  aiReply?: boolean;
};

export function EmailComposer({ open, onOpenChange, to, contactId, contactName, dealId, replyTo, defaultSubject, defaultBody, aiReply }: ComposerProps) {
  const { integrations } = useAppData();
  const [toValue, setTo] = useState(to ?? "");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(defaultSubject ?? (replyTo ? (replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`) : ""));
  const [body, setBody] = useState(defaultBody ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; category: keyof typeof TEMPLATE_CATEGORY_LABELS }[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [loadingTpl, setLoadingTpl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && templates.length === 0) listTemplatesAction().then(setTemplates).catch(() => undefined);
  }, [open, templates.length]);

  const send = useAction(sendEmailAction, {
    onSuccess: () => {
      onOpenChange(false);
      setBody("");
      setFiles([]);
    },
  });

  const applyTemplate = async (id: string) => {
    setTemplateId(id);
    if (!id) return;
    setLoadingTpl(true);
    const res = await renderTemplateAction(id, { contactId, dealId });
    setLoadingTpl(false);
    if (res.ok && res.data) {
      if (!replyTo) setSubject(res.data.subject);
      setBody(res.data.body);
    } else if (!res.ok) toast.error(res.error);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{replyTo ? "Répondre" : "Nouvel email"}{contactName ? ` — ${contactName}` : ""}</SheetTitle>
          <SheetDescription>
            {integrations.mailbox
              ? "Envoyé depuis votre adresse professionnelle et enregistré sur la fiche du contact. Votre signature est ajoutée automatiquement."
              : "Aucune boîte mail connectée : configurez votre adresse dans Paramètres > Intégrations."}
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData();
            fd.set("to", toValue);
            fd.set("cc", cc);
            fd.set("subject", subject);
            fd.set("body", body);
            if (contactId) fd.set("contactId", contactId);
            if (dealId) fd.set("dealId", dealId);
            if (replyTo) fd.set("replyToId", replyTo.id);
            files.forEach((f) => fd.append("attachments", f));
            send.run(fd);
          }}
          id="email-composer-form"
        >
          <FormField label="À" htmlFor="composer-to">
            <div className="flex gap-2">
              <Input id="composer-to" className="h-9" value={toValue} onChange={(e) => setTo(e.target.value)} placeholder="email@exemple.fr" />
              {!showCc && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCc(true)}>
                  Cc
                </Button>
              )}
            </div>
          </FormField>
          {showCc && (
            <FormField label="Cc">
              <Input className="h-9" value={cc} onChange={(e) => setCc(e.target.value)} />
            </FormField>
          )}
          <FormField label="Modèle" htmlFor="composer-template">
            <div className="flex items-center gap-2">
              <SelectField
                id="composer-template"
                value={templateId}
                onChange={applyTemplate}
                placeholder="Sans modèle"
                options={templates.map((t) => ({ value: t.id, label: `${TEMPLATE_CATEGORY_LABELS[t.category]} — ${t.name}` }))}
              />
              {loadingTpl && <Spinner />}
            </div>
          </FormField>
          {integrations.ai && (contactId || dealId || replyTo) && (
            <AiEmailAssist
              autoReply={aiReply}
              contactId={contactId}
              dealId={dealId}
              replyToId={replyTo?.id ?? null}
              current={{ subject, body }}
              onApply={(d) => {
                setSubject(d.subject);
                setBody(d.body);
              }}
            />
          )}
          <FormField label="Objet">
            <Input className="h-9" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField label="Message" hint="Variables possibles : {{contact.firstName}}, {{bookingLink}}…" className="flex flex-1 flex-col">
            <Textarea className="min-h-64 flex-1" value={body} onChange={(e) => setBody(e.target.value)} />
          </FormField>
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                setFiles((f) => [...f, ...list]);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Paperclip /> Joindre un fichier
            </Button>
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-xs">
                <span className="truncate">
                  {f.name} ({Math.round(f.size / 1024)} Ko)
                </span>
                <button type="button" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </form>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" form="email-composer-form" disabled={send.pending}>
            {send.pending && <Spinner />} Envoyer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
