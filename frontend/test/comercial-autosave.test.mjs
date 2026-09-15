import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

let server;
let autosave;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  autosave = await server.ssrLoadModule(
    '/src/pages/comercial/useAutosaveServidor.ts'
  );
});

test.after(async () => {
  await server?.close();
});

test('o estado do salvamento automático é explicado ao usuário', () => {
  assert.equal(
    autosave.rotuloDoAutosave('salvando'),
    'Salvando rascunho automaticamente...'
  );
  assert.equal(
    autosave.rotuloDoAutosave('salvo'),
    'Rascunho salvo automaticamente'
  );
  assert.equal(
    autosave.rotuloDoAutosave('erro'),
    'Não foi possível salvar automaticamente'
  );
});

test('levantamento e proposta ligam suas gravações de rascunho ao autosave', () => {
  const custos = readFileSync(
    new URL('../src/pages/comercial/custos/CustosPage.tsx', import.meta.url),
    'utf8'
  );
  const proposta = readFileSync(
    new URL(
      '../src/pages/comercial/proposta/PropostaPage.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(custos, /useAutosaveServidor\(\{/);
  assert.match(custos, /persistirRascunho\(true\)/);
  assert.match(proposta, /useAutosaveServidor\(\{/);
  assert.match(proposta, /salvar\(false, true\)/);
});

test('a entrada do levantamento carrega os orçamentos salvos com ação de continuar', () => {
  const custos = readFileSync(
    new URL('../src/pages/comercial/custos/CustosPage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(custos, /listarLevantamentos\(\{ pageSize: 100 \}\)/);
  assert.match(custos, /Orçamentos salvos/);
  assert.match(custos, /<strong>Novo orçamento<\/strong>/);
  assert.match(custos, /<strong>Revisar orçamento<\/strong>/);
  assert.doesNotMatch(custos, /<strong>Nova proposta<\/strong>/);
  assert.match(custos, /<b>Continuar<\/b>/);
});
