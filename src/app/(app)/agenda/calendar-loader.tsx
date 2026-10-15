"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { GoogleStatus } from "@/components/calendar/crm-calendar";

const CrmCalendar = dynamic(() => import("@/components/calendar/crm-calendar").then((m) => m.CrmCalendar), {
  ssr: false,
  loading: () => <Skeleton className="h-[calc(100dvh-7.75rem)] min-h-[560px] w-full rounded-2xl" />,
});

export function CalendarLoader({ google }: { google: GoogleStatus }) {
  return <CrmCalendar google={google} />;
}
