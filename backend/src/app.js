import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';

import env from './config/env.js';
import asyncHandler from './lib/async-handler.js';
import { resolvePublicCalibrationCertificate } from './lib/calibration-certificates.js';
import { equipmentAttachmentFileName, inlineContentDisposition, resolvePublicEquipmentAttachment } from './lib/equipment-attachments.js';
import { localizedZodErrorDetails, localizedZodIssues } from './lib/zod-error.js';
import { requireAuth } from './middleware/auth.js';
import { requestMetrics } from './middleware/request-metrics.js';
import apiRouter from './routes/index.js';
import {
  authorizeStoredFile,
  normalizeRelativeUploadPath,
  resolveStoredFilePath
} from './routes/resources/uploads.js';

const app = express();
const allowedOrigins = String(env.allowedOrigin || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

fs.mkdirSync(env.assetsDir, { recursive: true });
fs.mkdirSync(env.reportsDir, { recursive: true });

app.set('trust proxy', env.trustProxy);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    const allowedOrigins = env.allowedOrigins || [];
    const originAllowed = !allowedOrigins.length || allowedOrigins.includes(origin);
    if (!origin || originAllowed) {
      callback(null, true);
      return;
    }
    callback(new Error('Origem nao permitida pelo CORS.'));
  },
  exposedHeaders: ['Content-Disposition']
}));
app.use((req, res, next) => {
  const isUploadsApi = req.path.startsWith('/api/uploads') || req.path.startsWith('/api/rdo/uploads');
  // Endpoints que recebem PDFs/anexos em base64 no corpo (até MAX_PDF_BYTES = 20MB).
  const isEquipmentUploadApi = [
    '/api/manometers',
    '/api/rdo/manometers',
    '/api/particle-counters',
    '/api/rdo/particle-counters',
    '/api/equipamentos'
  ].some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`));
  const isManualReportUploadApi = req.path === '/api/reports/manual-upload'
    || req.path === '/api/rdo/reports/manual-upload'
    || /^\/api(?:\/rdo)?\/reports\/[^/]+\/manual-pdf$/.test(req.path);
  const isSignatureApi = req.path.includes('/request-signature') || req.path.includes('/public-sign');
  const limit = isUploadsApi || isEquipmentUploadApi || isManualReportUploadApi ? '25mb' : isSignatureApi ? '3mb' : '1mb';
  return express.json({ limit })(req, res, next);
});
app.use(morgan('dev'));
app.use(requestMetrics);

async function serveAuthorizedStoredFile(req, res) {
  const normalizedPath = normalizeRelativeUploadPath(req.params[0]);
  const targetPath = resolveStoredFilePath(normalizedPath);
  if (!targetPath) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  if (!(await authorizeStoredFile(req, normalizedPath))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este arquivo.' });
  }

  return res.sendFile(targetPath);
}

app.use('/assets', express.static(env.assetsDir));
app.get('/certificados-calibracao/:token', asyncHandler(async (req, res) => {
  const resolved = await resolvePublicCalibrationCertificate(req.params.token);
  if (!resolved) {
    return res.status(404).json({ error: 'Certificado não encontrado.' });
  }
  res.type(resolved.certificate.mimeType || 'application/pdf');
  return res.sendFile(resolved.targetPath);
}));
// Registrada antes do `app.use('/api', apiRouter)` para ficar pública (download
// por token, sem auth) e, por estar sob /api, já é encaminhada pelo proxy.
app.get('/api/equipamentos-anexos/:token', asyncHandler(async (req, res) => {
  const resolved = await resolvePublicEquipmentAttachment(req.params.token);
  if (!resolved) {
    return res.status(404).json({ error: 'Anexo não encontrado.' });
  }
  res.type(resolved.attachment.mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(equipmentAttachmentFileName(resolved.attachment)));
  return res.sendFile(resolved.targetPath);
}));
app.get('/relatorios/*storedFilePath', requireAuth, asyncHandler(serveAuthorizedStoredFile));
app.get('/uploads/*storedFilePath', requireAuth, asyncHandler(serveAuthorizedStoredFile));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof ZodError) {
    const issues = localizedZodIssues(err.issues || []);
    const firstMessage = issues.find(issue => issue.message)?.message;
    return res.status(400).json({
      error: firstMessage ? `Dados inválidos: ${firstMessage}` : 'Dados inválidos',
      details: localizedZodErrorDetails(err)
    });
  }

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Arquivo muito grande para upload.'
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target;
      return res.status(409).json({
        error: target
          ? `Registro duplicado para um campo único (${target}).`
          : 'Registro duplicado para um campo único.'
      });
    }

    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Referência inválida entre registros.' });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    if (err.code === 'P2021') {
      return res.status(503).json({ error: 'Banco de dados não está atualizado. Execute as migrações e tente novamente.' });
    }
  }

  const isProduction = env.nodeEnv === 'production';
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 && isProduction ? 'Erro interno do servidor.' : (err.message || 'Erro interno do servidor.')
  });
});

export default app;
