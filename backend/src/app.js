import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';

import env from './config/env.js';
import { hashToken } from './lib/auth.js';
import prisma from './lib/prisma.js';
import apiRouter from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appHtmlPath = path.resolve(__dirname, '../..', 'filtrovali_app_v4.html');

const app = express();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findSessionExpiryWithRetry(tokenHash, options = {}) {
  const attempts = options.attempts || 3;
  const delayMs = options.delayMs || 25;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.userSession.findUnique({
        where: { tokenHash },
        select: { expiresAt: true }
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

fs.mkdirSync(env.assetsDir, { recursive: true });
fs.mkdirSync(env.reportsDir, { recursive: true });

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
  const isUploadsApi = req.path.startsWith('/api/uploads');
  const limit = isUploadsApi ? '25mb' : '1mb';
  return express.json({ limit })(req, res, next);
});
app.use(morgan('dev'));

// Arquivos de relatórios e assinaturas exigem autenticação via header Bearer.
const protectedRelatorios = async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Acesso negado.' });
  try {
    const session = await findSessionExpiryWithRetry(hashToken(token));
    if (!session || session.expiresAt <= new Date()) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
  } catch {
    return res.status(500).json({ error: 'Erro ao verificar sessao.' });
  }
  next();
};

app.use('/assets', express.static(env.assetsDir));
app.use('/relatorios/Assinaturas', protectedRelatorios, express.static(path.join(env.reportsDir, 'Assinaturas')));
app.use('/uploads/Assinaturas', protectedRelatorios, express.static(path.join(env.reportsDir, 'Assinaturas')));
app.use('/relatorios', protectedRelatorios, express.static(env.reportsDir));
app.use('/uploads', protectedRelatorios, express.static(env.reportsDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.sendFile(appHtmlPath);
});

app.get('/reset-password', (_req, res) => {
  res.sendFile(appHtmlPath);
});

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Dados inválidos',
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
