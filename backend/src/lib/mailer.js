import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

import env from '../config/env.js';
import { EMAIL_LOGO_CID } from './email-templates.js';

const requiredConfig = ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom'];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const emailLogoPath = path.resolve(__dirname, '../../assets/Logo/LOGO_BRANCA.png');

export function getMissingMailerConfig() {
  return requiredConfig.filter(key => !env[key]);
}

export function assertMailerConfigured() {
  const missing = getMissingMailerConfig();
  if (!missing.length) return;
  throw new Error(`Configuração SMTP ausente: ${missing.join(', ')}`);
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
  const attachments = Array.isArray(message.attachments) ? message.attachments.slice() : [];
  if (fs.existsSync(emailLogoPath) && !attachments.some(item => item && item.cid === EMAIL_LOGO_CID)) {
    attachments.push({
      filename: 'LOGO_BRANCA.png',
      path: emailLogoPath,
      cid: EMAIL_LOGO_CID
    });
  }
  return transporter.sendMail({
    from: env.smtpFrom,
    ...message,
    attachments
  });
}
