import { describe, expect, it, vi } from "vitest";
import { buildIcs } from "@/lib/email/ics";
import { parseRawMessage, stripQuotedReply } from "@/lib/email/parse";
import { decrypt, encrypt, hmacSha256Base64, safeEqual, signState, verifyState } from "@/lib/crypto";
import { verifyShopifyWebhook } from "@/lib/shopify/client";

describe("invitation calendrier (.ics)", () => {
  const base = {
    uid: "rdv-1@pillqare-crm",
    start: new Date("2026-10-08T07:30:00Z"),
    end: new Date("2026-10-08T08:00:00Z"),
    summary: "Échange avec PillQare; démo, pilote",
    organizer: { email: "julie@pillqare.com", name: "Julie Martin" },
    attendees: [{ email: "paul@pharmacie.fr", name: "Paul Mercier" }],
  };

  it("produit un événement valide en UTC avec texte échappé", () => {
    const ics = buildIcs({ ...base, description: "Ligne 1\nLigne 2" });
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("DTSTART:20261008T073000Z");
    expect(ics).toContain("SUMMARY:Échange avec PillQare\\; démo\\, pilote");
    expect(ics).toContain("DESCRIPTION:Ligne 1\\nLigne 2");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it("annulation : même UID, METHOD:CANCEL et séquence supérieure", () => {
    const ics = buildIcs({ ...base, method: "CANCEL", cancelled: true, sequence: 7 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("UID:rdv-1@pillqare-crm");
    expect(ics).toContain("SEQUENCE:7");
    expect(ics).toContain("STATUS:CANCELLED");
  });
});

describe("emails entrants", () => {
  const mime = (headers: string, body: string) => `${headers}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;

  it("réponse d'un prospect : fil de discussion et citation retirée", async () => {
    const msg = await parseRawMessage(
      mime(
        "From: Hélène Garnier <H.Garnier@ssiad-loire.fr>\r\nTo: thomas@pillqare.com\r\nSubject: Re: Votre demande\r\nMessage-ID: <abc@ssiad>\r\nIn-Reply-To: <orig@pillqare>\r\nReferences: <orig@pillqare>\r\nDate: Wed, 07 Oct 2026 19:00:00 +0000",
        "Oui, jeudi me convient.\r\n\r\nLe mer. 7 oct. 2026 à 20:30, Thomas a écrit :\r\n> Merci pour votre intérêt",
      ),
    );
    expect(msg.from.email).toBe("h.garnier@ssiad-loire.fr");
    expect(msg.inReplyTo).toBe("<orig@pillqare>");
    expect(msg.references).toEqual(["<orig@pillqare>"]);
    expect(msg.isAutoReply).toBe(false);
    expect(msg.isBounce).toBe(false);
    expect(stripQuotedReply(msg.text)).toBe("Oui, jeudi me convient.");
  });

  it("réponse automatique (absence) : ne compte pas comme une réponse", async () => {
    const msg = await parseRawMessage(mime("From: a@b.fr\r\nTo: c@d.fr\r\nSubject: Absence du bureau\r\nAuto-Submitted: auto-replied\r\nMessage-ID: <x@b>", "Je suis absente."));
    expect(msg.isAutoReply).toBe(true);
  });

  it("rebond : destinataire en échec identifié", async () => {
    const msg = await parseRawMessage(
      mime("From: MAILER-DAEMON@mx.example.com\r\nTo: julie@pillqare.com\r\nSubject: Undelivered Mail Returned to Sender\r\nX-Failed-Recipients: inconnu@pharmacie.fr\r\nMessage-ID: <b@mx>", "Delivery failed."),
    );
    expect(msg.isBounce).toBe(true);
    expect(msg.bouncedRecipient).toBe("inconnu@pharmacie.fr");
  });

  it("citation Gmail sur deux lignes et Outlook", () => {
    expect(stripQuotedReply("Merci !\n\nLe mer. 7 oct. 2026 à 20:30, Julie Martin <\njulie@pillqare.com> a écrit :\n> texte")).toBe("Merci !");
    expect(stripQuotedReply("D'accord.\n\nDe : Julie Martin\nEnvoyé : mercredi\nObjet : devis")).toBe("D'accord.");
  });
});

describe("sécurité", () => {
  it("chiffre et déchiffre les secrets (AES-256-GCM), refuse une altération", () => {
    const c = encrypt("mot-de-passe-imap");
    expect(c.startsWith("v1:")).toBe(true);
    expect(decrypt(c)).toBe("mot-de-passe-imap");
    const parts = c.split(":");
    parts[3] = Buffer.from("autre chose").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("état OAuth signé : altération et expiration détectées", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
      const state = signState({ userId: "u1" });
      expect(verifyState<{ userId: string }>(state)?.userId).toBe("u1");
      expect(verifyState(state.slice(0, -2) + "xx")).toBeNull();
      vi.setSystemTime(new Date("2026-10-07T10:20:00Z"));
      expect(verifyState(state, 15 * 60_000)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("vérifie la signature HMAC des webhooks Shopify", () => {
    const body = JSON.stringify({ id: 1 });
    const sig = hmacSha256Base64("secret", body);
    expect(verifyShopifyWebhook(body, sig, ["autre", "secret"])).toBe(true);
    expect(verifyShopifyWebhook(body + " ", sig, ["secret"])).toBe(false);
    expect(verifyShopifyWebhook(body, null, ["secret"])).toBe(false);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});
