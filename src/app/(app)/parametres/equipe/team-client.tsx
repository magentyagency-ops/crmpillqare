"use client";

import { useState } from "react";
import { Copy, Pencil, Send, UserPlus, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { UserAvatar } from "@/components/common/ui-bits";
import { useAction } from "@/hooks/use-action";
import { inviteMemberAction, resendInviteAction, transferPortfolioAction, updateMemberAction } from "@/actions/settings";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/generated/prisma/enums";

type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  receivesLeads: boolean;
  segmentIds: string[];
  hasPassword: boolean;
  google: string | null;
  mailbox: string | null;
  openDeals: number;
  lastLogin: string | null;
  color: string;
};

function LinkDialog({ link, onClose }: { link: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lien d&apos;accès</DialogTitle>
          <DialogDescription>Un email d&apos;invitation a été envoyé si le serveur d&apos;envoi est configuré. Vous pouvez aussi transmettre ce lien (valable 7 jours) :</DialogDescription>
        </DialogHeader>
        <code className="block rounded bg-muted p-2 text-xs break-all">{link}</code>
        <DialogFooter>
          <Button onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Lien copié"))}>
            <Copy /> Copier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamManager({ users, segments, meId, meRole }: { users: Member[]; segments: { id: string; name: string }[]; meId: string; meRole: Role }) {
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [transfer, setTransfer] = useState<Member | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const resend = useAction(resendInviteAction, { onSuccess: (d) => d && setLink(d.link) });
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => setInvite(true)}>
        <UserPlus /> Inviter un membre
      </Button>
      <ul className="divide-y rounded-lg border">
        {users.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center gap-3 px-3 py-3 ${u.active ? "" : "opacity-50"}`}>
            <UserAvatar user={{ firstName: u.name.split(" ")[0] ?? "", lastName: u.name.split(" ").slice(1).join(" "), color: u.color }} size="md" />
            <div className="min-w-48 flex-1">
              <div className="text-sm font-medium">
                {u.name} <span className="ml-1 rounded bg-muted px-1.5 text-[10px]">{ROLE_LABELS[u.role]}</span>
                {!u.active && <span className="ml-1 text-xs text-rose-600">désactivé</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {u.email} · {u.openDeals} dossier(s) en cours · {u.hasPassword ? `dernière connexion ${u.lastLogin ?? "jamais"}` : "invitation en attente"}
              </div>
              <div className="text-xs text-muted-foreground">
                {u.mailbox ? `✉️ ${u.mailbox}` : "✉️ boîte mail non connectée"} · {u.google === "ACTIVE" ? "📅 Google connecté" : "📅 Google non connecté"} · {u.receivesLeads ? "reçoit les leads" : "ne reçoit pas de leads"}
                {u.segmentIds.length > 0 && ` · cibles : ${segments.filter((s) => u.segmentIds.includes(s.id)).map((s) => s.name).join(", ")}`}
              </div>
            </div>
            <div className="flex gap-1">
              {!u.hasPassword && (
                <Button size="xs" variant="outline" disabled={resend.pending} onClick={() => resend.run(u.id)}>
                  <Send /> Renvoyer l&apos;invitation
                </Button>
              )}
              {u.openDeals > 0 && (
                <Button size="xs" variant="outline" onClick={() => setTransfer(u)}>
                  <ArrowRightLeft /> Transférer
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => setEdit(u)}>
                <Pencil /> Modifier
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {invite && <InviteDialog meRole={meRole} onClose={() => setInvite(false)} onLink={setLink} />}
      {edit && <EditDialog member={edit} segments={segments} meId={meId} meRole={meRole} onClose={() => setEdit(null)} />}
      {transfer && <TransferDialog from={transfer} users={users.filter((u) => u.active && u.id !== transfer.id)} onClose={() => setTransfer(null)} />}
      {link && <LinkDialog link={link} onClose={() => setLink(null)} />}
    </div>
  );
}

function InviteDialog({ meRole, onClose, onLink }: { meRole: Role; onClose: () => void; onLink: (l: string) => void }) {
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", role: "SALES" as Role, phone: "", jobTitle: "" });
  const invite = useAction(() => inviteMemberAction(v), {
    onSuccess: (d) => {
      onClose();
      if (d) onLink(d.link);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Inviter un membre</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prénom">
            <Input className="h-9" value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} />
          </FormField>
          <FormField label="Nom">
            <Input className="h-9" value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} />
          </FormField>
          <FormField label="Email professionnel" className="col-span-2">
            <Input className="h-9" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </FormField>
          <FormField label="Rôle">
            <SelectField
              value={v.role}
              onChange={(r) => setV({ ...v, role: r as Role })}
              options={[
                { value: "SALES", label: "Commercial" },
                { value: "MANAGER", label: "Manager" },
                ...(meRole === "ADMIN" ? [{ value: "ADMIN", label: "Administrateur" }] : []),
              ]}
            />
          </FormField>
          <FormField label="Téléphone">
            <Input className="h-9" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          </FormField>
          <FormField label="Fonction" className="col-span-2">
            <Input className="h-9" value={v.jobTitle} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={invite.pending || !v.email || !v.firstName || !v.lastName} onClick={() => invite.run()}>
            {invite.pending && <Spinner />} Inviter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ member, segments, meId, meRole, onClose }: { member: Member; segments: { id: string; name: string }[]; meId: string; meRole: Role; onClose: () => void }) {
  const [v, setV] = useState({ role: member.role, active: member.active, receivesLeads: member.receivesLeads, segmentIds: member.segmentIds });
  const save = useAction(() => updateMemberAction(member.id, v), { onSuccess: onClose });
  const self = member.id === meId;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Rôle">
            <SelectField
              value={v.role}
              disabled={self || (member.role === "ADMIN" && meRole !== "ADMIN")}
              onChange={(r) => setV({ ...v, role: r as Role })}
              options={[
                { value: "SALES", label: "Commercial — ses dossiers et son planning" },
                { value: "MANAGER", label: "Manager — toute l'équipe, tableaux de bord, réglages commerciaux" },
                ...(meRole === "ADMIN" ? [{ value: "ADMIN", label: "Administrateur — tout, y compris intégrations" }] : []),
              ]}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.receivesLeads} onCheckedChange={(c) => setV({ ...v, receivesLeads: c })} /> Reçoit les nouveaux leads (formulaire, Shopify, emails entrants)
          </label>
          <div>
            <div className="mb-1.5 text-xs font-medium">Cibles prises en charge (attribution « par cible »)</div>
            <div className="flex flex-wrap gap-2">
              {segments.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  <Checkbox checked={v.segmentIds.includes(s.id)} onCheckedChange={(c) => setV({ ...v, segmentIds: c ? [...v.segmentIds, s.id] : v.segmentIds.filter((x) => x !== s.id) })} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.active} disabled={self} onCheckedChange={(c) => setV({ ...v, active: c })} /> Compte actif
          </label>
          {!v.active && <p className="text-xs text-amber-700">Le compte sera déconnecté. Pensez à transférer ses dossiers.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={save.pending} onClick={() => save.run()}>
            {save.pending && <Spinner />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ from, users, onClose }: { from: Member; users: Member[]; onClose: () => void }) {
  const [to, setTo] = useState("");
  const transfer = useAction(() => transferPortfolioAction(from.id, to), { success: false, onSuccess: (d) => { toast.success(`${d?.deals ?? 0} dossier(s) transféré(s)`); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transférer le portefeuille de {from.name}</DialogTitle>
          <DialogDescription>Dossiers en cours, contacts, organisations, tâches ouvertes et relances automatiques.</DialogDescription>
        </DialogHeader>
        <SelectField value={to} onChange={setTo} placeholder="Choisir le destinataire…" options={users.map((u) => ({ value: u.id, label: u.name }))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!to || transfer.pending} onClick={() => transfer.run()}>
            {transfer.pending && <Spinner />} Transférer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
