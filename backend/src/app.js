import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import cors from 'cors';
import express from 'express';
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

fs.mkdirSync(env.uploadDir, { recursive: true });

app.use(cors({
  exposedHeaders: ['Content-Disposition']
}));
app.use(express.json({ limit: '25mb' }));
app.use(morgan('dev'));

// Assinaturas exigem autenticação (token via header Bearer ou query param ?t=)
app.use('/uploads/Assinaturas', async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || String(req.query.t || '');
  if (!token) return res.status(401).json({ error: 'Acesso negado.' });
  try {
    const session = await prisma.userSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { expiresAt: true }
    });
    if (!session || session.expiresAt <= new Date()) {
      return res.status(401).json({ error: 'Sessao invalida ou expirada.' });
    }
  } catch {
    return res.status(500).json({ error: 'Erro ao verificar sessao.' });
  }
  next();
}, express.static(path.join(env.uploadDir, 'Assinaturas')));

app.use('/uploads', express.static(env.uploadDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
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

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

export default app;
