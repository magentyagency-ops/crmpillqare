import { ForgotPasswordForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Mot de passe oublié</h1>
      <p className="mb-6 text-sm text-muted-foreground">Indiquez votre email : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <ForgotPasswordForm />
    </>
  );
}
