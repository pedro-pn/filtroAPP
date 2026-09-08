import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { apiValidationError } from '../../shared/schemas/api-validation-messages.js';
import { makeApiCredentialSchemas } from '../../shared/schemas/api-credentials.js';
import { makeReductionFormSchema, makeActionConfirmationSchema } from '../../shared/schemas/api-credential-lifecycle.js';
import { makePlaygroundParameterSchema } from '../../shared/schemas/playground-parameters.js';

const parseOptions = { error: apiValidationError };
const schemas = makeApiCredentialSchemas(z, { allowLocalDateTime: true });
const valid = { name: 'Integração', purpose: 'Consultar registros', recipientName: 'Equipe', startsAt: '2026-09-08T12:00', expiresAt: '2027-01-01T12:00', scopeCodes: ['qualidade.registros.read'], projectAccess: { mode: 'ALL', projectIds: [] }, allowedIpCidrs: [], allowedFormats: ['JSON'], limits: { requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000, maxPageSize: 100 } };
const english = /Too small|Too big|Invalid|Expected|expected|received|Unrecognized|characters|undefined|NaN/;

test('RHF shows Portuguese messages for empty and short identity fields', async () => {
  const resolver = zodResolver(schemas.create, parseOptions);
  const result = await resolver({ ...valid, name: '', purpose: ' ', recipientName: '' }, {}, { fields: {}, shouldUseNativeValidation: false });
  for (const field of ['name', 'purpose', 'recipientName']) assert.equal(result.errors[field].message, 'Preencha este campo.');
  const short = await resolver({ ...valid, name: 'a', recipientName: 'a', purpose: 'curta' }, {}, { fields: {}, shouldUseNativeValidation: false });
  assert.equal(short.errors.name.message, 'Informe pelo menos 3 caracteres.');
  assert.equal(short.errors.recipientName.message, 'Informe pelo menos 2 caracteres.');
  assert.equal(short.errors.purpose.message, 'Informe pelo menos 10 caracteres.');
});

test('creation and rotation localize types, bounds, dates, scopes, projects and IPs', () => {
  for (const patch of [
    { name: undefined }, { recipientName: 'x'.repeat(121) }, { startsAt: '' }, { expiresAt: 'invalid' },
    { projectAccess: { mode: 'BAD', projectIds: [] } }, { projectAccess: { mode: 'SELECTED', projectIds: [] } },
    { scopeCodes: [] }, { allowedIpCidrs: ['a'] }, { allowedIpCidrs: ['invalid'] },
    ...[NaN, -1, 1.5, 601].map(requestsPerMinute => ({ limits: { ...valid.limits, requestsPerMinute } }))
  ]) {
    for (const [schema, input] of [[schemas.create, { ...valid, ...patch }], [schemas.rotate, { replacement: { ...valid, ...patch }, reason: 'Renovar integração', expectedVersion: 1, revokePreviousAt: valid.startsAt }]]) {
      const result = schema.safeParse(input, parseOptions);
      assert.equal(result.success, false);
      for (const issue of result.error.issues) assert.doesNotMatch(issue.message, english);
    }
  }
  assert.equal(schemas.create.safeParse(valid, parseOptions).success, true);
});

test('reduction and action confirmations retain Portuguese business messages', () => {
  const credential = { ...valid, version: 1 };
  const reduce = makeReductionFormSchema(z, credential);
  const result = reduce.safeParse({ ...valid, expectedVersion: 1, reason: '', limits: { ...valid.limits, maxPageSize: NaN } }, parseOptions);
  assert.equal(result.success, false);
  for (const issue of result.error.issues) assert.doesNotMatch(issue.message, english);
  for (const action of ['rotate', 'revoke']) {
    const invalid = makeActionConfirmationSchema(z, action).safeParse({ reason: 'Motivo de teste', confirmation: '', ...(action === 'rotate' ? { overlapMinutes: NaN } : {}) }, parseOptions);
    assert.equal(invalid.success, false);
    assert.ok(invalid.error.issues.some(issue => issue.message === `Digite ${action === 'rotate' ? 'ROTACIONAR' : 'REVOGAR'} para confirmar.`));
    for (const issue of invalid.error.issues) assert.doesNotMatch(issue.message, english);
  }
});

test('generic test parameters have no English fallback, including numeric and boolean inputs', async () => {
  const schema = makePlaygroundParameterSchema(z, [{ name: 'limit', type: 'integer', required: true }, { name: 'active', type: 'boolean', required: true }, { name: 'id', type: 'string', required: true }]);
  const result = await zodResolver(schema, parseOptions)({ limit: 'abc', active: 'maybe', id: '' }, {}, { fields: {}, shouldUseNativeValidation: false });
  for (const field of ['limit', 'active', 'id']) { assert.ok(result.errors[field]); assert.doesNotMatch(result.errors[field].message, english); }
});

test('Portuguese fallback is scoped and never echoes rejected values or unknown keys', () => {
  assert.match(z.string().min(3).safeParse('').error.issues[0].message, /Too small/);
  const result = z.object({ mode: z.enum(['ALL', 'SELECTED']) }).strict().safeParse({ mode: 'Bearer ficticio', 'private@example.com': true }, parseOptions);
  for (const issue of result.error.issues) assert.doesNotMatch(issue.message, /Bearer|private@example|ALL|SELECTED|Invalid|Unrecognized/);
});
