import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import env from '../../config/env.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Pacote Python do gerador (backend/databook): `python -m databook` roda com cwd nesta pasta.
export const PACOTE_DATABOOK = path.resolve(__dirname, '../../../databook');

function erroDoGerador(error) {
  const stderr = String(error?.stderr || '').trim();
  const ultima = stderr.split('\n').filter(Boolean).pop() || error?.message || 'falha desconhecida';
  const err = new Error(`Gerador do Data Book falhou: ${ultima}`);
  err.detalhe = stderr.slice(-4000);
  // FileNotFoundError do gerador = FDS/certificado ausente: erro do dado, não do sistema.
  if (/FileNotFoundError/.test(stderr)) err.status = 422;
  return err;
}

async function rodar(args, { timeoutMs = env.databookTimeoutMs, exec = execFileAsync } = {}) {
  try {
    const { stdout } = await exec(env.databookPython, ['-m', 'databook', ...args], {
      cwd: PACOTE_DATABOOK,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
    });
    const linha = String(stdout).trim().split('\n').filter(Boolean).pop();
    return JSON.parse(linha);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Gerador do Data Book devolveu uma resposta inválida.');
    throw erroDoGerador(error);
  }
}

async function comEntrada(dados, fn) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-entrada-'));
  try {
    const entrada = path.join(pasta, 'entrada.json');
    await fs.writeFile(entrada, JSON.stringify(dados), 'utf8');
    return await fn(entrada);
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
}

/** Pré-validação: avisos de consistência do gerador, sem montar o PDF. */
export function avisosDoGerador(dados, opcoes) {
  return comEntrada(dados, entrada => rodar([entrada, '--avisos', '--base-dir', os.tmpdir()], opcoes))
    .then(r => (Array.isArray(r?.avisos) ? r.avisos : []));
}

/** Gera o PDF em `saida`; devolve {arquivo, paginas, avisos}. Caminhos de arquivo devem ser absolutos. */
export function gerarPdf(dados, saida, opcoes) {
  return comEntrada(dados, entrada => rodar([entrada, saida, '--json', '--base-dir', os.tmpdir()], opcoes));
}
