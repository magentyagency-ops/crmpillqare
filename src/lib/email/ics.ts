/** Génération de fichiers iCalendar (.ics) pour les confirmations de RDV. */

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliage des lignes à 75 octets (RFC 5545) */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    if (currentBytes + len > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += len;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(input: {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  organizer: { email: string; name?: string | null };
  attendees?: { email: string; name?: string | null }[];
  method?: "PUBLISH" | "REQUEST" | "CANCEL";
  sequence?: number;
  cancelled?: boolean;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PillQare//CRM//FR",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method ?? "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(input.start)}`,
    `DTEND:${icsDate(input.end)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    input.description ? `DESCRIPTION:${escapeText(input.description)}` : null,
    input.location ? `LOCATION:${escapeText(input.location)}` : null,
    input.url ? `URL:${input.url}` : null,
    `ORGANIZER;CN=${escapeText(input.organizer.name ?? input.organizer.email)}:mailto:${input.organizer.email}`,
    ...(input.attendees ?? []).map(
      (a) => `ATTENDEE;CN=${escapeText(a.name ?? a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${a.email}`,
    ),
    `SEQUENCE:${input.sequence ?? 0}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Rappel",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(fold).join("\r\n") + "\r\n";
}
