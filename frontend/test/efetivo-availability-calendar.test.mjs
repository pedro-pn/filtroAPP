import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

async function loadCalendar() {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule('/src/utils/availabilityCalendar.ts'); } finally { await server.close(); }
}

test('fadiga offshore aparece na legenda, nos dias e no grupo próprio de disponibilidade', async () => {
  const server = await createServer({
    configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom'
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { AvailabilityBoard } = await server.ssrLoadModule('/src/pages/efetivo/components/AvailabilityBoard.tsx');
    const date = '2026-09-02';
    client.setQueryData(['efetivo-planning-availability', date, date, 'all'], {
      days: [{ date, deficit: 0, shortage: 0 }], roles: [], plannedRisks: [],
      people: [{ id: 'c1', name: 'Ana', role: 'Operadora', jobRoleId: 'r1', days: [{ date, status: 'OFFSHORE_FATIGUE', detail: 'Fadiga - offshore' }] }]
    });
    const render = view => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AvailabilityBoard, {
      date, endDate: date, view, onViewChange() {}
    })));
    const calendar = render('calendar');
    assert.match(calendar, /data-availability-status="OFFSHORE_FATIGUE"><i><\/i>Fadiga - offshore/);
    assert.match(calendar, /aria-label="Ana · 02\/09\/2026 · 1 fadiga - offshore"/);
    assert.match(calendar, /background:linear-gradient\(to right, var\(--warning-text\)/);
    const kanban = render('kanban');
    assert.match(kanban, /data-availability-status="OFFSHORE_FATIGUE"[^]*data-collaborator-id="c1"/);
    assert.match(kanban, /1 dia · Fadiga - offshore/);
  } finally {
    client.clear();
    await server.close();
  }
});

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
