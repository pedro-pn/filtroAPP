import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

test('grade mensal usa datas civis UTC e sempre contém 42 posições', async () => {
  const calendar = await load('/src/utils/calendarGrid.ts');
  const days = calendar.monthCalendarGrid('2026-08-21');
  assert.equal(days.length, 42);
  assert.equal(days.includes('2026-08-21'), true);
  assert.deepEqual(calendar.calendarInterval('2026-08-21', 'week'), { startDate: '2026-08-17', endDate: '2026-08-23' });
  assert.equal(calendar.addDateOnlyDays('2026-10-31', 1), '2026-11-01');
});

test('navegação de mês não sofre overflow de dia 31', async () => {
  const calendar = await load('/src/utils/calendarGrid.ts');
  assert.equal(calendar.moveCalendarPosition('2026-01-31', 'month', 1), '2026-02-01');
});

test('exibição tolera DateTime do Prisma sem deslocar a data civil', async () => {
  const calendar = await load('/src/utils/calendarGrid.ts');
  assert.equal(calendar.displayDateOnly('2025-07-04T15:00:00.000Z'), '04/07/2025');
});
