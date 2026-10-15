"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { changePasswordAction, sendTestDigestAction, updateProfileAction } from "@/actions/settings";

type Profile = { firstName: string; lastName: string; phone: string; jobTitle: string; color: string; signature: string; timezone: string; dailyDigest: boolean; syncTasksToCalendar: boolean };

export function ProfileForm({ initial }: { initial: Profile }) {
  const [v, setV] = useState(initial);
  const save = useAction(() => updateProfileAction(v));
  const digest = useAction(sendTestDigestAction);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.run();
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Prénom">
          <Input className="h-9" value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} />
        </FormField>
        <FormField label="Nom">
          <Input className="h-9" value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} />
        </FormField>
        <FormField label="Téléphone">
          <Input className="h-9" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </FormField>
        <FormField label="Fonction">
          <Input className="h-9" value={v.jobTitle} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} />
        </FormField>
        <FormField label="Fuseau horaire">
          <SelectField
            value={v.timezone}
            onChange={(x) => setV({ ...v, timezone: x })}
            options={["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "America/Montreal", "Indian/Reunion", "America/Martinique", "America/Guadeloupe", "Pacific/Noumea"].map((t) => ({ value: t, label: t }))}
          />
        </FormField>
        <FormField label="Couleur (avatar, agenda)">
          <Input className="h-9 w-24 p-1" type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} />
        </FormField>
      </div>
      <FormField label="Signature des emails" hint="Ajoutée automatiquement à vos emails, relances et confirmations.">
        <Textarea rows={4} value={v.signature} onChange={(e) => setV({ ...v, signature: e.target.value })} />
      </FormField>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={v.dailyDigest} onCheckedChange={(c) => setV({ ...v, dailyDigest: Boolean(c) })} /> Recevoir chaque matin mon planning de la journée par email
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={v.syncTasksToCalendar} onCheckedChange={(c) => setV({ ...v, syncTasksToCalendar: Boolean(c) })} /> Afficher mes appels et tâches planifiés dans Google Agenda
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.pending}>
          {save.pending && <Spinner />} Enregistrer
        </Button>
        <Button type="button" variant="outline" disabled={digest.pending} onClick={() => digest.run()}>
          {digest.pending && <Spinner />} M&apos;envoyer mon planning du jour maintenant
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = useAction(() => changePasswordAction(current, next), {
    onSuccess: () => {
      setCurrent("");
      setNext("");
    },
  });
  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save.run();
      }}
    >
      <FormField label="Mot de passe actuel">
        <Input className="h-9" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </FormField>
      <FormField label="Nouveau mot de passe">
        <Input className="h-9" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} />
      </FormField>
      <Button type="submit" disabled={save.pending || !current || next.length < 10}>
        Modifier
      </Button>
    </form>
  );
}
