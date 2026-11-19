import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Identificadores gravados por backend/prisma/e2e-seed.js (E2E_SEED_OUTPUT).
export type E2eAccount = { username: string; name: string; email: string; password: string };
export type E2eSeed = {
  accounts: { admin: E2eAccount; collaborator: E2eAccount };
  collaborators: { ana: { id: string; name: string }; bruno: { id: string; name: string } };
  projects: { a: { id: string; code: string; name: string }; b: { id: string; code: string; name: string } };
  reports: { projectBReportId: string };
};

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultSeedFile = path.resolve(here, '../../../../output/e2e-real/seed.json');

let cached: E2eSeed | null = null;

export function e2eSeed(): E2eSeed {
  if (cached) return cached;
  const file = process.env.E2E_SEED_OUTPUT || defaultSeedFile;
  if (!fs.existsSync(file)) {
    throw new Error(`Seed e2e não encontrado em ${file}: rode backend/prisma/e2e-seed.js com E2E_SEED_OUTPUT antes.`);
  }
  cached = JSON.parse(fs.readFileSync(file, 'utf8')) as E2eSeed;
  return cached;
}
