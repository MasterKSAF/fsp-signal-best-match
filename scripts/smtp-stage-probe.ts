import { randomInt } from 'node:crypto';
import { sendVerificationEmail, resolveSmtpTransport } from '../artifacts/api-server/src/lib/signal-mail';
import nodemailer from '../artifacts/api-server/node_modules/nodemailer/dist/esm/nodemailer.js';
const environment = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1031', SMTP_LOCAL_TEST: 'true', MAIL_FROM: 'no-reply@example.test', DEMO_MODE: 'true' };
try {
  if (!resolveSmtpTransport(environment)) throw new Error('Local SMTP configuration invalid');
  const client = nodemailer.createTransport(resolveSmtpTransport(environment)!.options);
  try { await client.verify(); } finally { client.close(); }
  await sendVerificationEmail({ to: 'synthetic-smtp-probe@example.test', code: String(randomInt(100000, 1000000)), publicUrl: 'http://127.0.0.1:4314' }, environment);
  console.log(JSON.stringify({ localSmtp: 'PASS' }));
} catch(error) { console.log(JSON.stringify({ localSmtp: 'FAIL', name: (error as any).name, code: (error as any).code, command: (error as any).command, message: (error as any).message })); process.exitCode = 1; }
