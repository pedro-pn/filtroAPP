import { test, expect } from '@playwright/test';
import checkDetail from '../test/browser/project-detail-performance.js';
import { detail } from '../test/fixtures/project-detail.mjs';

const manager = '/test/browser/gestor-project-search.html';
const project = '/test/browser/project-detail-performance.html';

test('Gestor lê somente as fontes da aba e adia os painéis pesados', async ({ page }) => {
  const errors = [];
  const scripts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto(manager + '?tab=pendentes');
  await expect(page.getByRole('heading', { name: 'Relatórios pendentes', exact: true })).toBeVisible();
  const reads = () => page.evaluate(() => window.gestorReadRequests);
  await expect.poll(async () => (await reads()).some(row => row.url.endsWith('/reports'))).toBe(true);
  expect((await reads()).filter(row => /bootstrap\/gestor|\/users$|\/surveys$/.test(row.url))).toEqual([]);
  expect(scripts.filter(url => /StatsDashboard\.tsx|SurveyDashboard\.tsx|LegacyReportsUploadModal\.tsx|HistoricalServicesModal\.tsx/.test(url))).toEqual([]);
  for (const [label, section] of [['Projetos', 'projetos'], ['Equipe', 'equipe'], ['Usuários', 'usuarios'], ['NPS', 'nps']]) {
    await page.getByRole('link', { name: label, exact: true }).last().click();
    await expect.poll(async () => (await reads()).some(row => row.url.endsWith('/bootstrap/gestor') && row.params?.section === section)).toBe(true);
  }
  await page.getByRole('link', { name: 'Estatísticas', exact: true }).last().click();
  await expect.poll(async () => (await reads()).some(row => row.url.endsWith('/statistics/overview'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Estatísticas', exact: true })).toBeVisible();
  expect((await reads()).filter(row => row.url.endsWith('/bootstrap/gestor')).every(row => row.params?.section)).toBe(true);
  expect(scripts.some(url => /StatsOverview\.tsx/.test(url))).toBe(true);
  expect(scripts.some(url => /StatsDashboard\.tsx/.test(url))).toBe(false);
  expect(scripts.some(url => /SurveyDashboard\.tsx/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('formulário adiado mantém foco, Escape e retorno ao botão de abertura', async ({ page }) => {
  const scripts = [];
  page.on('request', request => scripts.push(request.url()));
  await page.goto(manager + '?tab=projetos');
  const open = page.getByRole('button', { name: 'Novo projeto', exact: true });
  await expect(open).toBeVisible();
  expect(scripts.some(url => /ProjectEditDialog\.tsx/.test(url))).toBe(false);
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Número da missão', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await expect(dialog.getByLabel('Número da missão', { exact: true })).toBeFocused();
});

test('detalhe limita polling, histórico, recortes, retry e gravação concorrente', async ({ page }) => {
  await page.goto(project);
  const result = await checkDetail(page);
  expect(result.errors).toEqual([]);
  expect(result.hiddenPolling).toBe(false);
  expect(result.concurrentWriteRecovered).toBe(true);
});

test('gravação em outro contexto aparece pelo polling sem repetir histórico estável', async ({ browser, baseURL }) => {
  let revision = 1;
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const calls = [[], []];
  try {
    for (const [index, context] of contexts.entries()) await context.route(url => url.pathname.startsWith('/api/'), async route => {
      const request = route.request();
      const url = new URL(request.url());
      let data = [];
      if (request.method() === 'PUT') { revision++; data = { status: 'APPROVED' }; }
      else if (url.pathname.endsWith('/detalhe')) {
        const mode = url.searchParams.get('progress') || 'full';
        calls[index].push({ mode, revision });
        data = { ...structuredClone(detail), avancoPct: 50 + revision,
          progressBreakdown: { hasScope: true, progressPct: 50 + revision, services: [] },
          progressReadMode: mode, progressRevision: `r${revision}`, progressFilters: null,
          ...(mode === 'current' ? { progressHistory: undefined, dailyProgressHistory: undefined } : {}) };
      } else if (url.pathname.endsWith('/divisoes')) data = { divisions: [], candidates: [] };
      else if (url.pathname.endsWith('/metas-semanais')) data = { targets: [], workdays: [1, 2, 3, 4, 5], serviceHistory: [], attendanceHistory: [] };
      else if (url.pathname.endsWith('/planning-context')) data = { collaborators: [] };
      await route.fulfill({ json: data });
    });
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of pages) { await page.clock.install(); await page.goto(project + '?network=1'); }
    await expect.poll(() => calls[1].filter(row => row.mode === 'history').length).toBe(1);
    await pages[1].clock.runFor(31_000);
    expect(calls[1].filter(row => row.mode === 'history')).toHaveLength(1);
    await pages[0].evaluate(() => window.writePerformanceReport());
    await pages[1].clock.runFor(15_000);
    await expect.poll(() => calls[1].some(row => row.mode === 'history' && row.revision === 2)).toBe(true);
    await expect(pages[1].locator('[data-acp-meeting-kpi="scope"]')).toContainText('52');
    expect(calls[1].filter(row => row.mode === 'history')).toHaveLength(2);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('conteúdo em cache e atualização em segundo plano geram fases distintas', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('filtro:page-performance', 'true'));
  await page.goto('/test/browser/useful-content.html?cache=1');
  await expect(page.getByText('Conteúdo em cache', { exact: true })).toBeVisible();
  const samples = () => page.evaluate(() => window.filtroPagePerformance.read().samples);
  await expect.poll(async () => (await samples()).length).toBe(1);
  expect((await samples())[0]).toMatchObject({ source: 'cache', phase: 'content-visible', refreshing: true });
  await page.evaluate(() => window.finishUsefulQuery());
  await expect.poll(async () => (await samples()).length).toBe(2);
  expect((await samples())[1]).toMatchObject({ source: 'network', phase: 'refresh-complete', refreshing: false });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.finishUsefulQuery());
  await expect.poll(async () => (await samples()).length).toBe(3);
  expect((await samples()).filter(row => row.phase === 'content-visible')).toHaveLength(1);
  expect((await samples()).every(row => row.durationMs >= 0)).toBe(true);
});

test('carga sem cache só é medida com conteúdo visível; coleta é opcional', async ({ page }) => {
  await page.goto('/test/browser/useful-content.html');
  expect(await page.evaluate(() => window.filtroPagePerformance)).toBeUndefined();
  await page.addInitScript(() => sessionStorage.setItem('filtro:page-performance', 'true'));
  await page.reload();
  const samples = () => page.evaluate(() => window.filtroPagePerformance.read().samples);
  await expect(page.getByText('Carregando…', { exact: true })).toBeVisible();
  expect(await samples()).toEqual([]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.finishUsefulQuery();
  });
  await expect(page.getByText('Conteúdo atualizado', { exact: true })).toBeVisible();
  expect(await samples()).toEqual([]);
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await samples()).length).toBe(1);
  expect((await samples())[0]).toMatchObject({ source: 'network', phase: 'content-visible', refreshing: false });
});

test('nova navegação com os mesmos dados visíveis produz uma nova marca de cache', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('filtro:page-performance', 'true'));
  await page.goto('/test/browser/useful-content.html');
  await page.waitForFunction(() => typeof window.finishUsefulQuery === 'function');
  await page.evaluate(() => window.finishUsefulQuery());
  const samples = () => page.evaluate(() => window.filtroPagePerformance.read().samples);
  await expect.poll(async () => (await samples()).length).toBe(1);
  expect((await samples())[0].source).toBe('network');
  await page.getByRole('button', { name: 'Outra navegação', exact: true }).click();
  await expect.poll(async () => (await samples()).length).toBe(2);
  expect((await samples())[1]).toMatchObject({ source: 'cache', phase: 'content-visible', refreshing: false });
});

test('PDF antigo não antecipa serviços históricos e a troca de aba preserva a edição', async ({ page }) => {
  const scripts = [], errors = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(manager + '?tab=pendentes');
  await page.getByRole('button', { name: 'Abrir upload de relatórios antigos', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'PDFs antigos', exact: true })).toBeVisible();
  expect(scripts.some(url => /HistoricalServicesModal\.tsx/.test(url))).toBe(false);
  expect(await page.evaluate(() => window.gestorReadRequests.some(row => row.url.includes('/historical-services/')))).toBe(false);
  await dialog.getByRole('tab', { name: 'Serviços históricos', exact: true }).click();
  const history = dialog.locator('#legacy-upload-panel-services');
  await history.getByLabel('Projeto', { exact: true }).selectOption('active-villaris');
  await expect.poll(() => page.evaluate(() => window.gestorReadRequests.filter(row => row.url.includes('/historical-services/')).length)).toBe(1);
  await history.getByRole('button', { name: 'Adicionar relatório', exact: true }).click();
  await history.getByLabel('Número', { exact: true }).fill('123');
  await dialog.getByRole('tab', { name: 'PDFs antigos', exact: true }).click();
  await expect(history).toBeHidden();
  await dialog.getByRole('tab', { name: 'Serviços históricos', exact: true }).click();
  await expect(history.getByLabel('Número', { exact: true })).toHaveValue('123');
  expect(await page.evaluate(() => window.gestorReadRequests.filter(row => row.url.includes('/historical-services/')).length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
