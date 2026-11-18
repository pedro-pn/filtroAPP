// Garante que a anonimização da homologação (deploy/db/anonymize-staging.sql)
// acompanha o schema: toda coluna de texto/JSON com nome de dado pessoal precisa
// de uma regra (plano ou exceção com motivo), e toda regra precisa apontar para
// uma coluna que existe. Sem isso, uma coluna nova com CPF/e-mail chegaria à
// homologação sem ninguém perceber (a trava em SQL só pega em tempo de sync).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const sql = read('deploy/db/anonymize-staging.sql');
const schema = read('backend/prisma/schema.prisma');

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `marcador ausente: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `marcador ausente: ${endMarker}`);
  return text.slice(start, end);
}

function piiPattern() {
  const match = sql.match(/SELECT '([^']+)'::text AS re;/);
  assert.ok(match, 'padrão de dado pessoal (_anon_pattern) não encontrado');
  return new RegExp(match[1], 'i');
}

function planEntries() {
  const body = section(sql, 'INSERT INTO _anon_plan', 'CREATE TEMP TABLE _anon_allow');
  return [...body.matchAll(/\('(\w+)', '(\w+|\*)', '(delete|null|set)'/g)]
    .map(([, table, column, strategy]) => ({ table, column, strategy }));
}

function allowEntries() {
  const body = section(sql, 'INSERT INTO _anon_allow', 'CREATE TEMP TABLE _anon_result');
  return [...body.matchAll(/\('(\w+)', '(\w+)', '([^']*)'\)/g)]
    .map(([, table, column, reason]) => ({ table, column, reason }));
}

// model -> Map(field -> { type, list })
function schemaModels() {
  const models = new Map();
  let current = null;
  for (const line of schema.split('\n')) {
    const header = line.match(/^model (\w+) \{/);
    if (header) {
      current = new Map();
      models.set(header[1], current);
      continue;
    }
    if (/^\}/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const field = line.trim().match(/^(\w+)\s+(\w+)(\[\])?\??(\s|$)/);
    if (!field || field[1].startsWith('@@')) continue;
    current.set(field[1], { type: field[2], list: Boolean(field[3]) });
  }
  return models;
}

const models = schemaModels();
const plan = planEntries();
const allow = allowEntries();
const pattern = piiPattern();

test('o SQL tem plano, exceções e padrão legíveis', () => {
  assert.ok(models.size > 100, 'schema.prisma não foi lido');
  assert.ok(plan.length > 50, 'plano de anonimização vazio ou ilegível');
  assert.ok(allow.length > 0, 'lista de exceções ilegível');
});

test('toda coluna de texto/JSON com nome de dado pessoal tem regra', () => {
  const covered = new Set([
    ...plan.map(entry => `${entry.table}.${entry.column}`),
    ...allow.map(entry => `${entry.table}.${entry.column}`)
  ]);
  const deletedTables = new Set(plan.filter(entry => entry.column === '*').map(entry => entry.table));
  const missing = [];
  for (const [model, fields] of models) {
    if (deletedTables.has(model)) continue;
    for (const [name, field] of fields) {
      if (!['String', 'Json'].includes(field.type)) continue;
      if (!pattern.test(name)) continue;
      if (!covered.has(`${model}.${name}`)) missing.push(`${model}.${name}`);
    }
  }
  assert.deepEqual(missing, [], `inclua em deploy/db/anonymize-staging.sql (_anon_plan ou _anon_allow com motivo): ${missing.join(', ')}`);
});

test('toda regra aponta para tabela e coluna existentes', () => {
  const stale = [];
  for (const entry of plan) {
    const fields = models.get(entry.table);
    if (!fields) stale.push(`${entry.table} (tabela)`);
    else if (entry.column !== '*' && !fields.has(entry.column)) stale.push(`${entry.table}.${entry.column}`);
  }
  for (const entry of allow) {
    const fields = models.get(entry.table);
    if (!fields || !fields.has(entry.column)) stale.push(`${entry.table}.${entry.column} (exceção)`);
  }
  assert.deepEqual(stale, [], 'regras de anonimização para colunas que não existem mais no schema');
});

test('exceções têm motivo, casam com o padrão e não repetem o plano', () => {
  const planned = new Set(plan.map(entry => `${entry.table}.${entry.column}`));
  for (const entry of allow) {
    assert.ok(entry.reason.length > 10, `exceção sem motivo: ${entry.table}.${entry.column}`);
    assert.ok(pattern.test(entry.column), `exceção desnecessária (não casa com o padrão): ${entry.table}.${entry.column}`);
    assert.ok(!planned.has(`${entry.table}.${entry.column}`), `coluna no plano e nas exceções: ${entry.table}.${entry.column}`);
  }
});

test('identificadores e contatos pessoais conhecidos são anonimizados (não só tolerados)', () => {
  const planned = new Set(plan.map(entry => `${entry.table}.${entry.column}`));
  for (const required of [
    'Collaborator.cpf',
    'Collaborator.email',
    'Collaborator.registrationNumber',
    'Collaborator.signatureImage',
    'ConectaRhAggregate.data',
    'User.email',
    'User.passwordHash',
    'ReportSignature.signatureImageDataUrl',
    'SatisfactionSurvey.responses',
    'ApiCredential.secretVerifier'
  ]) {
    assert.ok(planned.has(required), `${required} precisa estar em _anon_plan`);
  }
  for (const table of ['UserSession', 'PasswordResetToken', 'ReportDraft', 'ReportEmailJob']) {
    assert.ok(plan.some(entry => entry.table === table && entry.column === '*'), `${table} precisa ser apagada`);
  }
});

test('o sync anonimiza o banco temporário antes de ativá-lo e aborta se falhar', () => {
  const script = read('deploy/sync-staging.sh');
  const restore = script.indexOf('restaurando banco temporário');
  const anonymize = script.indexOf('-d "$RESTORE_DB" < "$ANONYMIZE_SQL"');
  const activate = script.indexOf('ativando banco restaurado');
  assert.ok(restore !== -1 && anonymize !== -1 && activate !== -1, 'marcadores do sync não encontrados');
  assert.ok(restore < anonymize && anonymize < activate, 'a anonimização precisa rodar entre o restore e a ativação');
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /ANONYMIZE_SQL="\$\{ANONYMIZE_SQL:-\$SCRIPT_DIR\/db\/anonymize-staging\.sql\}"/);
  // Sem o arquivo de anonimização, o sync nem começa (nada de cópia crua).
  const missingCheck = script.indexOf('if [ ! -f "$ANONYMIZE_SQL" ]; then');
  assert.ok(missingCheck !== -1 && missingCheck < restore, 'o sync precisa recusar rodar sem o SQL de anonimização');
});
