import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import env from '../../config/env.js';
import { materializar } from './anexos.js';
import { gerarPdf } from './python.js';

const DURACAO_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const raizPadrao = () => path.join(env.uploadDir, '.databook-previas');
const indisponivel = () => Object.assign(new Error('A prévia expirou ou não está disponível. Atualize a prévia para continuar.'), { status: 410 });

/** Rascunhos privados e temporários. Nenhuma revisão é criada ao visualizar o PDF. */
export async function guardarPrevia(entrada, user, { client, gerar = gerarPdf, raiz = raizPadrao(), agora = Date.now() } = {}) {
  await fs.mkdir(raiz, { recursive: true, mode: 0o700 });
  for (const item of await fs.readdir(raiz, { withFileTypes: true })) {
    if (!item.isDirectory() || !UUID.test(item.name)) continue;
    const pasta = path.join(raiz, item.name);
    const stat = await fs.stat(pasta).catch(() => null);
    if (stat && agora - stat.mtimeMs > DURACAO_MS) await fs.rm(pasta, { recursive: true, force: true });
  }
  const id = randomUUID();
  const pasta = path.join(raiz, id);
  await fs.mkdir(pasta, { mode: 0o700 });
  try {
    const dados = await materializar(client, entrada.dados, { pasta, modo: 'gerar' });
    // As áreas clicáveis existem apenas na prévia; a entrada da revisão fica intacta.
    const info = await gerar({ ...dados, previa_editavel: true }, path.join(pasta, 'previa.pdf'));
    const registro = {
      ...entrada, userId: user.id, expiraEm: agora + DURACAO_MS,
      avisos: [...new Set([...(entrada.avisos || []), ...(info.avisos || [])])]
    };
    await fs.writeFile(path.join(pasta, 'entrada.json'), JSON.stringify(registro), { mode: 0o600 });
    await fs.rm(path.join(pasta, 'fotos'), { recursive: true, force: true });
    return { id, documento: entrada.documento, paginas: info.paginas, avisos: registro.avisos, campos: info.campos || [] };
  } catch (error) {
    await fs.rm(pasta, { recursive: true, force: true });
    throw error;
  }
}

export async function lerPrevia(id, user, { raiz = raizPadrao(), agora = Date.now() } = {}) {
  if (!UUID.test(String(id))) throw indisponivel();
  let entrada;
  try {
    entrada = JSON.parse(await fs.readFile(path.join(raiz, id, 'entrada.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw indisponivel();
  }
  if (entrada.userId !== user?.id || entrada.expiraEm <= agora) throw indisponivel();
  return entrada;
}

export async function pdfDaPrevia(id, user, opcoes) {
  await lerPrevia(id, user, opcoes);
  return path.join(opcoes?.raiz || raizPadrao(), id, 'previa.pdf');
}
