import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import env from '../../config/env.js';
import prisma from '../prisma.js';
import { materializar } from './anexos.js';
import { gerarPdf } from './python.js';

const INTERVALO_MS = 10 * 1000;
const TRAVA_EXPIRADA_MS = 30 * 60 * 1000;
const MAX_TENTATIVAS = 3;
const PASTA = 'DATABOOK';

let rodando = false;
let agendado = false;

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function executaveis(agora) {
  const expirada = new Date(agora.getTime() - TRAVA_EXPIRADA_MS);
  return {
    attempts: { lt: MAX_TENTATIVAS },
    OR: [
      { status: 'PENDING' },
      { status: 'FAILED', lockedAt: { lt: expirada } },
      { status: 'RUNNING', lockedAt: { lt: expirada } }
    ]
  };
}

async function reservar(client, agora = new Date()) {
  const where = executaveis(agora);
  const candidata = await client.projectDatabookRevision.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!candidata) return null;
  const ok = await client.projectDatabookRevision.updateMany({
    where: { id: candidata.id, ...where },
    data: { status: 'RUNNING', lockedAt: agora, error: null, attempts: { increment: 1 } }
  });
  if (ok.count !== 1) return null;
  return client.projectDatabookRevision.findUnique({
    where: { id: candidata.id },
    include: { databook: { include: { project: { select: { code: true, name: true } } } } }
  });
}

/** Gera o PDF de uma revisão reservada e grava em <uploadDir>/Missão …/DATABOOK/. */
export async function processarRevisao(revisao, { client = prisma, gerar = gerarPdf } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-job-'));
  try {
    const dados = await materializar(client, revisao.input, { pasta: tmp, modo: 'gerar' });
    const saidaTmp = path.join(tmp, 'databook.pdf');
    const info = await gerar(dados, saidaTmp);
    const { code, name } = revisao.databook.project;
    const relativo = [safePath(`Missão ${code} - ${name}`), PASTA, `${revisao.databook.docNumber}_Rev${revisao.revision}.pdf`];
    const destino = path.join(env.uploadDir, ...relativo);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.copyFile(saidaTmp, destino);
    const { size } = await fs.stat(destino);
    await client.projectDatabookRevision.update({
      where: { id: revisao.id },
      data: {
        status: 'COMPLETED', storagePath: relativo.join('/'), fileSize: size, pageCount: info.paginas,
        warnings: [...new Set([...(Array.isArray(revisao.warnings) ? revisao.warnings : []), ...(info.avisos || [])])],
        lockedAt: null, completedAt: new Date(), error: null
      }
    });
  } catch (error) {
    // Erro de dado (FDS/certificado ausente) não melhora com nova tentativa.
    const definitivo = error.status === 422;
    await client.projectDatabookRevision.update({
      where: { id: revisao.id },
      data: {
        status: 'FAILED', lockedAt: new Date(),
        error: `${error.message}${error.detalhe ? `\n${error.detalhe}` : ''}`.slice(0, 4000),
        ...(definitivo ? { attempts: MAX_TENTATIVAS } : {})
      }
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function processarFilaDatabook({ client = prisma, maximo = 2, gerar } = {}) {
  if (rodando) return 0;
  rodando = true;
  let feitos = 0;
  try {
    while (feitos < maximo) {
      const revisao = await reservar(client);
      if (!revisao) break;
      await processarRevisao(revisao, { client, gerar });
      feitos += 1;
    }
  } finally {
    rodando = false;
  }
  return feitos;
}

export function agendarFilaDatabook() {
  if (agendado) return;
  agendado = true;
  setImmediate(async () => {
    agendado = false;
    try {
      await processarFilaDatabook();
    } catch (error) {
      console.error('Falha ao processar a fila do Data Book.', error);
    }
  });
}

export function startDatabookJob({ intervalMs = INTERVALO_MS, keepAlive = false } = {}) {
  agendarFilaDatabook();
  const timer = setInterval(agendarFilaDatabook, intervalMs);
  if (!keepAlive) timer.unref?.();
  return timer;
}
