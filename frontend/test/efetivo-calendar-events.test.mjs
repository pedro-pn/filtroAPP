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
    const { calendarBusyPeopleOnDay } = await server.ssrLoadModule('/src/pages/efetivo/components/calendarDayEvents.ts');
    const { calendarInterval, monthCalendarGrid } = await server.ssrLoadModule('/src/utils/calendarGrid.ts');
    const date = '2026-09-08';
    assert.deepEqual(calendarBusyPeopleOnDay([
      { type: 'MISSION', title: 'Missão A', startDate: date, endDate: date, people: [{ id: 'ana', name: 'Ana', periods: [{ startDate: date, endDate: date }] }, { id: 'bia', name: 'Bia', periods: [{ startDate: '2026-09-09', endDate: '2026-09-09' }] }] },
      { type: 'MISSION', title: 'Missão B', startDate: date, endDate: date, people: [{ id: 'ana', name: 'Ana' }, { id: 'carlos', name: 'Carlos' }] },
      { type: 'FOLGA', title: 'Folga · Dora', startDate: date, endDate: date, people: [{ id: 'dora', name: 'Dora' }] }
    ], date), [
      { id: 'ana', name: 'Ana', missions: ['Missão A', 'Missão B'] },
      { id: 'carlos', name: 'Carlos', missions: ['Missão B'] }
    ]);
    for (const view of ['day', 'week', 'month']) {
      for (const count of [0, 3, 4, 12]) {
        await t.test(`${view}: ${count} atividades`, () => {
          const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
          try {
            const interval = calendarInterval(date, view);
            const days = view === 'month' ? monthCalendarGrid(date) : [interval.startDate, interval.endDate];
            const events = Array.from({ length: count }, (_, index) => ({
              id: `event-${index}`, type: 'MISSION', title: `Atividade ${String(index + 1).padStart(2, '0')}`,
              startDate: date, endDate: date, jobRoleIds: [], entityPath: `/efetivo?section=missoes&missao=${index}`,
              people: index === 0 ? [
                { id: 'ana', name: 'Ana', periods: [{ startDate: date, endDate: date }] },
                { id: 'bia', name: 'Bia', periods: [{ startDate: '2026-09-09', endDate: '2026-09-09' }] }
              ] : []
            }));
            client.setQueryData(['efetivo-planning-calendar', days[0], days.at(-1), 'all'], { events, conflicts: [] });
            const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(OperationalCalendar, {
              date, view, selectedDay: date, dayOpen: false,
              onDayClose() {}, onDateChange() {}, onViewChange() {}, onDaySelect() {}
            })));
            const visibleCount = view === 'day' ? count : Math.min(count, 3);
            assert.equal((html.match(/<small class="type-mission">/g) || []).length, visibleCount);
            for (let index = 0; index < count; index += 1) {
              assert.equal(html.includes(`<span class="efetivo-calendar-event-title">${events[index].title}</span>`), index < visibleCount, events[index].title);
              assert.ok(html.includes(events[index].title), 'o balão contém toda a agenda do dia');
            }
            assert.match(html, /class="efetivo-calendar-tooltip" role="tooltip"/);
            if (count) {
              assert.match(html, /efetivo-calendar-event-people">Ana/);
              assert.match(html, /class="efetivo-calendar-busy"/);
              assert.match(html, /Colaboradores ocupados <strong>1<\/strong>/);
              assert.match(html, /Colaboradores ocupados \(1\)/);
              assert.doesNotMatch(html, />Bia</);
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
