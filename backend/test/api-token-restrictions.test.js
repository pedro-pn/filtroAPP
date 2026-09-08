import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignedCursor, readSignedCursor } from '../src/lib/api-credentials/cursor.js';
import { isIpAllowed, normalizeCidrs, resolveEffectiveClientIp } from '../src/lib/api-credentials/restrictions.js';

const cursorKey = 'cursor-test-key-with-more-than-thirty-two-characters';

test('CIDRs are normalized and match IPv4, IPv6 and IPv4-mapped addresses', () => {
  assert.deepEqual(normalizeCidrs(['10.0.0.1/8', '2001:0db8::1/32']), ['10.0.0.0/8', '2001:db8::/32']);
  assert.equal(isIpAllowed('10.2.3.4', ['10.0.0.0/8']), true);
  assert.equal(isIpAllowed('::ffff:10.2.3.4', ['10.0.0.0/8']), true);
  assert.equal(isIpAllowed('192.168.1.1', ['10.0.0.0/8']), false);
  assert.equal(isIpAllowed('2001:db8::a', ['2001:db8::/32']), true);
  assert.throws(() => normalizeCidrs(['10.0.0.0/99']), /CIDR/);
});

test('effective client IP comes from Express trust-proxy resolution, never a raw forwarded header', () => {
  assert.equal(resolveEffectiveClientIp({ ip: '203.0.113.8', headers: { 'x-forwarded-for': '198.51.100.3' } }), '203.0.113.8');
  assert.equal(resolveEffectiveClientIp({ socket: { remoteAddress: '::ffff:10.0.0.8' }, headers: { 'x-forwarded-for': '198.51.100.3' } }), '10.0.0.8');
});

test('signed cursors preserve snapshot and tuple while binding operation and filters', () => {
  const payload = {
    operationId: 'qualidade.registros.list', version: 1,
    filters: { projectId: 'p1', status: ['OPEN'] },
    position: { updatedAt: '2026-09-04T12:00:00.000Z', id: 'r9' },
    snapshotAt: '2026-09-04T12:30:00.000Z'
  };
  const cursor = createSignedCursor({ payload, key: cursorKey });
  const decoded = readSignedCursor({ cursor, key: cursorKey, operationId: payload.operationId, filters: payload.filters });
  assert.deepEqual(decoded.position, payload.position);
  assert.equal(decoded.snapshotAt, payload.snapshotAt);
  assert.throws(() => readSignedCursor({ cursor, key: cursorKey, operationId: payload.operationId, filters: { projectId: 'p2' } }), /cursor/i);
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => readSignedCursor({ cursor: tampered, key: cursorKey, operationId: payload.operationId, filters: payload.filters }), /cursor/i);
});
