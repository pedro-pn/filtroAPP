import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// Impede que suítes de banco "passem" no CI sem nunca rodar.
//
// Um teste que se desliga por variável de ambiente (`skip: !process.env.X`) só
// tem valor se algum job do CI executar o arquivo COM essas variáveis definidas.
// Este teste lê .github/workflows/ci.yml e falha quando um arquivo com guarda de
// ambiente não é executado por nenhum passo que defina todas as suas variáveis.
//
// Exceções só com motivo registrado em NOT_RUNNABLE_IN_CI.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const ciPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const SELF = path.basename(fileURLToPath(import.meta.url));

// Variáveis que o próprio runner define ou que não indicam banco/serviço externo.
const AMBIENT_VARIABLES = new Set(['NODE_ENV', 'CI']);

// Arquivos que dependem de algo que o CI não tem. Cada entrada exige o motivo.
export const NOT_RUNNABLE_IN_CI = {
  'commercial-additional-real.integration.test.js':
    'importa o código-fonte do ComercialAPP (COMMERCIALAPP_SOURCE_DIR) e o banco dele; repositório separado, sem checkout no CI deste repositório.',
  'commercial-proposal-pull.integration.test.js':
    'importa o código-fonte do ComercialAPP (COMMERCIALAPP_SOURCE_DIR) e o banco dele; repositório separado, sem checkout no CI deste repositório.'
};

function withoutStrings(expression) {
  return expression.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
}

function envVarsIn(expression) {
  return [...withoutStrings(expression).matchAll(/process\.env\.([A-Z0-9_]+)/g)]
    .map(match => match[1])
    .filter(name => !AMBIENT_VARIABLES.has(name));
}

// Requisitos de ambiente de cada `skip` do arquivo, como lista de grupos:
// o arquivo roda quando TODOS os grupos têm ALGUMA variável definida.
// Resolve um nível de constante: `const url = process.env.A || process.env.B;` + `skip: !url`
// vira o grupo [A, B]; `const on = process.env.A === '1' && Boolean(process.env.B)` vira [A], [B].
export function skipGuardRequirements(source) {
  const constants = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) {
    constants.set(match[1], match[2]);
  }
  const groups = new Map();
  const add = group => {
    if (group.length) groups.set(group.slice().sort().join('|'), group.slice().sort());
  };
  for (const match of source.matchAll(/\bskip\s*:\s*([^,}\n]+)/g)) {
    const expression = withoutStrings(match[1]);
    for (const name of envVarsIn(expression)) add([name]);
    for (const identifier of expression.match(/[A-Za-z_$][\w$]*/g) || []) {
      const definition = constants.get(identifier);
      if (!definition) continue;
      const names = envVarsIn(definition);
      const alternatives = /\|\||\?\?/.test(definition) && !/&&/.test(definition);
      if (alternatives) add(names);
      else for (const name of names) add([name]);
    }
  }
  return [...groups.values()];
}

export function skipGuardVariables(source) {
  return [...new Set(skipGuardRequirements(source).flat())].sort();
}

function backendTestFiles() {
  return readdirSync(testDir).filter(file => file.endsWith('.test.js')).sort();
}

// Cada passo `run` de um job com working-directory backend: env efetivo + arquivos executados.
export function backendTestSteps(workflow, allFiles = backendTestFiles()) {
  const steps = [];
  for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
    const jobDirectory = job.defaults?.run?.['working-directory'];
    for (const step of job.steps || []) {
      if (typeof step.run !== 'string') continue;
      const directory = step['working-directory'] || jobDirectory;
      if (directory !== 'backend') continue;
      const env = { ...(workflow.env || {}), ...(job.env || {}), ...(step.env || {}) };
      let files = [];
      // `npm test` e as fatias do job backend-tests (scripts/run-test-shard.js) rodam
      // todos os arquivos; test-shards.test.js garante que as fatias somam o conjunto.
      if (/\bnpm (?:run )?test\b/.test(step.run) || /\bscripts\/run-test-shard\.js\b/.test(step.run)) files = allFiles;
      else if (/\bnode\b[^\n]*--test\b/.test(step.run)) {
        files = [...step.run.matchAll(/\btest\/([\w.-]+\.test\.js)\b/g)].map(match => match[1]);
      }
      if (files.length) steps.push({ job: job.name || jobId, step: step.name || step.run.slice(0, 60), env, files });
    }
  }
  return steps;
}

