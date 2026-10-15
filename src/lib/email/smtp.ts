import nodemailer from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string | null;
  password?: string | null;
};

export function createSmtpTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
}

/** Envoie un message brut déjà construit (Message-ID maîtrisé). */
export async function smtpSendRaw(cfg: SmtpConfig, raw: Buffer, envelope: { from: string; to: string[] }) {
  const transport = createSmtpTransport(cfg);
  try {
    const info = await transport.sendMail({ envelope, raw });
    if (info.rejected?.length) {
      throw new Error(`Destinataire(s) refusé(s) par le serveur : ${info.rejected.map(String).join(", ")}`);
    }
    return info;
  } finally {
    transport.close();
  }
}

export async function testSmtp(cfg: SmtpConfig): Promise<void> {
  const transport = createSmtpTransport(cfg);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
