export default async page => {
  const fixture = new URL('/test/browser/project-detail-performance.html', page.url()).href;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  const reads = () => page.evaluate(() => window.projectDetailPerformance.reads);
  const count = (rows, mode) => rows.filter(row => row.mode === mode).length;
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const waitFor = (mode, revision) => page.waitForFunction(({ mode, revision }) =>
    window.projectDetailPerformance.reads.some(row => row.mode === mode && row.revision === revision), { mode, revision });
  const scope = () => page.locator('[data-acp-meeting-kpi="scope"]');
  await page.goto(fixture);
  await waitFor('history', 1);
  await page.waitForFunction(() => !document.body.textContent.includes('Carregando metas…'));
  const initial = await reads();
  check(count(initial, 'current') === 1 && count(initial, 'history') === 1 && count(initial, 'full') === 0, 'Carga inicial excessiva: ' + JSON.stringify(initial));
  check(initial.find(row => row.mode === 'history').fields === 'progress', 'Histórico solicitou o detalhe completo');
  await page.clock.runFor(31_000);
  const unchanged = await reads();
  check(count(unchanged, 'current') >= 3, 'Resumo não foi atualizado em 15 segundos');
  check(count(unchanged, 'history') === 1 && count(unchanged, 'full') === 0, 'Histórico recalculado sem alteração das fontes');
  await scope().click();
  await waitFor('full', 1);
  await page.locator('[data-acp-meeting-detail="scope"]').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.evaluate(() => { window.projectDetailPerformance.revision = 2; });
  await page.clock.runFor(15_000);
  await waitFor('history', 2);
  check(!(await reads()).some(row => row.mode === 'full' && row.revision === 2), 'Recortes carregados com o painel fechado');
  await scope().click();
  await waitFor('full', 2);
  await page.evaluate(() => { window.projectDetailPerformance.revision = 3; });
  await page.clock.runFor(15_000);
  await waitFor('full', 3);
  check(!(await reads()).some(row => row.mode === 'history' && row.revision === 3), 'Histórico duplicado com o pacote completo aberto');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenBefore = (await reads()).length;
  await page.clock.runFor(31_000);
  check((await reads()).length === hiddenBefore, 'Polling executado com a aba oculta');
  await page.evaluate(() => {
    delete document.visibilityState;
    window.dispatchEvent(new Event('visibilitychange'));
    window.projectDetailPerformance.revision = 4;
    window.projectDetailPerformance.failMode = 'full';
  });
  await page.clock.runFor(15_000);
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o histórico' }).waitFor();
  await page.evaluate(() => { window.projectDetailPerformance.failMode = ''; });
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o histórico' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    window.projectDetailPerformance.revision = 5;
    window.projectDetailPerformance.changeDuringRead = true;
  });
  await page.clock.runFor(15_000);
  await waitFor('current', 6);
  await waitFor('full', 6);
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o histórico' }).waitFor({ state: 'hidden' });
  await page.getByLabel('Escopo', { exact: true }).selectOption('scope-a');
  await page.locator('[data-acp-meeting-detail="scope"]').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.evaluate(() => { window.projectDetailPerformance.revision = 7; });
  await page.clock.runFor(15_000);
  await waitFor('full', 7);
  await page.waitForFunction(() => document.querySelector('[data-acp-meeting-kpi="scope"]').textContent.includes('32'));
  check(!(await reads()).some(row => row.mode === 'history' && row.revision === 7), 'Filtro visível no resumo deve conservar seu recorte ao fechar o painel');
  const currentProjectReads = await reads();
  check(currentProjectReads.filter(row => row.mode !== 'current').every(row => row.fields === 'progress'), 'Recortes solicitaram campos alheios ao avanço');

  await page.goto(fixture + '?group=1');
  await waitFor('history', 1);
  await page.clock.runFor(31_000);
  const groupReads = await reads();
  check(count(groupReads, 'current') >= 3 && count(groupReads, 'history') === 1 && count(groupReads, 'full') === 0, 'Grupo repetiu histórico durante polling');
  check(groupReads.find(row => row.mode === 'history').fields === 'progress', 'Histórico do grupo solicitou o detalhe completo');
  await scope().click();
  await waitFor('full', 1);

  await page.goto(fixture + '?legacy=1');
  await page.locator('[data-acp-meeting-summary]').waitFor();
  await scope().click();
  check((await reads()).every(row => row.mode === 'current'), 'Contrato antigo disparou uma consulta adicional');
  check(errors.length === 0, JSON.stringify(errors));
  return { initial, unchanged, currentProjectReads, groupReads, legacyCompatible: true, hiddenPolling: false, failedReadRetried: true, concurrentWriteRecovered: true, selectedSliceKeptWhileClosed: true, errors };
}
