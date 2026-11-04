import { expect, test, type Page } from '@playwright/test';

// Conferência semanal de alocação (feature 037). API simulada: nenhuma chamada sai do navegador.

const WEEK = '2026-10-26';
const DATES = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const projects = [
  { id: 'p5620', code: '5620', name: 'Thyssenkrupp Laminação', clientName: 'Thyssenkrupp', clientCnpj: '37.981.316/0001-11', isActive: true },
  { id: 'p5484', code: '5484', name: 'Missão 5484', clientName: 'Thyssenkrupp', clientCnpj: '37.981.316/0001-11', isActive: true },
  { id: 'p5812', code: '5812', name: 'Barra Mansa ETA', clientName: 'Barra Mansa', clientCnpj: '40.202.969/0001-60', isActive: true }
];

type State = 'confirms' | 'diverges' | 'none';

function day(date: string, value: { kind: string; projectIds: string[] }, extra: Partial<Record<string, unknown>> = {}, states: [State, State, State] = ['confirms', 'confirms', 'confirms']) {
  const weekend = date === '2026-10-31' || date === '2026-11-01';
  return {
    date, eligible: true, isFuture: false, isWeekend: weekend, isHoliday: false,
    suggestion: value, value, saved: false, edited: false, note: null,
    pending: false, pendingReason: null, reasons: [],
    sources: {
      ponto: { state: states[0], normalHours: weekend ? 0 : 8.8, he70Hours: 0, he100Hours: 0, tags: value.projectIds.length ? [projects.find(p => p.id === value.projectIds[0])?.code || ''] : [] },
      rdo: { state: states[1], reports: value.kind === 'PROJECT' ? [{ reportId: `r-${date}`, number: 1300, projectId: value.projectIds[0], status: 'APPROVED' }] : [] },
      efetivo: { state: states[2], projectIds: value.projectIds },
      manualProjectIds: [],
      absence: null
    },
    candidateProjectIds: value.projectIds,
    sourceChangedAfterReview: false,
    absenceAlert: false,
    ...extra
  };
}

const project = (id: string) => ({ kind: 'PROJECT', projectIds: [id] });
const folga = { kind: 'FOLGA', projectIds: [] };

function rows() {
  const ana = DATES.map((date, index) => day(date, index < 5 ? project('p5620') : folga, {}, index < 5 ? ['confirms', 'confirms', 'confirms'] : ['confirms', 'none', 'none']));
  const bruno = DATES.map((date, index) => day(date, index < 5 ? project('p5620') : folga, {}, index < 5 ? ['confirms', 'confirms', 'confirms'] : ['confirms', 'none', 'none']));
  bruno[2] = day(DATES[2], project('p5620'), {
    pending: true, pendingReason: 'DIVERGENCE',
    reasons: ['A etiqueta do ponto aponta para outro projeto.', 'O planejamento do Efetivo previa outra alocação.'],
    candidateProjectIds: ['p5620', 'p5484'],
    sources: {
      ponto: { state: 'diverges', normalHours: 8.8, he70Hours: 1, he100Hours: 0, tags: ['5484'] },
      rdo: { state: 'confirms', reports: [{ reportId: 'r-x', number: 1342, projectId: 'p5620', status: 'APPROVED' }] },
      efetivo: { state: 'diverges', projectIds: ['p5484'] },
      manualProjectIds: [],
      absence: null
    }
  });
  const caio = DATES.map((date, index) => day(date, index < 5 ? project('p5812') : folga, {}, index < 5 ? ['confirms', 'confirms', 'confirms'] : ['confirms', 'none', 'none']));
  caio[3] = day(DATES[3], { kind: 'NONE', projectIds: [] }, { pending: true, pendingReason: 'NO_INFORMATION', reasons: ['Dia útil sem ponto, sem RDO e sem ausência cadastrada.'] }, ['none', 'none', 'none']);
  const make = (id: string, name: string, role: string, days: ReturnType<typeof day>[], main: string) => ({
    collaborator: { id, name, jobRole: role }, mainProjectId: main, confirmed: false, confirmedAt: null, confirmedByUserId: null,
    pendingCount: days.filter(item => item.pending).length, canConfirm: days.every(item => !item.pending), days
  });
  return [
    make('c-ana', 'Ana Teixeira', 'Supervisora de campo', ana, 'p5620'),
    make('c-bruno', 'Bruno Cavalcanti', 'Técnico de filtração', bruno, 'p5620'),
    make('c-caio', 'Caio Menezes', 'Técnico de filtração', caio, 'p5812')
  ];
}

