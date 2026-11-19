#!/usr/bin/env node
// Roda uma fatia dos testes do backend (CI em paralelo, um PostgreSQL por fatia).
//
//   node scripts/run-test-shard.js --shard=1 --of=3          # roda a fatia 1 de 3
//   node scripts/run-test-shard.js --shard=1 --of=3 --list   # só lista os arquivos
//
// A divisão é determinística e equilibrada: cada arquivo tem um peso estimado
// (custo fixo de abrir o processo + tamanho + bônus para suítes de banco) e vai
// para a fatia mais leve até ali, em ordem decrescente de peso. A união das
// fatias é sempre o conjunto completo de test/*.test.js, sem repetição; o teste
// backend/test/test-shards.test.js garante isso. `npm test` continua rodando tudo.
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(backendDir, 'test');

// Abrir um arquivo de teste (novo processo + import do app) custa o equivalente
// a alguns KB de teste; suítes de banco/HTTP pagam ainda migrations e conexões.
const FILE_OVERHEAD = 8_000;
const DATABASE_SUITE_BONUS = 20_000;
const DATABASE_SUITE = /integration|postgres|database|\.db\./i;

export function testFiles(directory = testDir) {
  return readdirSync(directory).filter(file => file.endsWith('.test.js')).sort();
}

export function fileWeight(file, size) {
  return FILE_OVERHEAD + size + (DATABASE_SUITE.test(file) ? DATABASE_SUITE_BONUS : 0);
}

// Retorna `count` listas de arquivos (cada uma em ordem alfabética).
export function planShards(files, sizeOf, count) {
  if (!Number.isInteger(count) || count < 1) throw new TypeError('Quantidade de fatias inválida.');
  const shards = Array.from({ length: count }, () => ({ weight: 0, files: [] }));
  const weighted = files
    .map(file => ({ file, weight: fileWeight(file, sizeOf(file)) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  for (const { file, weight } of weighted) {
    let target = shards[0];
    for (const shard of shards) if (shard.weight < target.weight) target = shard;
    target.files.push(file);
    target.weight += weight;
  }
  return shards.map(shard => shard.files.sort());
}

function argument(name) {
  const match = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

async function main() {
  const of = Number(argument('of'));
  const shard = Number(argument('shard'));
  if (!Number.isInteger(of) || of < 1 || !Number.isInteger(shard) || shard < 1 || shard > of) {
    console.error('Uso: node scripts/run-test-shard.js --shard=<1..N> --of=<N> [--list]');
    process.exit(2);
  }
  const files = planShards(testFiles(), file => statSync(path.join(testDir, file)).size, of)[shard - 1];
  if (process.argv.includes('--list')) {
    console.log(files.join('\n'));
    return;
  }
  console.log(`[test-shard] fatia ${shard}/${of}: ${files.length} arquivos`);
  const child = spawn(process.execPath, ['--test', ...files.map(file => path.join('test', file))], {
    cwd: backendDir,
    stdio: 'inherit'
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
