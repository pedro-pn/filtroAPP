// Local, disposable PostgreSQL and file storage for redesign verification.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { startLocalSmtp } from './local-smtp.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.dirname(backendRoot);
const local = dotenv.config({ path: process.env.REDESIGN_LOCAL_ENV || path.join(backendRoot, '.env.docker.local'), quiet: true }).parsed || {};
for (const key of Object.keys(process.env)) {
  if (/^(SMTP_|OMIE_|PONTOMAIS_|ZAPSIGN_|SURVEY_.*EMAIL|MS_GRAPH_|OUTLOOK_)/.test(key)) delete process.env[key];
}
const base = new URL(process.env.REDESIGN_DATABASE_BASE_URL || local.DATABASE_URL || '');
if (base.hostname === 'postgres') base.hostname = '127.0.0.1';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Validation requires a local PostgreSQL server.');
const database = `filtrovali_redesign_validation_${Date.now()}_${process.pid}`;
const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
const databaseUrl = new URL(base); databaseUrl.pathname = `/${database}`;
const workDir = path.join(repositoryRoot, 'output/validation', database);
await mkdir(workDir, { recursive: true });
await cp(path.join(backendRoot, 'assets'), path.join(workDir, 'assets'), { recursive: true });
const smtp = await startLocalSmtp(workDir);
const port = Number(process.env.REDESIGN_API_PORT || 4310);
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: databaseUrl.href, PORT: String(port),
  ASSETS_DIR: path.join(workDir, 'assets'), REPORTS_DIR: path.join(workDir, 'reports'), UPLOAD_DIR: path.join(workDir, 'uploads'),
  APP_URL: 'http://127.0.0.1:4210', ALLOWED_ORIGIN: 'http://127.0.0.1:4210',
  BACKGROUND_JOBS_IN_API: 'false', SEND_CLIENT_EMAILS: 'false', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_SECURE: 'false', SMTP_AUTH_MODE: 'password', SMTP_USER: 'validation', SMTP_PASS: 'validation', SMTP_FROM: 'validation@example.invalid', PRIVACY_NOTIFICATION_EMAIL: 'privacy@example.invalid',
  SURVEY_TOKEN_SECRET: randomUUID() + randomUUID(), SIGNATURE_TOKEN_SECRET: randomUUID() + randomUUID(),
  API_CREDENTIAL_CURSOR_HMAC_KEY: randomUUID() + randomUUID(), RESOURCE_LIST_CACHE_TTL_MS: '0', DASHBOARD_CACHE_TTL_MS: '0'
});
process.env.REDESIGN_WORK_DIR = workDir;
if (process.env.REDESIGN_LIBREOFFICE_BINARY) process.env.LIBREOFFICE_BINARY = process.env.REDESIGN_LIBREOFFICE_BINARY;
else if (spawnSync('soffice', ['--version']).status === 0) process.env.LIBREOFFICE_BINARY = 'soffice';
else {
  const image = spawnSync('docker', ['inspect', 'filtrovali-local-backend', '--format', '{{.Image}}'], { encoding: 'utf8' });
  if (image.status !== 0) throw new Error('Configure REDESIGN_LIBREOFFICE_BINARY or a local backend Docker image with LibreOffice.');
  process.env.REDESIGN_CONVERTER_IMAGE = image.stdout.trim();
  process.env.LIBREOFFICE_BINARY = path.join(backendRoot, 'scripts/validation/redesign-soffice.mjs');
}
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: backendRoot, env: process.env, encoding: 'utf8' });
if (migration.status !== 0) throw new Error(`Validation migration failed: ${migration.stderr}`);
const { default: prisma } = await import('../../src/lib/prisma.js');
const { hashPassword } = await import('../../src/lib/password.js');
const password = randomUUID();
const passwordHash = await hashPassword(password);
const fullRoles = [['RDO','RDO_MANAGER'], ['QUALIDADE','QUALIDADE_MANAGER'], ['EPI','EPI_TECHNICIAN'], ['PRIVACY','PRIVACY_ADMIN'], ['ROMANEIO','ROMANEIO_MANAGER'], ['ACOMPANHAMENTO','ACOMPANHAMENTO_MANAGER'], ['EFETIVO','EFETIVO_MANAGER'], ['EQUIPAMENTOS','EQUIPAMENTOS_MANAGER'], ['ESTOQUE','ESTOQUE_MANAGER'], ['ASSINATURAS','ASSINATURAS_USER']];
const user = await prisma.user.create({ data: { username: 'redesign_admin', name: 'Admin Validação', passwordHash, role: 'MANAGER', accountType: 'ADMIN', notifyReportsByEmail: false, reportEmissionPermissions: ['SITE_RDO', 'MAINTENANCE', 'PRODUCTION'], moduleRoles: { create: fullRoles.map(([module,role]) => ({ module, role })) } } });
const jobRole = await prisma.jobRole.create({ data: { name: 'Técnico Validação', normalizedKey: 'TECNICO VALIDACAO' } });
const collaborator = await prisma.collaborator.create({ data: { code: 'VAL-001', name: 'Colaborador Validação', jobRoleId: jobRole.id } });
const project = await prisma.project.create({ data: { code: 'VAL-2026', name: 'Projeto Validação', clientName: 'Cliente Validação', clientCnpj: '12345678000199', contractCode: 'VAL', location: 'Sede Validação', isActive: true } });
const moduleRoles = [ ['RDO','RDO_COORDINATOR'], ['QUALIDADE','QUALIDADE_VIEWER'], ['ACOMPANHAMENTO','ACOMPANHAMENTO_VIEWER'], ['EFETIVO','EFETIVO_VIEWER'], ['EQUIPAMENTOS','EQUIPAMENTOS_VIEWER'], ['ESTOQUE','ESTOQUE_VIEWER'], ['ROMANEIO','ROMANEIO_OPERATOR'], ['EPI','EPI_COLLABORATOR'] ];
const viewer = await prisma.user.create({ data: { username: 'redesign_viewer', name: 'Leitura Validação', passwordHash, role: 'COORDINATOR', accountType: 'INTERNAL', reportEmissionPermissions: ['SITE_RDO'], collaboratorId: collaborator.id, moduleRoles: { create: moduleRoles.map(([module,role]) => ({ module, role })) } } });
const restricted = await prisma.user.create({ data: { username: 'redesign_restricted', name: 'Sem acesso Validação', passwordHash, role: 'COLLABORATOR', accountType: 'INTERNAL' } });
const client = await prisma.user.create({ data: { username: 'redesign_client', name: 'Cliente Validação', passwordHash, role: 'CLIENT', accountType: 'CLIENT', clientCnpj: project.clientCnpj, privacyPolicyVersion: null, moduleRoles: { create: {module:'RDO',role:'RDO_CLIENT'} } } });
const { createSession } = await import('../../src/lib/auth.js');
const tokens = {};
for (const [key, account] of Object.entries({ admin: user, viewer, restricted, client })) tokens[key] = (await createSession(account.id)).token;
await writeFile(path.join(repositoryRoot, 'output/validation/redesign-fixture.json'), JSON.stringify({ tokens, database, databaseUrl: databaseUrl.href, password, port, workDir, user, viewer, restricted, client, collaborator, project }), { mode: 0o600 });
const { default: app } = await import('../../src/app.js');
const server = app.listen(port, '127.0.0.1', () => console.log(`Validation API on ${port}; isolated database ${database}`));
async function shutdown() { server.close(); smtp.close(); await prisma.$disconnect(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
