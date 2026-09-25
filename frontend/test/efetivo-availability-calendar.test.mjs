import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadCalendar() {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule('/src/utils/availabilityCalendar.ts'); } finally { await server.close(); }
}

function dates(start, count) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

test('calendário mantém os dias em períodos curtos e condensa semanas sem perder datas', async () => {
  const { buildCalendarBuckets } = await loadCalendar();
  const period = dates('2026-09-24', 30);
  const daily = buildCalendarBuckets(period, 1440);
  assert.equal(daily.scale, 'day');
  assert.equal(daily.buckets.length, 30);

  const weekly = buildCalendarBuckets(period, 800);
  assert.equal(weekly.scale, 'week');
  assert.deepEqual(weekly.buckets.flatMap(bucket => bucket.dates), period);
  assert.ok(weekly.buckets.length <= 5);
});

test('calendário condensa períodos longos por mês e usa semanas no celular', async () => {
  const { buildCalendarBuckets } = await loadCalendar();
  const longPeriod = dates('2026-09-24', 371);
  const monthly = buildCalendarBuckets(longPeriod, 1440);
  assert.equal(monthly.scale, 'month');
  assert.equal(monthly.buckets.length, 13);
  assert.deepEqual(monthly.buckets.flatMap(bucket => bucket.dates), longPeriod);

  const mobile = buildCalendarBuckets(dates('2026-09-24', 30), 390);
  assert.equal(mobile.scale, 'week');
  assert.ok(mobile.buckets.length <= 5);
});
