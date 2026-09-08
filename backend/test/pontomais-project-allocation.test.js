import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectTagResolver,
  extractMissionCode,
  normalizeProjectTag
} from '../src/lib/pontomais/normalize.js';

test('resolve código de missão com texto livre sem depender de caixa ou acento', () => {
  const resolve = buildProjectTagResolver({
    projects: [{ id: 'project-5745', code: '5745' }]
  });

  assert.equal(normalizeProjectTag('  MISSÃO 5745  '), 'missao 5745');
  assert.equal(extractMissionCode('Atividade na Missão #5745 - cliente'), '5745');
  assert.equal(resolve('Atividade na MISSAO #5745 - cliente'), 'project-5745');
});

test('alias explícito tem precedência sobre o código canônico', () => {
  const resolve = buildProjectTagResolver({
    projects: [
      { id: 'project-canonical', code: '5745' },
      { id: 'project-alias', code: '6000' }
    ],
    tagAliases: [{ normalizedTag: 'missao 5745', projectId: 'project-alias' }]
  });

  assert.equal(resolve('Missão 5745'), 'project-alias');
});

test('não extrai números genéricos nem associa texto desconhecido', () => {
  const resolve = buildProjectTagResolver({
    projects: [{ id: 'project-5745', code: '5745' }]
  });

  assert.equal(extractMissionCode('Contrato 5745'), null);
  assert.equal(resolve('Contrato 5745'), null);
  assert.equal(resolve('Projeto ainda não cadastrado'), null);
});

test('projeto histórico continua resolvível quando faz parte do catálogo consultado', () => {
  const resolve = buildProjectTagResolver({
    projects: [{ id: 'project-history', code: '5700', deletedAt: new Date('2026-01-01') }]
  });

  assert.equal(resolve('Missão 5700'), 'project-history');
});
