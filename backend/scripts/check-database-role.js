// Confere o papel usado em DATABASE_URL (ou na URL passada com --url).
//
//   node scripts/check-database-role.js                 # relatório
//   node scripts/check-database-role.js --require-restricted
//
// Com --require-restricted, sai com código 1 se o papel for superusuário, puder
// criar objetos no schema public ou no banco, for dono de tabelas, ou não tiver
// SELECT/INSERT/UPDATE/DELETE em alguma tabela do schema public.
// Não imprime a URL nem a senha.
import 'dotenv/config';
import pg from 'pg';

import { classifyDatabaseRole } from '../src/lib/operations/database-role.js';

const args = process.argv.slice(2);
const requireRestricted = args.includes('--require-restricted');
const urlIndex = args.indexOf('--url');
const connectionString = urlIndex >= 0 ? args[urlIndex + 1] : process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL não definido.');
  process.exit(2);
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });

try {
  await client.connect();
  const { rows: [role] } = await client.query(`
    SELECT current_user::text AS "user",
      r.rolsuper AS "superuser",
      has_schema_privilege('public', 'CREATE') AS "canCreateInPublic",
      has_database_privilege(current_database(), 'CREATE') AS "canCreateSchema",
      (SELECT count(*)::int FROM pg_tables t
        WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS "ownedTables"
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const { rows: missing } = await client.query(`
    SELECT c.relname AS "table"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND NOT (
        has_table_privilege(c.oid, 'SELECT')
        AND has_table_privilege(c.oid, 'INSERT')
        AND has_table_privilege(c.oid, 'UPDATE')
        AND has_table_privilege(c.oid, 'DELETE')
      )
    ORDER BY c.relname
  `);
  const { rows: missingSequences } = await client.query(`
    SELECT c.relname AS "sequence"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      -- CASE garante que has_sequence_privilege só recebe sequences (o planner
      -- pode avaliar os filtros em qualquer ordem).
      AND CASE WHEN c.relkind = 'S' THEN NOT has_sequence_privilege(c.oid, 'USAGE') ELSE false END
    ORDER BY c.relname
  `);
  const { rows: [{ tables }] } = await client.query(
    "SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname = 'public'"
  );

  const classification = classifyDatabaseRole(role);
  const report = {
    ...classification,
    publicTables: tables,
    tablesMissingGrants: missing.map(row => row.table),
    sequencesMissingUsage: missingSequences.map(row => row.sequence)
  };
  console.log(JSON.stringify(report, null, 2));

  if (requireRestricted) {
    const failures = [];
    if (classification.status !== 'RESTRICTED') failures.push(`papel ${classification.user} não é restrito`);
    if (report.tablesMissingGrants.length) failures.push(`${report.tablesMissingGrants.length} tabela(s) sem SELECT/INSERT/UPDATE/DELETE`);
    if (report.sequencesMissingUsage.length) failures.push(`${report.sequencesMissingUsage.length} sequence(s) sem USAGE`);
    if (!tables) failures.push('nenhuma tabela visível no schema public');
    if (failures.length) {
      console.error(`Papel do banco reprovado: ${failures.join('; ')}.`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('Falha ao conferir o papel do banco:', error?.code || error?.message);
  process.exitCode = 2;
} finally {
  await client.end().catch(() => {});
}