function weekResponse() {
  return {
    week: { weekStart: WEEK, weekEnd: DATES[6], status: 'OPEN', version: 2, closedAt: null, closedBy: null, ended: true, canClose: false, closeBlockers: ['Faltam 3 colaboradores para conferir.'], canReopen: false },
    days: DATES.map((date, index) => ({ date, weekday: WEEKDAYS[index], isWeekend: index > 4, isHoliday: false, holidayName: null, isFuture: false })),
    summary: { agreeDays: 19, divergenceDays: 1, noInformationDays: 1, editedDays: 0, confirmedRows: 0, totalRows: 3, readyRows: 1 },
    rows: rows(),
    projects
  };
}

function monthResponse() {
  const days = Array.from({ length: 31 }, (_, index) => {
    const date = `2026-10-${String(index + 1).padStart(2, '0')}`;
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return { date, weekday: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][weekday], isWeekend: weekday === 0 || weekday === 6, isHoliday: false, holidayName: null, isFuture: false };
  });
  const mondayOf = (date: string) => {
    const value = new Date(`${date}T00:00:00.000Z`);
    const offset = (value.getUTCDay() + 6) % 7;
    return new Date(value.getTime() - offset * 86400000).toISOString().slice(0, 10);
  };
  const kinds = ['p5620', 'p5620', 'TRAVEL', 'SEDE', 'FERIAS'];
  const row = (id: string, name: string, offset: number) => ({
    collaborator: { id, name, jobRole: 'Técnico de filtração' },
    pendingCount: offset === 1 ? 1 : 0,
    totals: [{ kind: 'PROJECT', projectId: 'p5620', days: 14 }, { kind: 'FOLGA', projectId: null, days: 9 }, { kind: 'SEDE', projectId: null, days: 4 }],
    days: days.map((meta, index) => {
      const pick = kinds[(index + offset) % kinds.length];
      const value = meta.isWeekend ? { kind: 'FOLGA', projectIds: [] }
        : pick === 'TRAVEL' ? { kind: 'TRAVEL', projectIds: ['p5812'] }
        : pick.startsWith('p') ? { kind: 'PROJECT', projectIds: [pick] } : { kind: pick, projectIds: [] };
      const pending = offset === 1 && index === 27;
      return { date: meta.date, eligible: true, isFuture: false, value: pending ? { kind: 'NONE', projectIds: [] } : value, pending, pendingReason: pending ? 'NO_INFORMATION' : null, edited: false, confirmed: index < 25, weekStart: mondayOf(meta.date) };
    })
  });
  return {
    month: { yearMonth: '2026-10', first: '2026-10-01', last: '2026-10-31' },
    weeks: ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((weekStart, index) => ({
      weekStart, weekEnd: new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10),
      status: index < 4 ? 'CLOSED' : 'OPEN', ended: true, confirmedRows: index < 4 ? 3 : 0, totalRows: 3, pendingDays: index < 4 ? 0 : 2
    })),
    days,
    rows: [row('c-ana', 'Ana Teixeira', 0), row('c-bruno', 'Bruno Cavalcanti', 1), row('c-caio', 'Caio Menezes', 2)],
    projects
  };
}

