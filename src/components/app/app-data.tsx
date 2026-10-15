"use client";

import { createContext, useContext } from "react";
import type { ContactKind, Role } from "@/generated/prisma/enums";

export type AppUser = { id: string; firstName: string; lastName: string; role: Role; color: string; email: string };
export type AppSegment = { id: string; name: string; kind: ContactKind; color: string };
export type AppLostReason = { id: string; label: string };

export type AppData = {
  me: AppUser & { timezone: string; bookingSlug: string };
  users: AppUser[];
  segments: AppSegment[];
  lostReasons: AppLostReason[];
  integrations: { google: boolean; mailbox: boolean; ai: boolean; transcription: boolean };
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ value, children }: { value: AppData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData doit être utilisé dans l'application.");
  return v;
}

export function isManagerRole(role: Role) {
  return role === "ADMIN" || role === "MANAGER";
}
