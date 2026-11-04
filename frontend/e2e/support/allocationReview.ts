import { expect, type Page } from '@playwright/test';

// Fixtures da Conferência semanal de alocação (feature 037): API simulada, nenhuma chamada sai do navegador.

export const WEEK = '2026-10-26';
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

export function weekResponse(copies = 1) {
  return {
    week: { weekStart: WEEK, weekEnd: DATES[6], status: 'OPEN', version: 2, closedAt: null, closedBy: null, ended: true, canClose: false, closeBlockers: ['Faltam 3 colaboradores para conferir.'], canReopen: false },
    days: DATES.map((date, index) => ({ date, weekday: WEEKDAYS[index], isWeekend: index > 4, isHoliday: false, holidayName: null, isFuture: false })),
    summary: { agreeDays: 19, divergenceDays: 1, noInformationDays: 1, editedDays: 0, confirmedRows: 0, totalRows: 3, readyRows: 1 },
    rows: Array.from({ length: copies }, (_, copy) => rows().map(row => (copy ? {
      ...row,
      collaborator: { ...row.collaborator, id: `${row.collaborator.id}-${copy}`, name: `${row.collaborator.name} ${copy + 1}` }
    } : row))).flat(),
    projects
  };
}

export function monthResponse() {
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

export async function mockApi(page: Page, moduleRoles: string[], { weekCopies = 1 }: { weekCopies?: number } = {}) {
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
    if (path === `/api/efetivo/conferencia-alocacao/semanas/${WEEK}`) return json(weekResponse(weekCopies));
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

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

