"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Paperclip, Reply, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ContactDialog, emptyContact } from "@/components/dialogs/contact-dialog";
import { EmailComposer } from "@/components/dialogs/email-composer";
import { useAppData } from "@/components/app/app-data";
import { getEmailHtmlAction } from "@/actions/emails";

type ReaderEmail = {
  id: string;
  inbound: boolean;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  to: string;
  cc: string;
  date: string;
  handled: boolean;
  attachments: string[];
  contact: { id: string; name: string; email: string | null } | null;
  dealId: string | null;
};

/** Lecture d'un email hors CRM, avec réponse et création du contact. */
export function EmailReader({ email }: { email: ReaderEmail }) {
  const { me, integrations } = useAppData();
  const router = useRouter();
  const [html, setHtml] = useState<string | null>(null);
  const [reply, setReply] = useState<false | "manual" | "ai">(false);
  const [newContact, setNewContact] = useState(false);

  useEffect(() => {
    getEmailHtmlAction(email.id)
      .then(setHtml)
      .catch(() => setHtml("<p>Impossible d'afficher cet email.</p>"));
  }, [email.id]);

  // Prénom / nom proposés d'après le nom de l'expéditeur
  const [firstName, ...rest] = (email.fromName ?? "").replace(/["']/g, "").trim().split(/\s+/);
  // Adresses automatiques (no-reply, notifications) : pas de réponse possible
  const canReply = email.inbound && !/(^|[._-])(no-?reply|ne-?pas-?repondre|mailer-daemon|notifications?)([._-]|@)/i.test(email.fromEmail);
  const correspondent = email.inbound ? email.fromEmail : email.to.split(",")[0]?.trim() ?? "";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 text-sm">
          <div className="font-medium">
            {email.fromName ? `${email.fromName} ` : ""}
            <span className="font-normal text-muted-foreground">&lt;{email.fromEmail}&gt;</span>
          </div>
          <div className="mt-0.5 text-muted-foreground">À : {email.to}</div>
          {email.cc && <div className="text-muted-foreground">Cc : {email.cc}</div>}
          <div className="mt-0.5 text-xs text-muted-foreground">{email.date}</div>
          {email.contact && (
            <Link href={`/contacts/${email.contact.id}`} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
              Contact : {email.contact.name} →
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canReply && (
            <Button size="sm" variant="outline" onClick={() => setReply("manual")}>
              <Reply /> Répondre
            </Button>
          )}
          {canReply && integrations.ai && (
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setReply("ai")}>
              <Sparkles /> Réponse IA
            </Button>
          )}
          {!email.contact && (
            <Button size="sm" onClick={() => setNewContact(true)}>
              <UserPlus /> Créer le contact
            </Button>
          )}
        </div>
      </div>
      {email.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-5 py-2.5">
          {email.attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
              <Paperclip className="size-3" /> {a}
            </span>
          ))}
        </div>
      )}
      <div className="h-[65vh] p-3">
        {html === null ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : (
          <iframe
            title={email.subject}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={`<base target="_blank"><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1f2937;margin:8px}</style>${html}`}
            className="h-full w-full rounded-md bg-white"
          />
        )}
      </div>
      {reply && <EmailComposer open onOpenChange={(o) => !o && setReply(false)} to={email.fromEmail} contactId={email.contact?.id} contactName={email.contact?.name} dealId={email.dealId} replyTo={{ id: email.id, subject: email.subject }} aiReply={reply === "ai"} />}
      {newContact && (
        <ContactDialog
          open
          onOpenChange={setNewContact}
          initial={{ ...emptyContact(me.id), email: correspondent, firstName: email.inbound ? (firstName ?? "") : "", lastName: email.inbound ? rest.join(" ") : "", source: "EMAIL" }}
          onSaved={(c) => router.push(`/contacts/${c.id}?tab=emails`)}
        />
      )}
    </div>
  );
}