async function mockApi(page: Page, moduleRoles: string[]) {
  const unexpected: string[] = [];
  const writes: Array<{ method: string; path: string; version: string | undefined; body: unknown }> = [];
  const user = {
    id: 'u-review', username: 'alocacao', name: 'Equipe Alocação', email: 'alocacao@example.com',
    role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles, reportEmissionPermissions: [], isActive: true
  };
  await page.addInitScript(() => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-allocation-review-token');
    localStorage.setItem('filtrovali-theme', 'light');
    // O tutorial de novidade é validado à parte; aqui ele já foi visto para não cobrir a tela.
    localStorage.setItem('filtrovali:allocation-review-novelty:v1:u-review', '1');
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() !== 'GET') {
      writes.push({ method: request.method(), path, version: request.headers()['if-match-version'], body: request.postDataJSON() });
      return json({ version: 3, rows: weekResponse().rows });
    }
    if (path === '/api/auth/me') return json({ user });
    if (path === `/api/efetivo/conferencia-alocacao/semanas/${WEEK}`) return json(weekResponse());
    if (path === '/api/efetivo/conferencia-alocacao/meses/2026-10') return json(monthResponse());
    if (path.startsWith('/api/efetivo/conferencia-alocacao/semanas/')) {
      const other = weekResponse();
      const weekStart = path.split('/').pop() || WEEK;
      return json({ ...other, week: { ...other.week, weekStart } });
    }
    if (path === '/api/efetivo/conferencia-alocacao/pendencias/contagem') return json({ openWeeks: [{ weekStart: WEEK }], absenceAlertsOpen: 0 });
    if (path.startsWith('/api/notifications')) return json({ items: [], criticalItems: [], unreadCount: 0, snapshotAt: new Date().toISOString(), nextCursor: null });
    unexpected.push(`GET ${path}`);
    return json({});
  });
  return { unexpected, writes };
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test('quem só confere alocação abre direto a Conferência e não chama APIs do resto do Efetivo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { unexpected } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto('/efetivo');
  await expect(page.getByRole('heading', { name: 'Conferência', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Alocação da semana por colaborador' })).toBeVisible();
  await expect(page.locator('.allocation-review-week__label')).toContainText('26/10 a 01/11/2026');
  await expect(page.getByRole('button', { name: 'Ver tutorial' })).toHaveCount(0);
  expect(unexpected.filter(item => item.includes('/efetivo') || item.includes('/workforce'))).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/desktop-grid.png', fullPage: true });
});

test('corrigir um dia divergente envia a versão atual e a escolha', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { writes } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('button', { name: /Bruno Cavalcanti, 28\/10: .*pendente/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Bruno Cavalcanti' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('As fontes não batem')).toBeVisible();
  await expect(dialog.getByText('etiqueta “5484”')).toBeVisible();
  await page.screenshot({ path: '../output/playwright/allocation-review/desktop-panel.png' });
  await dialog.getByRole('radio', { name: /5484 · Missão 5484/ }).check();
  await dialog.getByText('Qui 29/10').click();
  await dialog.getByRole('button', { name: 'Confirmar escolha' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ method: 'PUT', path: `/api/efetivo/conferencia-alocacao/semanas/${WEEK}/dias`, version: '2' });
  expect((writes[0].body as { items: unknown[] }).items).toEqual([
    { collaboratorId: 'c-bruno', date: '2026-10-28', kind: 'PROJECT', projectIds: ['p5484'], note: null },
    { collaboratorId: 'c-bruno', date: '2026-10-29', kind: 'PROJECT', projectIds: ['p5484'], note: null }
  ]);
});

test('"Outro projeto" sem projeto marca o campo em vermelho', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { writes } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('button', { name: /Caio Menezes, 29\/10: Sem informação/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Caio Menezes' });
  await dialog.getByRole('radio', { name: 'Outro projeto…', exact: true }).check();
  await dialog.getByRole('button', { name: 'Confirmar escolha' }).click();
  await expect(dialog.locator('.field-invalid')).toBeVisible();
  await expect(dialog.getByText('Escolha o projeto.')).toBeVisible();
  expect(writes).toEqual([]);
});

test('seleção múltipla e conferir linhas sem pendência', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { writes } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('button', { name: /Ana Teixeira, 26\/10/ }).first().click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: /Ana Teixeira, 27\/10/ }).first().click({ modifiers: ['Shift'] });
  await expect(page.getByRole('region', { name: 'Ações para os dias selecionados' })).toContainText('2 dias selecionados');
  await page.getByRole('region', { name: 'Ações para os dias selecionados' }).getByRole('button', { name: 'Sede' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0].body as { items: Array<{ kind: string }> }).items.map(item => item.kind)).toEqual(['SEDE', 'SEDE']);
  await page.getByRole('button', { name: 'Conferir linhas sem pendência (1)' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ path: `/api/efetivo/conferencia-alocacao/semanas/${WEEK}/linhas/conferir`, body: { allReady: true } });
});

