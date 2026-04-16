import nodemailer from 'nodemailer';

import env from '../config/env.js';

const requiredConfig = ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom'];

export function getMissingMailerConfig() {
  return requiredConfig.filter(key => !env[key]);
}

export function assertMailerConfigured() {
  const missing = getMissingMailerConfig();
  if (!missing.length) return;
  throw new Error(`Configuracao SMTP ausente: ${missing.join(', ')}`);
}

export function createMailerTransport() {
  assertMailerConfigured();

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

export async function verifyMailer() {
  const transporter = createMailerTransport();
  await transporter.verify();
  return transporter;
}

export async function sendMail(message) {
  const transporter = createMailerTransport();
  return transporter.sendMail({
    from: env.smtpFrom,
    ...message
  });
}
