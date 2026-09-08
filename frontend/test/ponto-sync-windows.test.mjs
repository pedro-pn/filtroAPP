import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadModule(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

/*
 * O endpoint de sincronização recusa períodos acima de 31 dias — mesma janela da carga histórica,
 * que reflete o limite prático dos relatórios do Ponto Mais. O gestor pede o intervalo que quiser e
 * o recorte acontece aqui, então é este cálculo que não pode deixar buraco nem repetir dia.
 */
test('recorte em janelas cobre o intervalo inteiro, sem buraco e sem sobreposição', async () => {
  const { pontoMaisSyncWindows, PONTOMAIS_SYNC_WINDOW_DAYS } = await loadModule('/src/api/acompanhamentoPonto.ts');

  const cases = [
    ['2026-08-01', '2026-08-01'],
    ['2026-08-01', '2026-08-31'],
    ['2026-08-01', '2026-09-01'],
    ['2025-06-01', '2026-08-25'],
    ['2026-02-01', '2026-03-15']
  ];

  for (const [start, end] of cases) {
    const windows = pontoMaisSyncWindows(start, end);
    assert.ok(windows.length > 0, `${start}..${end} não gerou janela`);
    assert.equal(windows[0].startDate, start, `${start}..${end} não começa no início pedido`);
    assert.equal(windows[windows.length - 1].endDate, end, `${start}..${end} não termina no fim pedido`);

    for (const window of windows) {
      assert.ok(window.startDate <= window.endDate, `janela invertida em ${start}..${end}`);
      const days = Math.round(
        (Date.parse(`${window.endDate}T00:00:00Z`) - Date.parse(`${window.startDate}T00:00:00Z`)) / 86400000
      ) + 1;
      assert.ok(days <= PONTOMAIS_SYNC_WINDOW_DAYS, `janela de ${days} dias excede o limite do endpoint`);
    }

    // Cada janela começa exatamente no dia seguinte ao fim da anterior.
    for (let index = 1; index < windows.length; index += 1) {
      const previousEnd = Date.parse(`${windows[index - 1].endDate}T00:00:00Z`);
      const currentStart = Date.parse(`${windows[index].startDate}T00:00:00Z`);
      assert.equal(currentStart - previousEnd, 86400000, `descontinuidade em ${start}..${end}`);
    }
  }
});

test('período de um dia vira uma janela e período exato de 31 dias não se parte em duas', async () => {
  const { pontoMaisSyncWindows } = await loadModule('/src/api/acompanhamentoPonto.ts');

  assert.deepEqual(pontoMaisSyncWindows('2026-08-17', '2026-08-17'), [
    { startDate: '2026-08-17', endDate: '2026-08-17' }
  ]);
  assert.equal(pontoMaisSyncWindows('2026-08-01', '2026-08-31').length, 1);
  assert.equal(pontoMaisSyncWindows('2026-08-01', '2026-09-01').length, 2);
});

test('intervalo invertido não gera janela nenhuma em vez de sincronizar ao contrário', async () => {
  const { pontoMaisSyncWindows } = await loadModule('/src/api/acompanhamentoPonto.ts');
  assert.deepEqual(pontoMaisSyncWindows('2026-08-31', '2026-08-01'), []);
});

test('o recorte atravessa virada de ano e fevereiro sem perder dia', async () => {
  const { pontoMaisSyncWindows } = await loadModule('/src/api/acompanhamentoPonto.ts');

  const windows = pontoMaisSyncWindows('2025-12-15', '2026-03-10');
  const total = windows.reduce((sum, window) => sum + Math.round(
    (Date.parse(`${window.endDate}T00:00:00Z`) - Date.parse(`${window.startDate}T00:00:00Z`)) / 86400000
  ) + 1, 0);
  const expected = Math.round(
    (Date.parse('2026-03-10T00:00:00Z') - Date.parse('2025-12-15T00:00:00Z')) / 86400000
  ) + 1;
  assert.equal(total, expected);
});
