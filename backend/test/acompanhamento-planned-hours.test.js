import assert from 'node:assert/strict';
import test from 'node:test';
import { readCommercialHours, resolvePlannedHours, plannedHoursAlerts } from '../src/lib/acompanhamento/planned-hours.js';

const raw = (normal = 100, overtime = 20) => ({
  hh_total: normal + overtime, hh_util_diurno: normal, hh_util_noturno: 0,
  hh_util_extra_diurno: overtime, hh_util_extra_noturno: 0,
  hh_sab_diurno: 0, hh_sab_noturno: 0, hh_dom_diurno: 0, hh_dom_noturno: 0
});
const proposal = (codBd = 1, hours = raw()) => ({ codBd, codProp: 1000 + codBd, nRev: 0, rawRow: hours });
const manual = (normal = 100, extra = 20) => ({ normalHours: [{ hours: normal, collaboratorCount: 5 }], overtime: [{ hours: extra }] });

test('commercial hours preserve decimal totals, sum shifts and classify weekend overtime', () => {
  const result = readCommercialHours({ ...raw(), hh_total: '1.234,50', hh_util_diurno: '1.000,50',
    hh_util_noturno: 100, hh_util_extra_diurno: 50, hh_util_extra_noturno: 20,
    hh_sab_diurno: 24, hh_sab_noturno: 10, hh_dom_diurno: 20, hh_dom_noturno: 10 });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.normal, 1100.5);
  assert.equal(result.overtime, 134);
  assert.equal(result.total, 1234.5);
});

test('absent and zero-only proposals keep manual input available; malformed breakdown cannot replace it', () => {
  for (const data of [{}, raw(0, 0), { hh_total: '' }, { hh_total: null }]) {
    assert.equal(resolvePlannedHours({ ...manual(), sources: [proposal(1, data)] }).hoursPlan.source, 'MANUAL');
  }
  for (const data of [{ hh_total: 120 }, { ...raw(), hh_total: 624 }, { ...raw(), hh_util_noturno: -5 }, { ...raw(), hh_util_diurno: true }]) {
    const result = resolvePlannedHours({ ...manual(), sources: [proposal(1, data)] });
    assert.equal(result.hoursPlan.source, 'MANUAL');
    assert.equal(result.hoursPlan.commercial, null);
    assert.ok(result.hoursPlan.issues.length);
  }
});

test('complete commercial data is automatic without a manual forecast and includes selected additions', () => {
  const result = resolvePlannedHours({ sources: [proposal(), proposal(2, raw(50, 0))] });
  assert.equal(result.hoursPlan.source, 'COMMERCIAL');
  assert.deepEqual(result.hoursPlan.commercial, { normal: 150, overtime: 20, total: 170 });
  assert.equal(result.hoursPlan.pending, false);
  assert.equal(result.normalHours[0].hours, 150);
  assert.equal(result.overtime[0].hours, 20);
});

test('partial additions never silently reduce an existing total forecast', () => {
  const result = resolvePlannedHours({ ...manual(200, 30), sources: [proposal(), proposal(2, {})] });
  assert.equal(result.hoursPlan.source, 'MANUAL');
  assert.equal(result.hoursPlan.commercial, null);
  assert.match(result.hoursPlan.issues.join(' '), /incompleto/);
  assert.equal(result.hoursPlan.manual.total, 230);
});

test('only differences strictly above 10 percent create a pending issue and retain manual hours', () => {
  for (const n of [90, 100, 110]) {
    const result = resolvePlannedHours({ ...manual(n, 20), sources: [proposal()] });
    assert.equal(result.hoursPlan.pending, false);
    assert.equal(result.hoursPlan.source, 'COMMERCIAL');
    assert.equal(result.hoursPlan.manual.normal, n, 'collaboratorCount does not multiply totals');
  }
  for (const n of [89.99, 110.01]) {
    const result = resolvePlannedHours({ ...manual(n, 20), sources: [proposal()] });
    assert.equal(result.hoursPlan.pending, true);
    assert.equal(result.hoursPlan.source, 'MANUAL');
    assert.equal(plannedHoursAlerts(result.hoursPlan)[0].code, 'HORAS_PREVISTAS');
  }
});

test('equal totals cannot hide a divergence between normal and extra hours, including zero denominator', () => {
  const result = resolvePlannedHours({ ...manual(80, 40), sources: [proposal()] });
  assert.equal(result.hoursPlan.manual.total, result.hoursPlan.commercial.total);
  assert.equal(result.hoursPlan.pending, true);
  const zeroExtra = resolvePlannedHours({ ...manual(100, 5), sources: [proposal(1, raw(100, 0))] });
  assert.equal(zeroExtra.hoursPlan.pending, true);
  assert.equal(zeroExtra.hoursPlan.differences[1].percent, null);
});

test('manual and commercial resolutions persist only for the reviewed data, not future revisions', () => {
  const input = { ...manual(200, 20), sources: [proposal()] };
  const initial = resolvePlannedHours(input);
  for (const choice of ['MANUAL', 'COMMERCIAL']) {
    const resolution = { basis: initial.basis, choice, resolvedAt: '2026-09-17', resolvedByUserId: 'manager' };
    const accepted = resolvePlannedHours({ ...input, resolution });
    assert.equal(accepted.hoursPlan.pending, false);
    assert.equal(accepted.hoursPlan.source, choice);
    assert.notEqual(accepted.hoursPlan.fingerprint, initial.hoursPlan.fingerprint);
    assert.equal(plannedHoursAlerts(accepted.hoursPlan).length, 0);
    assert.equal(resolvePlannedHours({ ...input, resolution, sources: [proposal(2)] }).hoursPlan.pending, true);
    assert.equal(resolvePlannedHours({ ...input, resolution, ...manual(250, 20) }).hoursPlan.pending, true);
    assert.equal(resolvePlannedHours({ ...input, resolution, sources: [proposal(1, raw(90, 20))] }).hoursPlan.pending, true);
  }
});

test('resolution fingerprint ignores unrelated import changes and manual row identifiers/order', () => {
  const input = { normalHours: [{ id: 'a', hours: 100 }, { id: 'b', hours: 200 }], sources: [proposal(), proposal(2)] };
  const first = resolvePlannedHours(input);
  const reordered = resolvePlannedHours({ ...input, normalHours: [...input.normalHours].reverse().map(row => ({ ...row, id: 'new' })),
    sources: [...input.sources].reverse().map(source => ({ ...source, rawRow: { ...source.rawRow, nome_cliente: 'Updated' } })) });
  assert.equal(first.hoursPlan.fingerprint, reordered.hoursPlan.fingerprint);
});
