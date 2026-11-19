import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { planShards, testFiles } from '../scripts/run-test-shard.js';

// O job Backend do CI roda os testes divididos em fatias paralelas. Se a divisão
// deixasse um arquivo de fora, ele "passaria" sem nunca rodar.
const testDir = path.dirname(fileURLToPath(import.meta.url));
const ciPath = path.resolve(testDir, '..', '..', '.github', 'workflows', 'ci.yml');
const sizeOf = file => statSync(path.join(testDir, file)).size;

function shardMatrix() {
  const workflow = parse(readFileSync(ciPath, 'utf8'));
  const job = workflow.jobs['backend-tests'];
  assert.ok(job, 'job backend-tests existe no ci.yml');
  const shards = job.strategy.matrix.shard;
  const run = job.steps.map(step => step.run || '').join('\n');
  const of = Number(run.match(/run-test-shard\.js[^\n]*--of=(\d+)/)?.[1]);
  return { shards, of };
}

test('as fatias do CI cobrem todos os arquivos de teste, uma vez cada', () => {
  const { shards, of } = shardMatrix();
  assert.deepEqual(shards, Array.from({ length: of }, (_, index) => index + 1),
    'a matriz do job backend-tests precisa listar as fatias 1..N do --of');
  const files = testFiles();
  const planned = planShards(files, sizeOf, of);
  const all = planned.flat();
  assert.equal(all.length, files.length, 'nenhum arquivo repetido ou faltando');
  assert.deepEqual([...all].sort(), files);
  for (const shard of planned) assert.ok(shard.length > 0, 'nenhuma fatia vazia');
});

test('a divisão é determinística e equilibrada', () => {
  const files = ['a.test.js', 'b.integration.test.js', 'c.test.js', 'd.test.js', 'e.test.js'];
  const sizes = { 'a.test.js': 50_000, 'b.integration.test.js': 1_000, 'c.test.js': 30_000, 'd.test.js': 2_000, 'e.test.js': 2_000 };
  const first = planShards(files, file => sizes[file], 2);
  assert.deepEqual(planShards([...files].reverse(), file => sizes[file], 2), first);
  assert.deepEqual(first.flat().sort(), files);
  assert.throws(() => planShards(files, () => 1, 0), /fatias/);
});
