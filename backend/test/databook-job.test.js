import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// O PDF final vai para env.uploadDir: aponta para uma pasta temporária antes de carregar o env.
const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-upload-'));
process.env.REPORTS_DIR = uploadDir;
const { processarRevisao } = await import('../src/lib/databook/jobs.js');
const { gerarPdf, avisosDoGerador } = await import('../src/lib/databook/python.js');
const { default: env } = await import('../src/config/env.js');

const entradaMinima = {
  projeto: { missao: 'Missão 9001 – UNIDADE EXEMPLO', cliente: 'CLIENTE EXEMPLO', contrato: '9999', local: 'Macaé', servico: 'Limpeza química',
    doc: 'DB-9001-01', rev: '0', emissao: '10/10/2026', empresa: 'Filtrovali', periodo: '02/10/2026 a 02/10/2026' },
  dias: [{ data: '02/10/2026', dia_semana: 'sexta-feira', rdo: 2, atividades: [{ hora: null, texto: 'Montagem.' }], servicos: [],
    fotos: [{ arquivo: 'upload:Missão 9001/RDO/nao-existe.jpg', origem: 'RDO', numero: 2 }] }]
};

function revisao(extra = {}) {
  return {
    id: 'rev-1', revision: 0, warnings: ['aviso do mapper'], input: entradaMinima,
    databook: { docNumber: 'DB-9001-01', project: { code: '9001', name: 'UNIDADE EXEMPLO' } }, ...extra
  };
}

function clienteQueRegistra() {
  const updates = [];
  return { updates, projectDatabookRevision: { update: async args => { updates.push(args); return args; } } };
}

test('job: grava o PDF em <uploadDir>/Missão …/DATABOOK e conclui a revisão', async () => {
  assert.equal(env.uploadDir, uploadDir);
  const client = clienteQueRegistra();
  let recebido;
  await processarRevisao(revisao(), {
    client,
    gerar: async (dados, saida) => {
      recebido = dados;
      await fs.writeFile(saida, '%PDF-1.4 fake');
      return { arquivo: saida, paginas: 7, avisos: ['02/10/2026: foto não encontrada: x'] };
    }
  });
  // foto ausente no armazenamento vira caminho inexistente (aviso do gerador), não erro
  assert.match(recebido.dias[0].fotos[0].arquivo, /^ausente/);
  const [{ data }] = client.updates;
  assert.equal(data.status, 'COMPLETED');
  assert.equal(data.pageCount, 7);
  assert.equal(data.storagePath, 'Missão 9001 - UNIDADE EXEMPLO/DATABOOK/DB-9001-01_Rev0.pdf');
  assert.deepEqual(data.warnings, ['aviso do mapper', '02/10/2026: foto não encontrada: x']);
  assert.equal(await fs.readFile(path.join(uploadDir, ...data.storagePath.split('/')), 'utf8'), '%PDF-1.4 fake');
});

test('job: falha do gerador marca FAILED e permite nova tentativa', async () => {
  const client = clienteQueRegistra();
  await processarRevisao(revisao(), { client, gerar: async () => { throw new Error('timeout'); } });
  const [{ data }] = client.updates;
  assert.equal(data.status, 'FAILED');
  assert.match(data.error, /timeout/);
  assert.equal(data.attempts, undefined);
});

test('job: FDS ausente no armazenamento é erro definitivo e claro', async () => {
  const updates = [];
  const client = {
    stockItemDocument: { findUnique: async () => null },
    projectDatabookRevision: { update: async args => updates.push(args) }
  };
  const input = { ...entradaMinima, fds: [{ produto: 'Ácido cítrico', nome_comercial: 'Ácido Cítrico', arquivo: 'stockdoc:doc-x' }] };
  await processarRevisao(revisao({ input }), { client, gerar: async () => assert.fail('não deveria gerar') });
  assert.equal(updates[0].data.status, 'FAILED');
  assert.match(updates[0].data.error, /FDS de "Ácido Cítrico" não encontrada/);
  assert.equal(updates[0].data.attempts, 3);
});

const pythonPronto = spawnSync(env.databookPython, ['-c', 'import reportlab, pypdf, PIL'], { encoding: 'utf8' }).status === 0;

test('Node → Python: pré-validação e geração reais do gerador', { skip: !pythonPronto && 'Python do Data Book não instalado (DATABOOK_PYTHON)' }, async () => {
  const dados = structuredClone(entradaMinima);
  dados.dias[0].fotos[0].arquivo = path.join('ausente', 'nao-existe.jpg');
  const avisos = await avisosDoGerador(dados);
  assert.ok(avisos.some(a => a.includes('foto não encontrada')));
  const saida = path.join(uploadDir, 'real.pdf');
  const info = await gerarPdf(dados, saida);
  assert.ok(info.paginas >= 6);
  assert.equal((await fs.readFile(saida)).subarray(0, 4).toString(), '%PDF');
});

test.after(() => fs.rm(uploadDir, { recursive: true, force: true }));
