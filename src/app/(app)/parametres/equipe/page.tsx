import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { formatRelative } from "@/lib/dates";
import { SectionCard } from "@/components/common/ui-bits";
import { TeamManager } from "./team-client";

export const metadata = { title: "Équipe" };

export default async function TeamPage() {
  const me = await requireRole("ADMIN", "MANAGER");
  const [users, segments] = await Promise.all([
    db.user.findMany({
      orderBy: [{ active: "desc" }, { firstName: "asc" }],
      include: {
        segments: { select: { segmentId: true } },
        googleAccount: { select: { status: true } },
        mailboxes: { select: { email: true, status: true } },
        _count: { select: { deals: { where: { stage: { notIn: ["WON", "LOST"] } } } } },
      },
    }),
    db.segment.findMany({ where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <SectionCard title="Équipe" description="Commerciaux, managers et administrateurs. Les leads entrants sont répartis entre les personnes qui « reçoivent des leads » (tour de rôle ou par cible).">
      <TeamManager
        meId={me.id}
        meRole={me.role}
        segments={segments}
        users={users.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          role: u.role,
          active: u.active,
          receivesLeads: u.receivesLeads,
          segmentIds: u.segments.map((s) => s.segmentId),
          hasPassword: Boolean(u.passwordHash),
          google: u.googleAccount?.status ?? null,
          mailbox: u.mailboxes[0]?.email ?? null,
          openDeals: u._count.deals,
          lastLogin: u.lastLoginAt ? formatRelative(u.lastLoginAt) : null,
          color: u.color,
        }))}
      />
    </SectionCard>
  );
}
