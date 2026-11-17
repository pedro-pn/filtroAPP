import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Acknowledged build-tool risk, not a claim that the dependency is patched.
// Revisit when upstream publishes a fix; expiry restores the blocking gate.
export const PICOMATCH_EXCEPTION = Object.freeze({
  package: 'picomatch',
  version: '4.0.7',
  advisory: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  expiresAt: '2026-12-01T00:00:00.000Z'
});

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const highOrCritical = value => severities.indexOf(value) >= severities.indexOf('high');

export function evaluateAudit(report, lock, { now = new Date() } = {}) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities
    || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)
    || !report.metadata?.vulnerabilities || !lock?.packages || !Number.isFinite(now.getTime())) {
    throw new Error('Relatório de auditoria ou lockfile inválido; a verificação não pode ser ignorada.');
  }
  const counts = Object.fromEntries(severities.map(severity => [severity, 0]));
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (vulnerability?.name !== name || !severities.includes(vulnerability.severity)
      || !Array.isArray(vulnerability.via) || !Array.isArray(vulnerability.nodes) || !vulnerability.nodes.length) {
      throw new Error(`Relatório de auditoria inválido para ${name}.`);
    }
    counts[vulnerability.severity]++;
  }
  for (const severity of severities) {
    if (counts[severity] !== report.metadata.vulnerabilities[severity]) {
      throw new Error('Contagens da auditoria inconsistentes; a verificação não pode ser ignorada.');
    }
  }

  const expiresAt = new Date(PICOMATCH_EXCEPTION.expiresAt);
  const exceptionIsCurrent = now < expiresAt;
  const devOnly = vulnerability => vulnerability.nodes.every(node => lock.packages[node]?.dev === true);
  function covered(name, ancestors = new Set()) {
    const vulnerability = report.vulnerabilities[name];
    if (!vulnerability || ancestors.has(name)) return false;
    if (!highOrCritical(vulnerability.severity)) return true;
    if (vulnerability.severity !== 'high' || !devOnly(vulnerability) || !vulnerability.via.length) return false;
    const nextAncestors = new Set(ancestors).add(name);
    return vulnerability.via.every(via => {
      if (typeof via === 'string') return covered(via, nextAncestors);
      if (!via || !severities.includes(via.severity)) return false;
      if (!highOrCritical(via.severity)) return true;
      return exceptionIsCurrent && via.severity === 'high'
        && name === PICOMATCH_EXCEPTION.package && via.name === name
        && via.url === PICOMATCH_EXCEPTION.advisory
        && vulnerability.nodes.every(node => lock.packages[node]?.version === PICOMATCH_EXCEPTION.version);
    });
  }
  const blocking = [];
  const excepted = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!highOrCritical(vulnerability.severity)) continue;
    (covered(name) ? excepted : blocking).push(name);
  }
  return { blocking, excepted, exceptionIsCurrent };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--report' || !args[1])) {
    throw new Error('Uso: node scripts/audit-dependencies.mjs [--report caminho.json]');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const reportPath = resolve(root, args[1] || '../audit-reports/frontend-audit.json');
  const result = spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
    cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 10 * 1024 * 1024
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, result.stdout || '');
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`A consulta npm audit falhou: ${result.error?.message || result.stderr || result.signal || result.status}`);
  }
  const report = JSON.parse(result.stdout);
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const evaluation = evaluateAudit(report, lock);
  if (evaluation.excepted.length) {
    console.warn(`Exceção temporária: ${PICOMATCH_EXCEPTION.advisory}, somente picomatch ${PICOMATCH_EXCEPTION.version} em dependências de desenvolvimento, até ${PICOMATCH_EXCEPTION.expiresAt}.`);
    console.warn(`Cadeia afetada: ${evaluation.excepted.join(', ')}. O relatório original foi preservado em ${reportPath}.`);
  }
  if (evaluation.blocking.length) {
    if (!evaluation.exceptionIsCurrent) console.error('A exceção temporária do picomatch venceu.');
    throw new Error(`Auditoria bloqueada: ${evaluation.blocking.join(', ')}.`);
  }
  console.log('Auditoria aprovada pela política: nenhum alerta high/critical fora da exceção temporária.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
