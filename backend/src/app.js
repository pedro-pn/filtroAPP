import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';

import env from './config/env.js';
import asyncHandler from './lib/async-handler.js';
import { requireAuth } from './middleware/auth.js';
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
  const isSignatureApi = req.path.includes('/request-signature') || req.path.includes('/public-sign');
  const limit = isUploadsApi ? '25mb' : isSignatureApi ? '3mb' : '1mb';
  return express.json({ limit })(req, res, next);
});
app.use(morgan('dev'));

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
app.get('/relatorios/*', requireAuth, asyncHandler(serveAuthorizedStoredFile));
app.get('/uploads/*', requireAuth, asyncHandler(serveAuthorizedStoredFile));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof ZodError) {
    const firstMessage = err.issues?.find(issue => issue.message)?.message;
    return res.status(400).json({
      error: firstMessage ? `Dados inválidos: ${firstMessage}` : 'Dados inválidos',
      details: err.flatten()
    });
  }

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Arquivo muito grande para upload.'
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Registro duplicado para um campo único.' });
    }

    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Referência inválida entre registros.' });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }
  }

  const isProduction = env.nodeEnv === 'production';
  const status = err.status || 500;
  res.status(err.status || 500).json({
    error: status >= 500 && isProduction ? 'Erro interno do servidor.' : (err.message || 'Internal server error')
  });
});

export default app;
