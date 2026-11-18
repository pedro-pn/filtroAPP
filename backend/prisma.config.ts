import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js'
  },
  datasource: {
    // A CLI (migrate deploy, db execute) usa o dono das tabelas quando
    // MIGRATION_DATABASE_URL existir; o runtime da API/worker não lê este arquivo
    // e conecta com DATABASE_URL (papel restrito, veja deploy/db/app-role.sql).
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || ''
  }
});
