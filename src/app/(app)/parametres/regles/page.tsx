import { requireRole, isAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { RulesForms } from "./rules-client";

export const metadata = { title: "Règles commerciales" };

export default async function RulesPage() {
  const user = await requireRole("ADMIN", "MANAGER");
  const [pipeline, followups, meetings, digest, visibility, assignment, shopify, ai, users] = await Promise.all([
    getSettings("pipeline"),
    getSettings("followups"),
    getSettings("meetings"),
    getSettings("digest"),
    getSettings("visibility"),
    getSettings("assignment"),
    getSettings("shopify"),
    getSettings("ai"),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } }),
  ]);
  return <RulesForms admin={isAdmin(user)} users={users} initial={{ pipeline, followups, meetings, digest, visibility, assignment, shopify, ai }} />;
}
