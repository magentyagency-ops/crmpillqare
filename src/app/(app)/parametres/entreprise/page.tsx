import { requireRole } from "@/lib/auth/guards";
import { getSettings } from "@/lib/settings";
import { CompanyForms } from "./company-client";

export const metadata = { title: "Entreprise et devis" };

export default async function CompanyPage() {
  await requireRole("ADMIN");
  const [company, quotes] = await Promise.all([getSettings("company"), getSettings("quotes")]);
  return <CompanyForms company={company} quotes={quotes} />;
}
