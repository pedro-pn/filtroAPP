import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesSearch, createSearchMatcher } from '../src/utils/search.ts';

test('search preserves field boundaries for project and report numbers', () => {
  assert.equal(matchesSearch(['RTP', 58, '00 - Outro projeto'], '5800'), false);
  assert.equal(matchesSearch(['5800', 'Reframax'], '5800'), true);
  assert.equal(matchesSearch(['5837', 'Coradin'], '5800'), false);
});

test('search accepts accents, multiple terms, and formatted identifiers', () => {
  const matches = createSearchMatcher('joao pressao');
  assert.equal(matches(['João da Silva', 'Teste de pressão']), true);
  assert.equal(matches(['João da Silva', 'Limpeza química']), false);
  assert.equal(matchesSearch(['12.345.678/0001-90'], '12345678000190'), true);
  assert.equal(matchesSearch(['AB-5800'], 'ab5800'), true);
  assert.equal(matchesSearch(['5800', 'Reframax'], '5800 reframax'), true);
});

test('punctuation-only search does not match every entry', () => {
  assert.equal(matchesSearch(['Reframax'], '/'), false);
  assert.equal(matchesSearch(['12/09/2026'], '/'), true);
  assert.equal(matchesSearch(['Reframax'], '   '), true);
});
