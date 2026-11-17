import assert from 'node:assert/strict';
import test from 'node:test';
import { complianceStatusAt } from '../src/lib/conecta-rh/schema.js';

const record = { status: 'VALID', issuedOn: null, expiresOn: '2026-11-16', hasNoExpiry: false };

test('conformidade com emissão desconhecida respeita o vencimento inclusive', () => {
  assert.equal(complianceStatusAt(record, '2026-11-15'), 'VALID');
  assert.equal(complianceStatusAt(record, '2026-11-16'), 'VALID');
  assert.equal(complianceStatusAt(record, '2026-11-17'), 'EXPIRED');
});

test('item sem vencimento não exige data de emissão', () => {
  assert.equal(complianceStatusAt({ ...record, expiresOn: null, hasNoExpiry: true }, '2026-11-17'), 'VALID');
});

test('consulta anterior ao vencimento recalcula um item publicado como vencido', () => {
  assert.equal(complianceStatusAt({ ...record, status: 'EXPIRED' }, '2026-11-16'), 'VALID');
  assert.equal(complianceStatusAt({ ...record, status: 'EXPIRED' }, '2026-11-17'), 'EXPIRED');
});

test('pendência e validade desconhecida não são promovidas por datas ou hasNoExpiry', () => {
  for (const status of ['PENDING', 'UNKNOWN']) {
    assert.equal(complianceStatusAt({ ...record, status, issuedOn: '2026-01-01' }, '2026-11-16'), status);
    assert.equal(complianceStatusAt({ ...record, status, expiresOn: null, hasNoExpiry: true }, '2026-11-16'), status);
  }
});

test('emissão futura permanece pendente e revogação prevalece sobre datas', () => {
  assert.equal(complianceStatusAt({ ...record, issuedOn: '2026-11-18', expiresOn: '2027-11-18' }, '2026-11-16'), 'PENDING');
  assert.equal(complianceStatusAt({ ...record, status: 'REVOKED', issuedOn: '2026-11-18' }, '2026-11-16'), 'REVOKED');
});

test('ausência de validade sem declaração de isenção continua desconhecida', () => {
  assert.equal(complianceStatusAt({ ...record, expiresOn: null }, '2026-11-16'), 'UNKNOWN');
});
