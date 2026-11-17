import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAudit, PICOMATCH_EXCEPTION } from '../scripts/audit-dependencies.mjs';

const now = new Date('2026-11-17T18:00:00Z');
function fixture() {
  const vulnerabilities = {
    picomatch: { name: 'picomatch', severity: 'high', nodes: ['node_modules/picomatch'], via: [
      { name: 'picomatch', severity: 'high', url: PICOMATCH_EXCEPTION.advisory }
    ] },
    tinyglobby: { name: 'tinyglobby', severity: 'high', nodes: ['node_modules/tinyglobby'], via: ['picomatch'] },
    vite: { name: 'vite', severity: 'high', nodes: ['node_modules/vite'], via: ['picomatch', 'tinyglobby'] }
  };
  const report = { auditReportVersion: 2, vulnerabilities, metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 3, critical: 0 }
  } };
  const lock = { packages: {
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/tinyglobby': { version: '0.2.17', dev: true },
    'node_modules/vite': { version: '8.3.4', dev: true }
  } };
  return { report, lock };
}

test('audit allows only the acknowledged development advisory and its inherited build-tool findings', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluateAudit(report, lock, { now }).blocking, []);
  assert.deepEqual(evaluateAudit(report, lock, { now }).excepted, ['picomatch', 'tinyglobby', 'vite']);
});

test('audit blocks the same advisory as soon as any affected package is a production dependency', () => {
  for (const name of ['picomatch', 'tinyglobby', 'vite']) {
    const { report, lock } = fixture();
    delete lock.packages[`node_modules/${name}`].dev;
    assert.ok(evaluateAudit(report, lock, { now }).blocking.includes(name));
  }
});

test('audit blocks different versions, unknown installed paths and duplicated production installations', () => {
  const { report, lock } = fixture();
  lock.packages['node_modules/picomatch'].version = '4.0.6';
  assert.equal(evaluateAudit(report, lock, { now }).blocking.length, 3);
  lock.packages['node_modules/picomatch'].version = '4.0.7';
  report.vulnerabilities.picomatch.nodes.push('node_modules/other/node_modules/picomatch');
  assert.equal(evaluateAudit(report, lock, { now }).blocking.length, 3);
  lock.packages['node_modules/other/node_modules/picomatch'] = { version: '4.0.7', dev: false };
  assert.equal(evaluateAudit(report, lock, { now }).blocking.length, 3);
});

test('audit blocks a newly reported high advisory on an otherwise excepted package', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.via.push({ name: 'picomatch', severity: 'high', url: 'https://github.com/advisories/GHSA-new' });
  assert.equal(evaluateAudit(report, lock, { now }).blocking.length, 3);
});

test('audit blocks high findings from another package or another branch of the inherited dependency chain', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.other = { name: 'other', severity: 'high', nodes: ['node_modules/other'], via: [
    { name: 'other', severity: 'high', url: 'https://github.com/advisories/GHSA-new' }
  ] };
  lock.packages['node_modules/other'] = { version: '1.0.0', dev: true };
  report.metadata.vulnerabilities.high++;
  report.vulnerabilities.vite.via.push('other');
  assert.deepEqual(evaluateAudit(report, lock, { now }).blocking, ['vite', 'other']);
});

test('audit never applies the exception to a critical finding', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.severity = 'critical';
  report.metadata.vulnerabilities.high--;
  report.metadata.vulnerabilities.critical++;
  assert.equal(evaluateAudit(report, lock, { now }).blocking.length, 3);
});

test('audit automatically blocks the exception at its expiry date', () => {
  const { report, lock } = fixture();
  const result = evaluateAudit(report, lock, { now: new Date(PICOMATCH_EXCEPTION.expiresAt) });
  assert.equal(result.blocking.length, 3);
  assert.equal(result.exceptionIsCurrent, false);
});

test('audit rejects registry failures, malformed reports and missing or inconsistent findings', () => {
  const { report, lock } = fixture();
  for (const invalid of [{ error: { code: 'ENOTFOUND' } }, {}, { ...report, metadata: {} }]) {
    assert.throws(() => evaluateAudit(invalid, lock, { now }), /inválido/);
  }
  const inconsistent = structuredClone(report);
  delete inconsistent.vulnerabilities.picomatch;
  assert.throws(() => evaluateAudit(inconsistent, lock, { now }), /inconsistentes/);
  report.vulnerabilities.vite.via = ['missing'];
  assert.ok(evaluateAudit(report, lock, { now }).blocking.includes('vite'));
});