export function uncoveredGuardedSuites(workflow, readSource, allFiles = backendTestFiles()) {
  const steps = backendTestSteps(workflow, allFiles);
  const problems = [];
  const defined = (env, name) => env[name] !== undefined && String(env[name]) !== '';
  for (const file of allFiles) {
    if (file === SELF || NOT_RUNNABLE_IN_CI[file]) continue;
    const requirements = skipGuardRequirements(readSource(file));
    if (!requirements.length) continue;
    const covered = steps.some(step => step.files.includes(file)
      && requirements.every(group => group.some(name => defined(step.env, name))));
    if (!covered) problems.push({ file, variables: requirements.map(group => group.join(' ou ')) });
  }
  return problems;
}

test('toda suíte com guarda de ambiente roda em algum job do CI com as variáveis definidas', () => {
  const workflow = parse(readFileSync(ciPath, 'utf8'));
  const problems = uncoveredGuardedSuites(workflow, file => readFileSync(path.join(testDir, file), 'utf8'));
  assert.deepEqual(problems, [], [
    'Suítes que o CI nunca executa de verdade (são puladas em silêncio):',
    ...problems.map(problem => `- ${problem.file}: precisa de ${problem.variables.join(', ')}`),
    'Adicione o arquivo a um passo de .github/workflows/ci.yml que defina essas variáveis,',
    'ou registre o motivo em NOT_RUNNABLE_IN_CI.'
  ].join('\n'));
});

test('exceções de NOT_RUNNABLE_IN_CI apontam para arquivos que existem e ainda têm guarda', () => {
  const files = new Set(backendTestFiles());
  for (const file of Object.keys(NOT_RUNNABLE_IN_CI)) {
    assert.ok(files.has(file), `${file} não existe mais; remova de NOT_RUNNABLE_IN_CI.`);
    assert.ok(skipGuardVariables(readFileSync(path.join(testDir, file), 'utf8')).length,
      `${file} não tem mais guarda de ambiente; remova de NOT_RUNNABLE_IN_CI.`);
  }
});

test('o detector resolve guardas diretas, por constante e ignora texto de mensagem', () => {
  assert.deepEqual(skipGuardVariables("test('a', { skip: !process.env.FOO_URL }, () => {});"), ['FOO_URL']);
  assert.deepEqual(skipGuardVariables([
    "const enabled = process.env.BAR === '1' && Boolean(process.env.DATABASE_URL);",
    "test('b', { skip: enabled ? false : 'defina process.env.IGNORADA' }, () => {});"
  ].join('\n')), ['BAR', 'DATABASE_URL']);
  assert.deepEqual(skipGuardVariables("test('c', { skip: process.env.NODE_ENV !== 'test' }, () => {});"), []);
  assert.deepEqual(skipGuardRequirements([
    'const databaseUrl = process.env.SCOPE_URL || process.env.TEST_URL;',
    "test('d', { skip: !databaseUrl }, () => {});"
  ].join('\n')), [['SCOPE_URL', 'TEST_URL']]);
});

test('alternativas (A || B) contam como cobertas quando uma delas está definida', () => {
  const workflow = { jobs: { a: { defaults: { run: { 'working-directory': 'backend' } }, env: { TEST_URL: 'x' }, steps: [{ run: 'npm test' }] } } };
  const sources = {
    'alt.test.js': "const u = process.env.SCOPE_URL || process.env.TEST_URL;\ntest('x', { skip: !u }, () => {});",
    'missing.test.js': "test('y', { skip: !process.env.OTHER_URL }, () => {});"
  };
  assert.deepEqual(uncoveredGuardedSuites(workflow, file => sources[file], Object.keys(sources)),
    [{ file: 'missing.test.js', variables: ['OTHER_URL'] }]);
});

test('o detector de passos lê npm test, listas explícitas e env por passo', () => {
  const workflow = {
    jobs: {
      a: { name: 'A', defaults: { run: { 'working-directory': 'backend' } }, env: { X: '1' }, steps: [
        { run: 'npm test' },
        { name: 'shard', run: 'node scripts/run-test-shard.js --shard=2 --of=3' },
        { name: 'extra', env: { Y: '2' }, run: 'node --test --test-concurrency=1 test/one.test.js\n  test/two.test.js' }
      ] },
      b: { name: 'Frontend', defaults: { run: { 'working-directory': 'frontend' } }, steps: [{ run: 'npm test' }] }
    }
  };
  const steps = backendTestSteps(workflow, ['one.test.js', 'two.test.js', 'three.test.js']);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0].files, ['one.test.js', 'two.test.js', 'three.test.js']);
  assert.deepEqual(steps[1].files, ['one.test.js', 'two.test.js', 'three.test.js']);
  assert.deepEqual(steps[2].files, ['one.test.js', 'two.test.js']);
  assert.deepEqual(steps[2].env, { X: '1', Y: '2' });
});
