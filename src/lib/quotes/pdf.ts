import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { toNumber } from "@/lib/format";
import { contactDisplayName } from "@/lib/labels";
import { getSettings } from "@/lib/settings";
import { computeQuoteTotals } from "./totals";

const NAVY = rgb(0x12 / 255, 0x29 / 255, 0x5a / 255);
const GREY = rgb(0.38, 0.42, 0.48);
const LIGHT = rgb(0.95, 0.96, 0.97);
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

/** Les polices standard PDF utilisent WinAnsi : on remplace les caractères non encodables. */
function sanitize(text: string): string {
  return text
    .replace(/[   ]/g, " ")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff€Œœ]/g, "");
}

function money(v: number): string {
  return sanitize(new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v));
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of sanitize(text).split(/\n/)) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        if (line) out.push(line);
        // mot plus long que la largeur : découpe brute
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** Génère le PDF d'un devis (A4, multi-pages). */
export async function generateQuotePdf(quoteId: string): Promise<Buffer> {
  const quote = await db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      items: { orderBy: { position: "asc" } },
      contact: true,
      company: true,
      owner: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  });
  const company = await getSettings("company");
  const quoteSettings = await getSettings("quotes");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Devis ${quote.number}`);
  pdf.setAuthor(company.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;

  const text = (t: string, x: number, yy: number, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(sanitize(t), { x, y: yy, size: opts.size ?? 9.5, font: opts.font ?? font, color: opts.color ?? rgb(0.1, 0.12, 0.16) });
  const textRight = (t: string, xRight: number, yy: number, opts: { size?: number; font?: PDFFont } = {}) => {
    const s = sanitize(t);
    const f = opts.font ?? font;
    const size = opts.size ?? 9.5;
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color: rgb(0.1, 0.12, 0.16) });
  };

  // En-tête société
  text(company.name || "PillQare", MARGIN, y, { size: 20, font: bold, color: NAVY });
  textRight("DEVIS", A4[0] - MARGIN, y, { size: 20, font: bold });
  y -= 18;
  const companyLines = [
    company.legalName && company.legalName !== company.name ? company.legalName : null,
    company.address,
    [company.postalCode, company.city].filter(Boolean).join(" "),
    company.phone ? `Tél. ${company.phone}` : null,
    company.email,
    company.website,
  ].filter((l): l is string => Boolean(l && l.trim()));
  const metaLines = [
    `N° ${quote.number}`,
    `Date : ${formatDate(quote.issueDate, "dd/MM/yyyy")}`,
    `Valable jusqu'au : ${formatDate(quote.validUntil, "dd/MM/yyyy")}`,
    `Contact : ${quote.owner.firstName} ${quote.owner.lastName}`,
  ];
  for (let i = 0; i < Math.max(companyLines.length, metaLines.length); i++) {
    if (companyLines[i]) text(companyLines[i]!, MARGIN, y, { color: GREY });
    if (metaLines[i]) textRight(metaLines[i]!, A4[0] - MARGIN, y, { font: i === 0 ? bold : font });
    y -= 13;
  }

  // Bloc client
  y -= 12;
  const clientX = A4[0] / 2 + 10;
  const clientLines = [
    quote.company?.name,
    contactDisplayName(quote.contact),
    quote.company?.address ?? quote.contact.address,
    [quote.company?.postalCode ?? quote.contact.postalCode, quote.company?.city ?? quote.contact.city].filter(Boolean).join(" "),
    quote.contact.email,
    quote.contact.phone,
  ].filter((l): l is string => Boolean(l && l.trim()));
  const boxHeight = 22 + clientLines.length * 13;
  page.drawRectangle({ x: clientX - 10, y: y - boxHeight + 12, width: A4[0] - MARGIN - clientX + 10, height: boxHeight, color: LIGHT });
  text("Destinataire", clientX, y, { size: 8, color: GREY });
  y -= 14;
  clientLines.forEach((l, i) => {
    text(l, clientX, y, { font: i === 0 ? bold : font });
    y -= 13;
  });
  if (quote.title) {
    y -= 6;
    text(`Objet : ${quote.title}`, MARGIN, y, { font: bold, size: 10.5 });
  }
  y -= 22;

  // Tableau des lignes
  const cols = [
    { label: "Désignation", x: MARGIN, w: 220, align: "left" as const },
    { label: "Qté", x: MARGIN + 225, w: 40, align: "right" as const },
    { label: "PU HT", x: MARGIN + 270, w: 65, align: "right" as const },
    { label: "Remise", x: MARGIN + 340, w: 45, align: "right" as const },
    { label: "TVA", x: MARGIN + 390, w: 40, align: "right" as const },
    { label: "Total HT", x: MARGIN + 435, w: width - 435, align: "right" as const },
  ];
  const drawHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 6, width, height: 20, color: NAVY });
    for (const c of cols) {
      if (c.align === "left") page.drawText(sanitize(c.label), { x: c.x + 6, y: y, size: 9, font: bold, color: rgb(1, 1, 1) });
      else {
        const s = sanitize(c.label);
        page.drawText(s, { x: c.x + c.w - bold.widthOfTextAtSize(s, 9) - 4, y, size: 9, font: bold, color: rgb(1, 1, 1) });
      }
    }
    y -= 24;
  };
  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
  };
  drawHeader();

  const totals = computeQuoteTotals(
    quote.items.map((i) => ({ quantity: toNumber(i.quantity), unitPriceHT: toNumber(i.unitPriceHT), discountPct: toNumber(i.discountPct), vatRate: toNumber(i.vatRate) })),
    toNumber(quote.globalDiscountPct),
  );

  quote.items.forEach((item, idx) => {
    const nameLines = wrap(item.name, bold, 9.5, cols[0]!.w - 8);
    const descLines = item.description ? wrap(item.description, font, 8.5, cols[0]!.w - 8) : [];
    const rowHeight = nameLines.length * 12 + descLines.length * 10.5 + 8;
    if (y - rowHeight < MARGIN + 60) {
      newPage();
      drawHeader();
    }
    if (idx % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - rowHeight + 10, width, height: rowHeight, color: rgb(0.985, 0.987, 0.99) });
    let ly = y;
    nameLines.forEach((l) => {
      text(l, MARGIN + 6, ly, { font: bold });
      ly -= 12;
    });
    descLines.forEach((l) => {
      text(l, MARGIN + 6, ly, { size: 8.5, color: GREY });
      ly -= 10.5;
    });
    const qty = toNumber(item.quantity);
    const values = [
      `${Number.isInteger(qty) ? qty : qty.toFixed(2).replace(".", ",")} ${item.unit === "unité" ? "" : item.unit}`.trim(),
      money(toNumber(item.unitPriceHT)),
      toNumber(item.discountPct) ? `${toNumber(item.discountPct)} %` : "-",
      `${toNumber(item.vatRate)} %`,
      money(totals.lineTotals[idx] ?? 0),
    ];
    values.forEach((v, i) => {
      const c = cols[i + 1]!;
      textRight(v, c.x + c.w - 4, y);
    });
    y -= rowHeight;
  });

  // Totaux
  if (y < MARGIN + 160) newPage();
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: A4[0] - MARGIN, y: y + 6 }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) });
  const totalsX = A4[0] - MARGIN - 220;
  const totalRow = (label: string, value: string, strong = false) => {
    text(label, totalsX, y, { font: strong ? bold : font, size: strong ? 11 : 9.5 });
    textRight(value, A4[0] - MARGIN, y, { font: strong ? bold : font, size: strong ? 11 : 9.5 });
    y -= strong ? 18 : 14;
  };
  y -= 10;
  totalRow("Sous-total HT", money(totals.subtotalHT));
  if (totals.discountHT > 0) totalRow(`Remise globale (${toNumber(quote.globalDiscountPct)} %)`, `- ${money(totals.discountHT)}`);
  totalRow("Total HT", money(totals.totalHT));
  for (const v of totals.vat) totalRow(`TVA ${v.rate} % (base ${money(v.base)})`, money(v.amount));
  y -= 6; // espace avant le bandeau du total (ne doit pas recouvrir la dernière ligne de TVA)
  page.drawRectangle({ x: totalsX - 8, y: y - 6, width: 220 + 8, height: 22, color: LIGHT });
  totalRow("Total TTC", money(totals.totalTTC), true);

  // Notes, conditions, bon pour accord
  const blocks: { title: string; body: string }[] = [];
  if (quote.notes) blocks.push({ title: "Remarques", body: quote.notes });
  const terms = quote.terms ?? quoteSettings.defaultTerms;
  if (terms) blocks.push({ title: "Conditions", body: terms });
  if (company.iban) blocks.push({ title: "Règlement", body: `Virement : IBAN ${company.iban}${company.bic ? ` — BIC ${company.bic}` : ""}` });
  y -= 12;
  for (const b of blocks) {
    const lines = wrap(b.body, font, 8.5, width);
    if (y - 14 - lines.length * 11 < MARGIN + 40) newPage();
    text(b.title, MARGIN, y, { font: bold, size: 9.5 });
    y -= 13;
    lines.forEach((l) => {
      text(l, MARGIN, y, { size: 8.5, color: GREY });
      y -= 11;
    });
    y -= 8;
  }
  if (y < MARGIN + 90) newPage();
  y -= 6;
  if (quote.status === "ACCEPTED" && quote.acceptedAt) {
    // Preuve de l'acceptation en ligne
    const green = rgb(0.06, 0.47, 0.3);
    page.drawRectangle({ x: A4[0] - MARGIN - 220, y: y - 70, width: 220, height: 78, color: rgb(0.93, 0.98, 0.95), borderColor: green, borderWidth: 0.8 });
    text("Bon pour accord - accepté en ligne", A4[0] - MARGIN - 212, y - 6, { font: bold, size: 9, color: green });
    text(`Le ${formatDate(quote.acceptedAt, "dd/MM/yyyy 'à' HH:mm")} (heure de Paris)`, A4[0] - MARGIN - 212, y - 22, { size: 8.5 });
    if (quote.acceptedByName) text(`Par : ${quote.acceptedByName}`, A4[0] - MARGIN - 212, y - 35, { size: 8.5 });
    if (quote.acceptedIp) text(`Adresse IP : ${quote.acceptedIp}`, A4[0] - MARGIN - 212, y - 48, { size: 8, color: GREY });
  } else {
    page.drawRectangle({ x: A4[0] - MARGIN - 220, y: y - 70, width: 220, height: 78, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 0.8 });
    text("Bon pour accord", A4[0] - MARGIN - 212, y - 6, { font: bold, size: 9 });
    text("Date, nom et signature :", A4[0] - MARGIN - 212, y - 20, { size: 8.5, color: GREY });
    if (quote.status !== "REFUSED" && quote.status !== "EXPIRED") {
      text("Acceptation en ligne possible via le lien reçu par email.", MARGIN, y - 6, { size: 8, color: GREY });
    }
  }

  // Pied de page
  const pages = pdf.getPages();
  const legal = [company.legalName || company.name, company.siret ? `SIRET ${company.siret}` : null, company.vatNumber ? `TVA ${company.vatNumber}` : null, quoteSettings.footer || null]
    .filter(Boolean)
    .join(" - ");
  pages.forEach((p, i) => {
    const footer = sanitize(legal);
    p.drawText(footer, { x: MARGIN, y: 24, size: 7.5, font, color: GREY });
    const num = `Page ${i + 1} / ${pages.length}`;
    p.drawText(num, { x: A4[0] - MARGIN - font.widthOfTextAtSize(num, 7.5), y: 24, size: 7.5, font, color: GREY });
  });

  return Buffer.from(await pdf.save());
}
