import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const lineBudgets = new Map([
  ['backend/src/routes/resources/reports.js', 7497],
  ['frontend/src/pages/gestor/GestorPage.tsx', 4581],
  ['frontend/src/pages/ReportDetailPage.tsx', 2082],
  ['frontend/src/pages/collaborator/NewReportPage.tsx', 1702]
]);

const allowedRootLibFiles = new Set([
  'allocation-monthly-report.js',
  'async-handler.js',
  'auth.js',
  'calibration-certificates.js',
  'calibration-reminders.js',
  'client-access-reset.js',
  'client-account.js',
  'client-project-access.js',
  'cnpj.js',
  'data-retention.js',
  'data-subject-requests.js',
  'email-templates.js',
  'epi-docx.js',
  'equipment-attachments.js',
  'equipment-attributes.js',
  'equipment-categories.js',
  'equipment-compat.js',
  'equipment-notifications.js',
  'equipment-technical-doc.js',
  'equipment-technical-docx.js',
  'equipment-technical-seed.js',
  'equipment-units.js',
  'inhibition-options.js',
  'internal-report-signatures.js',
  'mailer.js',
  'module-roles.js',
  'notification-preferences.js',
  'overtime.js',
  'password.js',
  'pdf-link-annotations.js',
  'performance-logging.js',
  'prisma-url.js',
  'prisma.js',
  'privacy-consent.js',
  'project-visibility.js',
  'qr-code.js',
  'rate-limit.js',
  'rdo-equipment-slots.js',
  'report-collaborators.js',
  'report-docx.js',
  'report-equipment-resolve.js',
  'report-filename.js',
  'report-pdf-from-docx.js',
  'report-pdf.js',
  'report-rcp.js',
  'report-rlf.js',
  'report-rli.js',
  'report-rlm.js',
  'report-rlq.js',
  'report-rtp.js',
  'report-upload-attachments.js',
  'resource-list-cache.js',
  'romaneio-catalog-pdf.js',
  'romaneio-catalog.js',
  'romaneio-docx.js',
  'signature-image.js',
  'signature-reminders.js',
  'signature-token.js',
  'stored-image.js',
  'survey-mail.js',
  'survey-reminders.js',
  'survey-token.js',
  'transient-upload-access.js',
  'ttl-cache.js',
  'zapsign-legacy-reconciliation.js',
  'zapsign.js',
  'zod-error.js'
]);

const allowedLegacyRouteImports = new Map();
const allowedLegacyRouteExports = new Map();

const failures = [];

function repoPath(...segments) {
  return path.join(repoRoot, ...segments);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function read(filePath) {
  return fs.readFileSync(repoPath(filePath), 'utf8');
}

function lineCount(content) {
  const lines = content.split(/\r?\n/);
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
}

function walkFiles(dir, predicate, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, files);
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkLineBudgets() {
  for (const [filePath, maxLines] of lineBudgets) {
    const count = lineCount(read(filePath));
    if (count > maxLines) {
      failures.push(`${filePath} tem ${count} linhas; limite atual: ${maxLines}. Extraia codigo antes de crescer este arquivo.`);
    }
  }
}

function checkRootLibFiles() {
  const libDir = repoPath('backend/src/lib');
  const files = fs.readdirSync(libDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name);

  for (const fileName of files) {
    if (!allowedRootLibFiles.has(fileName)) {
      failures.push(`Novo arquivo solto em backend/src/lib/${fileName}. Codigo de dominio novo deve ir para backend/src/lib/<modulo>/.`);
    }
  }
}

function importedNames(importClause) {
  const named = importClause.match(/\{([^}]+)\}/);
  if (!named) return [];
  return named[1]
    .split(',')
    .map(item => item.trim().split(/\s+as\s+/i)[0]?.trim())
    .filter(Boolean);
}

function checkServerRouteImports() {
  const serverPath = 'backend/src/server.js';
  const server = read(serverPath);
  const importPattern = /import\s+([^;\n]+?)\s+from\s+['"]([^'"]*routes\/[^'"]+)['"];?/g;
  let match;
  while ((match = importPattern.exec(server))) {
    const [, clause, target] = match;
    const allowedNames = allowedLegacyRouteImports.get(target);
    const names = importedNames(clause);
    const isAllowed = allowedNames
      && names.length > 0
      && names.every(name => allowedNames.has(name));

    if (!isAllowed) {
      failures.push(`${serverPath} importa de ${target}. Jobs e boot devem depender de backend/src/lib, nao de rotas.`);
    }
  }
}

function checkRouteJobExports() {
  const routeFiles = walkFiles(
    repoPath('backend/src/routes'),
    filePath => filePath.endsWith('.js')
  );
  const exportPattern = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]*(?:Job|Queue|Schedule|Processing)[A-Za-z0-9_]*)/g;

  for (const absolutePath of routeFiles) {
    const relativePath = toPosix(path.relative(repoRoot, absolutePath));
    const allowedNames = allowedLegacyRouteExports.get(relativePath) || new Set();
    const source = fs.readFileSync(absolutePath, 'utf8');
    let match;
    while ((match = exportPattern.exec(source))) {
      const name = match[1];
      if (!allowedNames.has(name)) {
        failures.push(`${relativePath} exporta ${name}. Jobs/fila devem viver em backend/src/lib/<modulo>/jobs.js.`);
      }
    }
  }
}

checkLineBudgets();
checkRootLibFiles();
checkServerRouteImports();
checkRouteJobExports();

if (failures.length) {
  console.error('Architecture check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Architecture check passed.');
