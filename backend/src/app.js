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
import { captureOperationalError } from './lib/operations/error-tracking.js';
import { resolvePublicStockAttachment, stockAttachmentFileName } from './lib/estoque/stock-attachments.js';
import { qualityAttachmentFileName, resolvePublicQualityAttachment } from './lib/qualidade/attachments.js';
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

export function sanitizedHttpErrorForObservability(error, req) {
  const secret = String(req?.headers?.['x-signature-token'] || '').trim();
  const redact = value => {
    const text = String(value || '');
    return secret ? text.split(secret).join('[REDACTED]') : text;
  };
  const sanitized = new Error(redact(error?.message || error || 'Erro HTTP'));
  sanitized.name = redact(error?.name || 'Error');
  sanitized.stack = redact(error?.stack || sanitized.stack);
  if (error?.code) sanitized.code = redact(error.code);
  return sanitized;
}

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
    // Nega origem não permitida sem lançar erro (evita respostas HTTP 500 ruidosas
    // e ruído no monitoramento). O navegador bloqueia por falta de cabeçalhos CORS.
    callback(null, !origin || originAllowed);
  },
  exposedHeaders: ['Content-Disposition']
}));

export function jsonBodyLimitForRequest(method, requestPath) {
  const isStandaloneSignatureUpload = method === 'POST'
    && requestPath === '/api/assinaturas/documentos';
  if (isStandaloneSignatureUpload) return '30mb';

  const isStandalonePublicSignatureApi = requestPath === '/api/assinaturas/publico'
    || requestPath.startsWith('/api/assinaturas/publico/');
  if (isStandalonePublicSignatureApi) return '3mb';

  const isUploadsApi = requestPath.startsWith('/api/uploads') || requestPath.startsWith('/api/rdo/uploads');
  const isEquipmentUploadApi = [
    '/api/manometers',
    '/api/rdo/manometers',
    '/api/particle-counters',
    '/api/rdo/particle-counters',
    '/api/equipamentos',
    '/api/estoque',
    '/api/qualidade/registros'
  ].some(prefix => requestPath === prefix || requestPath.startsWith(`${prefix}/`));
  const isStockDocumentUploadApi = /^\/api\/estoque\/itens\/[^/]+\/documentos$/.test(requestPath);
  const isManualReportUploadApi = requestPath === '/api/reports/manual-upload'
    || requestPath === '/api/rdo/reports/manual-upload'
    || /^\/api(?:\/rdo)?\/reports\/[^/]+\/manual-pdf$/.test(requestPath);
  const isSignatureApi = requestPath.includes('/request-signature') || requestPath.includes('/public-sign');
  if (isStockDocumentUploadApi) return '30mb';
  if (isUploadsApi || isEquipmentUploadApi || isManualReportUploadApi) return '25mb';
  if (isSignatureApi) return '3mb';
  return '1mb';
}

app.use((req, res, next) => {
  const limit = jsonBodyLimitForRequest(req.method, req.path);
  return express.json({ limit })(req, res, next);
});
morgan.token('safe-url', req => req.originalUrl?.split('?')[0] || req.url?.split('?')[0] || '/');
app.use(morgan(':method :safe-url :status :response-time ms - :res[content-length]'));
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
app.get('/api/estoque-anexos/:token', asyncHandler(async (req, res) => {
  const resolved = await resolvePublicStockAttachment(req.params.token);
  if (!resolved) {
    return res.status(404).json({ error: 'Anexo não encontrado.' });
  }
  res.type(resolved.document.mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(stockAttachmentFileName(resolved)));
  return res.sendFile(resolved.targetPath);
}));
app.get('/api/qualidade-anexos/:token', asyncHandler(async (req, res) => {
  const resolved = await resolvePublicQualityAttachment(req.params.token);
  if (!resolved) {
    return res.status(404).json({ error: 'Anexo não encontrado.' });
  }
  res.type(resolved.evidence.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', inlineContentDisposition(qualityAttachmentFileName(resolved.evidence)));
  return res.sendFile(resolved.targetPath);
}));
app.get('/relatorios/*storedFilePath', requireAuth, asyncHandler(serveAuthorizedStoredFile));
app.get('/uploads/*storedFilePath', requireAuth, asyncHandler(serveAuthorizedStoredFile));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', apiRouter);

app.use((err, req, res, _next) => {
  const observableError = sanitizedHttpErrorForObservability(err, req);
  console.error(observableError);

  // Corpo malformado: não expor a mensagem interna do parser de JSON.
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err))) {
    return res.status(400).json({ error: 'Corpo da requisição inválido.' });
  }

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
  if (status >= 500) {
    captureOperationalError(observableError, {
      source: 'backend.http',
      context: {
        method: req.method,
        path: req.path,
        statusCode: status
      }
    }).catch(captureError => {
      console.warn('Falha ao reportar erro HTTP operacional.', captureError);
    });
  }
  res.status(status).json({
    error: status >= 500
      ? (isProduction ? 'Erro interno do servidor.' : observableError.message)
      : (err.message || 'Erro interno do servidor.'),
    ...(err.code ? { code: err.code } : {}),
    ...(Array.isArray(err.conflicts) && err.conflicts.length ? { conflicts: err.conflicts } : {}),
    ...(Array.isArray(err.issues) && err.issues.length ? { issues: err.issues } : {})
  });
});

export default app;
