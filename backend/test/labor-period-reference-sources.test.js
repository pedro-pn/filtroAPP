import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import env from '../src/config/env.js';
import { loadLaborPeriodReferences } from '../src/lib/acompanhamento/labor-period-reference-sources.js';
import { clearDerivedReadCaches, withDerivedReadVersion } from '../src/lib/operations/derived-read-cache.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';

const range = { startDate: '2026-09-01', endDate: '2026-09-30', includeIgnoredNames: true };
function source() {
  const queries = [];
  const database = { $queryRaw: async (strings, ...values) => {
    const sql = Prisma.sql(strings, ...values);
    queries.push(sql);
    const ignored = [{ externalEmployeeId: 'ignored', ...(sql.values[0] ? { externalName: 'Nome sintético' } : {}) }];
    if (sql.text.includes('WorkforceHoliday')) return [{ ignored, revision: 7,
      holidays: [{ id: 'manual', holidayDate: '2026-09-02', name: 'Feriado sintético' }] }];
    return [{ ignored }];
  } };
  return { database, queries };
}

test('financial references retain ignored identities/names without reading calendar tables or resolving holidays', async () => {
  const { database, queries } = source();
  const result = await loadLaborPeriodReferences(database, { ...range, includeWorkforceDetails: false });
  assert.deepEqual(result, { ignoredEmployees: [{ externalEmployeeId: 'ignored', externalName: 'Nome sintético' }], calendar: null });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /PontoExternalEmployee/);
  assert.doesNotMatch(queries[0].text, /WorkforceHoliday|WorkforceCalendarState/);
  assert.deepEqual(queries[0].values, [true]);
});

test('complete references retain the default calendar rules, revision, manual holidays and bound dates', async () => {
  const { database, queries } = source();
  const result = await loadLaborPeriodReferences(database, range);
  assert.equal(result.calendar.revision, 7);
  assert.ok(result.calendar.holidayDates.has('2026-09-02'));
  assert.ok(result.calendar.holidayDates.has('2026-09-07'));
  assert.match(queries[0].text, /WorkforceHoliday/);
  assert.match(queries[0].text, /WorkforceCalendarState/);
  assert.deepEqual(queries[0].values, [true, new Date('2026-09-01'), new Date('2026-09-30')]);
});

test('complete and reduced references stay separate in one request and in the verified cross-request cache', async t => {
  const previous = env.acompanhamentoReferenceCacheEnabled;
  env.acompanhamentoReferenceCacheEnabled = true;
  clearDerivedReadCaches();
  t.after(() => { env.acompanhamentoReferenceCacheEnabled = previous; clearDerivedReadCaches(); });
  for (const order of [[false, true], [true, false]]) {
    const { database, queries } = source();
    const read = details => loadLaborPeriodReferences(database, { ...range, includeWorkforceDetails: details });
    const request = loader => requestSourceContext({ method: 'GET' }, null, () => withDerivedReadVersion('v1', loader));
    await request(async () => {
      for (const details of order) {
        const result = await read(details);
        assert.equal(result.calendar?.revision ?? null, details ? 7 : null);
      }
    });
    assert.equal(queries.length, 2);
    await request(async () => {
      for (const details of [...order].reverse()) {
        assert.equal((await read(details)).calendar?.revision ?? null, details ? 7 : null);
      }
    });
    assert.equal(queries.length, 2, 'Each variant may reuse only its own verified packet');
    await requestSourceContext({ method: 'GET' }, null, () => withDerivedReadVersion('v2', () => read(true)));
    assert.equal(queries.length, 3, 'A source revision still invalidates the complete variant');
  }
});

test('reduced references preserve ignored-query failures and reject invalid periods', async () => {
  const database = { $queryRaw: async () => { throw new Error('ignored source unavailable'); } };
  await assert.rejects(loadLaborPeriodReferences(database, { ...range, includeWorkforceDetails: false }), /ignored source unavailable/);
  const invalid = { $queryRaw: () => assert.fail('Invalid periods must not query the database') };
  await assert.rejects(loadLaborPeriodReferences(invalid, { ...range, startDate: range.endDate, endDate: range.startDate,
    includeWorkforceDetails: false }), /fim do calendário/);
});
