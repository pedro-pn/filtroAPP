import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

test('calendário diário mostra toda a agenda; semana e mês preservam o resumo', async t => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { OperationalCalendar } = await server.ssrLoadModule('/src/pages/efetivo/components/OperationalCalendar.tsx');
    const { calendarInterval, monthCalendarGrid } = await server.ssrLoadModule('/src/utils/calendarGrid.ts');
    const date = '2026-09-08';
    for (const view of ['day', 'week', 'month']) {
      for (const count of [0, 3, 4, 12]) {
        await t.test(`${view}: ${count} atividades`, () => {
          const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
          try {
            const interval = calendarInterval(date, view);
            const days = view === 'month' ? monthCalendarGrid(date) : [interval.startDate, interval.endDate];
            const events = Array.from({ length: count }, (_, index) => ({
              id: `event-${index}`, type: 'MISSION', title: `Atividade ${String(index + 1).padStart(2, '0')}`,
              startDate: date, endDate: date, jobRoleIds: [], entityPath: `/efetivo?section=missoes&missao=${index}`
            }));
            client.setQueryData(['efetivo-planning-calendar', days[0], days.at(-1), 'all'], { events, conflicts: [] });
            const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(OperationalCalendar, {
              date, view, selectedDay: date, dayOpen: false,
              onDayClose() {}, onDateChange() {}, onViewChange() {}, onDaySelect() {}
            })));
            const visibleCount = view === 'day' ? count : Math.min(count, 3);
            assert.equal((html.match(/<small class="type-mission">/g) || []).length, visibleCount);
            for (let index = 0; index < count; index += 1) {
              assert.equal(html.includes(events[index].title), index < visibleCount, events[index].title);
            }
            const hiddenCount = count - visibleCount;
            if (hiddenCount) assert.ok(html.includes(`+${hiddenCount} eventos`));
            else assert.doesNotMatch(html, /<small>\+\d+ eventos<\/small>/);
          } finally {
            client.clear();
          }
        });
      }
    }
  } finally {
    await server.close();
  }
});
