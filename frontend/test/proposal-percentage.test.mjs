import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { consideredProposalValue, parseProposalPercentage } from '../src/utils/proposalPercentage.ts';

test('percentual aceita decimais brasileiros, zero e 100; recusa valor vazio, fora da faixa e precisão excedente', () => {
  assert.equal(parseProposalPercentage('33,33'), 33.33);
  assert.equal(parseProposalPercentage('0'), 0);
  assert.equal(parseProposalPercentage('100.00'), 100);
  for (const value of ['', '-1', '101', '12.345', 'texto', 'NaN']) assert.equal(parseProposalPercentage(value), null);
  assert.equal(consideredProposalValue(100000, 70), 70000);
  assert.equal(consideredProposalValue(0.29, 50), 0.15);
  assert.equal(consideredProposalValue(24, 50), 12);
  assert.equal(consideredProposalValue(120, 0), 0);
  assert.equal(consideredProposalValue(null, 50), null);
});

test('ajuste do cronograma começa colapsado, mostra a prévia e permite restaurar o percentual para gestores', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { ProjectProposalPercentageField } = await server.ssrLoadModule('/src/components/projects/ProjectProposalPercentageField.tsx');
    const props = { projectId: 'p1', value: '50', canManage: true, onChange() {}, rows: [
      { label: 'Custo', value: 100000, unit: 'BRL' }, { label: 'Receita', value: 200000, unit: 'BRL' },
      { label: 'Dias corridos', value: 24, unit: 'dias' }, { label: 'Horas normais', value: 100, unit: 'h' }
    ] };
    const markup = renderToStaticMarkup(createElement(ProjectProposalPercentageField, props));
    assert.match(markup, /^<details class="acp-planned-cost acp-proposal-adjustment"><summary>Ajustar percentual da proposta<\/summary>/);
    assert.match(markup, /Percentual da proposta considerado/);
    assert.match(markup, /Considerado \(50%\)/);
    assert.match(markup, /100\.000,00/);
    assert.match(markup, /50\.000,00/);
    assert.match(markup, /12 dias/);
    assert.match(markup, /50 h/);
    assert.match(markup, /Restaurar 100%/);
    const viewer = renderToStaticMarkup(createElement(ProjectProposalPercentageField, { ...props, canManage: false }));
    assert.match(viewer, /disabled/);
    assert.doesNotMatch(viewer, /Restaurar 100%/);
    const invalid = renderToStaticMarkup(createElement(ProjectProposalPercentageField, { ...props, value: '' }));
    assert.match(invalid, /role="alert"/);
  } finally { await server.close(); }
});