test('no celular a grade vira cards, sem rolagem horizontal da página', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await expect(page.locator('.allocation-review-card').first()).toBeVisible();
  await expect(page.locator('.allocation-review-table-wrap')).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/mobile-cards.png', fullPage: true });
  await page.getByRole('button', { name: 'Selecionar dias' }).click();
  await page.locator('.allocation-review-card').first().getByRole('button', { name: /26\/10/ }).click();
  await expect(page.getByRole('region', { name: 'Ações para os dias selecionados' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Concluir seleção' }).click();
  await page.locator('.allocation-review-card').nth(1).getByRole('button', { name: /28\/10/ }).click();
  await expect(page.getByRole('dialog', { name: 'Bruno Cavalcanti' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/mobile-panel.png' });
});

test('"Por nome" é o padrão e vem antes de "Por projeto"', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  const group = page.getByRole('group', { name: 'Agrupar' }).getByRole('button');
  await expect(group.nth(0)).toHaveText('Por nome');
  await expect(group.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(group.nth(1)).toHaveText('Por projeto');
  await expect(page.locator('.allocation-review-table__group')).toHaveCount(0);
  await group.nth(1).click();
  await expect(page).toHaveURL(/agrupar=proj/);
  await expect(page.locator('.allocation-review-table__group').first()).toBeVisible();
});

test('o cabeçalho dos dias fica fixo ao rolar a tabela para baixo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 460 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  const wrap = page.locator('.allocation-review-table-wrap');
  await wrap.scrollIntoViewIfNeeded();
  const scrolled = await wrap.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
  expect(scrolled).toBeGreaterThan(0);
  const offset = await page.evaluate(() => {
    const container = document.querySelector('.allocation-review-table-wrap')!.getBoundingClientRect();
    const header = document.querySelector('.allocation-review-table thead th:nth-child(2)')!.getBoundingClientRect();
    return Math.round(header.top - container.top);
  });
  expect(Math.abs(offset)).toBeLessThanOrEqual(2);
  await expect(page.locator('.allocation-review-table thead th').nth(1)).toBeInViewport();
});

test('visão do mês mostra o mês inteiro e abre a semana ao clicar num dia', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('group', { name: 'Visão' }).getByRole('button', { name: 'Mês' }).click();
  await expect(page).toHaveURL(/visao=mes/);
  const table = page.getByRole('table', { name: 'Alocação do mês por colaborador' });
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(33);
  await expect(page.getByRole('list', { name: 'Semanas do mês' }).getByRole('button')).toHaveCount(5);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/desktop-month.png', fullPage: true });
  await table.getByRole('button', { name: /Bruno Cavalcanti, 28\/10/ }).click();
  await expect(page).toHaveURL(/semana=2026-10-26/);
  await expect(page).not.toHaveURL(/visao=mes/);
  await expect(page.getByRole('table', { name: 'Alocação da semana por colaborador' })).toBeVisible();
});

test('visão do mês no celular vira calendário por colaborador', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&visao=mes&mes=2026-10`);
  await expect(page.locator('.allocation-review-month-calendar').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/mobile-month.png', fullPage: true });
});
