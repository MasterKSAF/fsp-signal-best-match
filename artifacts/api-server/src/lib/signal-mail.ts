const defaultFrom = "no-reply@fsp-signal.local";
const mailTimeoutMs = 5_000;
import nodemailer from 'nodemailer';

export function resolveSmtpTransport(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.MAIL_TRANSPORT !== 'smtp') return null;
  const host = environment.SMTP_HOST?.trim();
  const port = Number(environment.SMTP_PORT || '587');
  const from = environment.MAIL_FROM?.trim();
  const user = environment.SMTP_USER?.trim(), pass = environment.SMTP_PASSWORD;
  if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !from || !validMailAddress(from) || from.endsWith('.local')) return null;
  const localTest = environment.SMTP_LOCAL_TEST === 'true' && environment.DEMO_MODE === 'true' && ['localhost', '127.0.0.1', '::1'].includes(host);
  if (!localTest && (!user || !pass)) return null;
  const secure = port === 465;
  return { from, options: { host, port, secure, requireTLS: !secure && !localTest, ignoreTLS: localTest,
    ...(user && pass ? { auth: { user, pass } } : {}),
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    connectionTimeout: mailTimeoutMs, greetingTimeout: mailTimeoutMs, socketTimeout: mailTimeoutMs,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  } };
}

export type MailTransport = {
  endpoint: string;
  from: string;
};

export type VerificationMail = {
  to: string;
  code: string;
  publicUrl?: string;
};

function validMailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Mailpit v1 accepts messages at /api/v1/send.  MAILPIT_URL is deliberately
 * configuration-only; no user-controlled URL reaches fetch().
 */
export function resolveMailTransport(
  environment: NodeJS.ProcessEnv = process.env,
): MailTransport | null {
  const rawBaseUrl = environment.MAILPIT_URL;
  if (!rawBaseUrl) return null;

  try {
    const baseUrl = new URL(rawBaseUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") return null;
    const from = environment.MAIL_FROM?.trim() || defaultFrom;
    if (!validMailAddress(from)) return null;
    return {
      endpoint: new URL("/api/v1/send", baseUrl).toString(),
      from,
    };
  } catch {
    return null;
  }
}

export function isMailTransportConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.MAIL_TRANSPORT === 'smtp' ? resolveSmtpTransport(environment) !== null : resolveMailTransport(environment) !== null;
}

export async function sendVerificationEmail(
  message: VerificationMail,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const smtp = resolveSmtpTransport(environment);
  const transport = environment.MAIL_TRANSPORT === 'smtp' ? smtp : resolveMailTransport(environment);
  if (!transport) throw new Error("Verification mail transport is not configured");
  if (!validMailAddress(message.to) || !/^\d{6}$/.test(message.code)) {
    throw new Error("Invalid verification mail payload");
  }

  const publicUrl = message.publicUrl?.replace(/[\r\n]/g, "");
  const text = [
    "Код подтверждения Signal:",
    message.code,
    "",
    "Код действует 30 минут. Если вы не регистрировались, просто проигнорируйте это письмо.",
    publicUrl ? `Сервис: ${publicUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (smtp) {
    const client = nodemailer.createTransport(smtp.options);
    try {
      const result = await client.sendMail({ from: { name: 'Signal', address: smtp.from }, to: message.to, subject: 'Код подтверждения Signal', text });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP recipient rejected');
    } finally { client.close(); }
    return;
  }

  if (!('endpoint' in transport)) throw new Error('Invalid mail transport');
  const response = await fetch(transport.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: transport.from, Name: "Signal" },
      To: [{ Email: message.to }],
      Subject: "Код подтверждения Signal",
      Text: text,
    }),
    signal: AbortSignal.timeout(mailTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Verification mail delivery failed with HTTP ${response.status}`);
  }
}
