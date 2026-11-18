// Regra expand/contract das migrations (veja docs/PADRAO_MODULO.md, "Migrations").
//
// Migrations só andam para frente e o deploy-prod.sh volta de versão trocando o
// código, não o schema. Para a volta funcionar, uma migration precisa ser
// compatível com o código ANTERIOR ("expand"): acrescentar tabelas, colunas
// opcionais, índices, backfills. Tudo que quebra o código anterior ("contract":
// apagar, renomear, mudar tipo, tornar obrigatório) só entra com o cabeçalho
//
//   -- migration-safety: contract — <motivo>
//
// e, no deploy, exige `deploy/deploy-prod.sh --allow-contract`.
//
// Uso: node scripts/migration-safety.js [pasta-ou-migration.sql ...]
//      (sem argumentos: confere as migrations do repositório depois do corte)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Migrations até esta (inclusive) são histórico já aplicado em produção e ficam
// fora da regra. Não mova o corte para "liberar" uma migration nova: use o cabeçalho.
export const GRANDFATHERED_THROUGH = '20261117190000_conecta_rh_read_revision';

export const CONTRACT_HEADER = /^--\s*migration-safety:\s*contract\s*[—–:-]\s*(\S.{9,})$/im;

// Cada regra recebe o comando já sem comentários, sem textos entre aspas simples e
// com espaços normalizados, em maiúsculas.
const CONTRACT_RULES = [
  { id: 'drop-table', description: 'DROP TABLE apaga uma tabela que o código anterior usa', test: sql => /\bDROP TABLE\b/.test(sql) },
  { id: 'drop-column', description: 'DROP COLUMN apaga uma coluna que o código anterior lê/grava', test: sql => /\bALTER TABLE\b/.test(sql) && /\bDROP (COLUMN\b|(?!CONSTRAINT\b|DEFAULT\b|NOT NULL\b|IDENTITY\b|EXPRESSION\b)"?\w)/.test(sql) },
  { id: 'rename-table', description: 'renomear tabela quebra o código anterior', test: sql => /\bALTER TABLE\b(?!.*\bRENAME (COLUMN|CONSTRAINT)\b).*\bRENAME TO\b/.test(sql) },
  { id: 'rename-column', description: 'renomear coluna quebra o código anterior', test: sql => /\bALTER TABLE\b.*\bRENAME COLUMN\b/.test(sql) || /\bALTER TABLE\b.*\bRENAME "?\w+"? TO\b/.test(sql) },
  { id: 'alter-type', description: 'mudar o tipo de uma coluna pode quebrar leitura/escrita do código anterior', test: sql => /\bALTER COLUMN\b.*\b(SET DATA TYPE|TYPE)\b/.test(sql) },
  { id: 'set-not-null', description: 'SET NOT NULL rejeita gravações do código anterior que não enviam o campo', test: sql => /\bALTER COLUMN\b.*\bSET NOT NULL\b/.test(sql) },
  // Exceção: o Prisma tira o DEFAULT de colunas @updatedAt, que o client sempre preenche.
  { id: 'drop-default', description: 'DROP DEFAULT quebra inserts do código anterior que contavam com o padrão', test: (sql, _all, display) => /\bALTER COLUMN\b.*\bDROP DEFAULT\b/.test(sql) && !/^ALTER TABLE "[^"]+" ALTER COLUMN "updatedAt" DROP DEFAULT$/i.test(display) },
  { id: 'add-required-column', description: 'coluna nova NOT NULL sem DEFAULT quebra inserts do código anterior', test: sql => addColumnClauses(sql).some(clause => /\bNOT NULL\b/.test(clause) && !/\bDEFAULT\b/.test(clause) && !/\bGENERATED\b/.test(clause)) },
  { id: 'truncate', description: 'TRUNCATE apaga dados', test: sql => /^TRUNCATE\b/.test(sql) },
  { id: 'delete-all', description: 'DELETE sem WHERE apaga todos os dados da tabela', test: sql => /^DELETE FROM\b/.test(sql) && !/\bWHERE\b/.test(sql) },
  { id: 'drop-type', description: 'DROP TYPE (enum) quebra o código anterior', test: sql => /\bDROP TYPE\b/.test(sql) },
  { id: 'rename-type', description: 'renomear enum ou valor de enum quebra o código anterior', test: sql => /\bALTER TYPE\b.*\bRENAME\b/.test(sql) },
  // DROP + CREATE da mesma view na mesma migration é uma troca, não uma remoção.
  { id: 'drop-view', description: 'apagar view quebra consultas do código anterior', test: (sql, all) => /\bDROP (MATERIALIZED )?VIEW\b/.test(sql) && !all.some(item => /^CREATE (OR REPLACE )?(MATERIALIZED )?VIEW\b/.test(item.sql)) },
  { id: 'drop-schema', description: 'apagar schema ou sequence quebra o código anterior', test: sql => /\bDROP (SCHEMA|SEQUENCE)\b/.test(sql) }
];

// Não bloqueiam, mas aparecem no relatório: podem travar a tabela ou recusar dados.
const WARNING_RULES = [
  { id: 'unique-index', description: 'índice único em tabela existente falha se já houver duplicados', test: sql => /^CREATE UNIQUE INDEX\b/.test(sql) },
  { id: 'add-constraint', description: 'constraint nova pode recusar gravações do código anterior', test: sql => /\bALTER TABLE\b.*\bADD CONSTRAINT\b.*\b(CHECK|UNIQUE)\b/.test(sql) }
];

function addColumnClauses(sql) {
  if (!/^ALTER TABLE\b/.test(sql)) return [];
  return sql.split(/,(?![^(]*\))/).filter(clause => /\bADD (COLUMN\b|(?!CONSTRAINT\b)"?\w)/.test(clause));
}

// Remove comentários, corpos $$...$$ (funções/triggers) e textos entre aspas
// simples, para que palavras dentro deles não disparem regras.
export function normalizeSql(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

// Comandos em maiúsculas e com espaços normalizados. `sql` troca identificadores
// entre aspas duplas por "ID" (uma coluna chamada "type" não vira ALTER ... TYPE);
// `display` mantém os nomes para o relatório.
export function statements(text) {
  return normalizeSql(text)
    .split(';')
    .map(statement => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(display => ({ display, sql: display.replace(/"(?:[^"]|"")*"/g, '"ID"').toUpperCase() }));
}

export function classifyMigration(text) {
  const contract = [];
  const warnings = [];
  const all = statements(text);
  for (const { sql, display } of all) {
    for (const rule of CONTRACT_RULES) {
      if (rule.test(sql, all, display)) contract.push({ rule: rule.id, description: rule.description, statement: display.slice(0, 160) });
    }
    for (const rule of WARNING_RULES) {
      if (rule.test(sql, all, display)) warnings.push({ rule: rule.id, description: rule.description, statement: display.slice(0, 160) });
    }
  }
  const header = text.match(CONTRACT_HEADER);
  return {
    contract,
    warnings,
    declaredContract: Boolean(header),
    reason: header ? header[1].trim() : null
  };
}

export function checkMigration(name, text) {
  const result = classifyMigration(text);
  const problems = [];
  if (result.contract.length && !result.declaredContract) {
    problems.push(`${name}: ${result.contract.map(item => item.rule).join(', ')} sem o cabeçalho "-- migration-safety: contract — <motivo>"`);
  }
  return { name, ...result, problems };
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(scriptDir, '..', 'prisma', 'migrations');

export function repositoryMigrations(dir = MIGRATIONS_DIR, { through = GRANDFATHERED_THROUGH } = {}) {
  return readdirSync(dir)
    .filter(name => existsSync(path.join(dir, name, 'migration.sql')))
    .filter(name => name > through)
    .sort()
    .map(name => ({ name, file: path.join(dir, name, 'migration.sql') }));
}

function cliTargets(args) {
  if (!args.length) return repositoryMigrations();
  return args.map(arg => {
    const file = statSync(arg).isDirectory() ? path.join(arg, 'migration.sql') : arg;
    return { name: path.basename(path.dirname(path.resolve(file))), file };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = false;
  for (const { name, file } of cliTargets(process.argv.slice(2))) {
    const result = checkMigration(name, readFileSync(file, 'utf8'));
    const kind = result.contract.length ? (result.declaredContract ? 'CONTRACT (declarada)' : 'CONTRACT SEM CABEÇALHO') : 'expand';
    console.log(`${name}: ${kind}${result.reason ? ` — ${result.reason}` : ''}`);
    for (const item of [...result.contract, ...result.warnings]) console.log(`  - ${item.rule}: ${item.description}`);
    if (result.problems.length) failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}
