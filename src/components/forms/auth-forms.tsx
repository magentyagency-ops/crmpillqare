"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  loginAction,
  requestPasswordResetAction,
  resetPasswordAction,
  setupAction,
  type FormState,
} from "@/actions/auth";

function Feedback({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  if (state.success)
    return (
      <Alert>
        <AlertDescription>{state.success}</AlertDescription>
      </Alert>
    );
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function LoginForm({ next, autoFocus = true }: { next?: string; autoFocus?: boolean }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus={autoFocus} />
      </Field>
      <Field label="Mot de passe">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Feedback state={state} />
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending && <Spinner />} Se connecter
      </Button>
      <div className="text-center text-sm">
        <Link href="/mot-de-passe-oublie" className="text-muted-foreground hover:text-foreground hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prénom">
          <Input name="firstName" required autoFocus />
        </Field>
        <Field label="Nom">
          <Input name="lastName" required />
        </Field>
      </div>
      <Field label="Email professionnel">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Mot de passe (10 caractères min., lettres et chiffres)">
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <Feedback state={state} />
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending && <Spinner />} Créer le compte administrateur
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <Input name="email" type="email" required autoFocus />
      </Field>
      <Feedback state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />} Recevoir un lien de réinitialisation
      </Button>
      <div className="text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:underline">
          Retour à la connexion
        </Link>
      </div>
    </form>
  );
}

export function ResetPasswordForm({ token, invite }: { token: string; invite: boolean }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label={invite ? "Choisissez votre mot de passe" : "Nouveau mot de passe"}>
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Confirmation">
        <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <p className="text-xs text-muted-foreground">10 caractères minimum, avec au moins une lettre et un chiffre.</p>
      <Feedback state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />} {invite ? "Activer mon compte" : "Enregistrer"}
      </Button>
    </form>
  );
}
