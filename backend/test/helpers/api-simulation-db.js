import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Schema completo + Prisma real + gatilhos reais, somente em PostgreSQL WASM
// descartável. Nenhum acesso ao DATABASE_URL da aplicação.
export async function apiSimulationDatabase() {
  const db = new PGlite();
  const schema = execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff',
    '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024
  });
  await db.exec(schema);
  const migration = await readFile(new URL('../../prisma/migrations/20261028160000_omni_phase2/migration.sql', import.meta.url), 'utf8');
  await db.exec(`INSERT INTO "IntegrationEventSequence" (id, value) VALUES (1, 0);`);
  await db.exec(migration.slice(migration.indexOf('CREATE FUNCTION integration_emit')));
  await db.exec('ALTER TABLE "ApiCredential" DROP COLUMN "writeMode"; ALTER TABLE "ApiRequestLog" DROP COLUMN "simulated"; DROP TYPE "ApiWriteMode";');
  await db.exec(await readFile(new URL('../../prisma/migrations/20261029120000_api_write_simulation/migration.sql', import.meta.url), 'utf8'));

  const deliveryB = await readFile(new URL('../../prisma/migrations/20261029160000_omni_delivery_b/migration.sql', import.meta.url), 'utf8');
  await db.exec(deliveryB.slice(deliveryB.indexOf('-- Funções/gatilhos da Entrega B.')));

  // PrismaPg mantém suas conversões de tipos; somente o transporte pg usa WASM.
  class WasmPool extends pg.Pool {
    async query(query, values) {
      const config = typeof query === 'string' ? { text: query, values } : query;
      const parsers = config.types ? Object.fromEntries(Object.values(pg.types.builtins)
        .map(oid => [oid, config.types.getTypeParser(oid, 'text')])) : undefined;
      const result = await db.query(config.text, config.values || [], { rowMode: config.rowMode, parsers });
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    }
    async connect() {
      const connection = new EventEmitter();
      connection.query = this.query.bind(this);
      connection.release = () => {};
      return connection;
    }
  }
  const pool = new WasmPool();
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  return { db, client, async close() { await client.$disconnect(); await pool.end(); await db.close(); } };
}
