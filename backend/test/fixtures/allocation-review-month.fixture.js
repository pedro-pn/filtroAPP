// Fixture sem banco: respeita os intervalos das consultas para comparar o mês com leituras
// semanais independentes, incluindo admissões, desligamentos e viagens entre semanas.
export function createReviewMonthFixture({ delayMs = 0 } = {}) {
  const date = key => new Date(`${key}T00:00:00.000Z`);
  const keyOf = value => value.toISOString().slice(0, 10);
  const calls = {};
  const read = async (name, value) => {
    calls[name] = (calls[name] || 0) + 1;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    return value;
  };
  const collaborators = [
    { id: 'c1', name: 'Ana', isActive: true, admissionDate: null, terminationDate: null, jobRole: { name: 'Técnica', isActive: true, isOperational: true } },
    { id: 'c2', name: 'Bia', isActive: true, admissionDate: date('2026-11-12'), terminationDate: null, jobRole: { name: 'Técnica', isActive: true, isOperational: true } },
    { id: 'c3', name: 'Caio', isActive: false, admissionDate: null, terminationDate: date('2026-11-04'), jobRole: { name: 'Técnico', isActive: true, isOperational: true } },
    { id: 'c4', name: 'Davi', isActive: true, admissionDate: null, terminationDate: null, jobRole: { name: 'Administrativo', isActive: true, isOperational: false } }
  ];
  const projects = [
    { id: 'p1', code: '5601', name: 'Projeto A', isActive: true, deletedAt: null },
    { id: 'p2', code: '5602', name: 'Projeto B', isActive: true, deletedAt: null },
    { id: 'old', code: '5500', name: 'Arquivado', isActive: false, deletedAt: date('2026-11-10') },
    { id: 'sede', code: '5000', name: 'Sede', isActive: true, deletedAt: null }
  ];
  const reports = [
    ['2026-10-30', 'p1', 'c1'], ['2026-11-02', 'p1', 'c1'],
    ['2026-11-09', 'p2', 'c4'], ['2026-11-13', 'p2', 'c2'],
    ['2026-11-23', 'old', 'c1'], ['2026-12-07', 'p2', 'c1']
  ].map(([day, projectId, collaboratorId], index) => ({
    id: `r${index}`, sequenceNumber: index + 1, status: 'APPROVED', projectId,
    reportDate: date(day), collaborators: [{ collaboratorId }]
  }));
  const trails = new Map([['c1', new Map([
    ['2026-10-30', { tags: ['5601'], tagProjectIds: ['p1'] }],
    ['2026-11-01', { tags: ['Sede/Em viagem'], tagProjectIds: ['sede'] }],
    ['2026-11-02', { tags: ['5601'], tagProjectIds: ['p1'] }],
    ['2026-11-23', { tags: ['5500'], tagProjectIds: ['old'] }],
    ['2026-12-06', { tags: ['Em viagem'], tagProjectIds: [] }],
    ['2026-12-07', { tags: ['5602'], tagProjectIds: ['p2'] }]
  ].map(([day, value]) => [day, { date: day, normalHours: 8.8, he70Hours: 0, he100Hours: 0, ...value }]))]]);
  const overrides = [{ collaboratorId: 'c1', workDate: date('2026-11-18'), projectId: 'p2' }];
  const absences = [
    { id: 'a1', collaboratorId: 'c1', type: 'FERIAS', startDate: date('2026-11-05'), endDate: date('2026-11-10') },
    { id: 'a2', collaboratorId: 'c2', type: 'TREINAMENTO', startDate: date('2026-11-30'), endDate: date('2026-12-02') }
  ];
  const savedWeeks = new Map([['2026-10-26', {
    weekStart: date('2026-10-26'),
    status: 'CLOSED', version: 2, closedAt: date('2026-11-03'), closedByUserId: 'u1',
    rows: [{ collaboratorId: 'c1', confirmedAt: date('2026-11-03'), confirmedByUserId: 'u1', days: [
      { workDate: date('2026-11-01'), kind: 'TRAVEL', projects: [{ projectId: 'p1' }], sourceFingerprint: 'old' }
    ] }]
  }], ['2026-11-30', {
    weekStart: date('2026-11-30'),
    status: 'OPEN', version: 1, rows: [{ collaboratorId: 'c4', days: [
      { workDate: date('2026-12-01'), kind: 'PROJECT', projects: [{ projectId: 'old' }] }
    ] }]
  }]]);
  const holidays = ['2026-11-02', '2026-11-15', '2026-11-20'].map(day => ({ date: day, name: 'Feriado' }));
  const database = {
    report: { findMany: args => read('reports', reports.filter(item => item.reportDate >= args.where.reportDate.gte && item.reportDate < args.where.reportDate.lt)) },
    pontoDayProjectOverride: { findMany: args => read('overrides', overrides.filter(item => item.workDate >= args.where.workDate.gte && item.workDate <= args.where.workDate.lte)) },
    collaboratorAbsence: { findMany: args => read('absences', absences.filter(item => item.startDate <= args.where.startDate.lte && item.endDate >= args.where.endDate.gte)) },
    allocationReviewWeek: {
      findUnique: args => read('savedWeeks', savedWeeks.get(keyOf(args.where.weekStart)) || null),
      findMany: args => read('savedWeeks', args.where.weekStart.in.map(keyOf).map(key => savedWeeks.get(key)).filter(Boolean))
    },
    collaborator: { findMany: args => {
      const [operational, extra] = args.where.OR;
      const from = operational.AND[1].OR[1].terminationDate.gte;
      const to = operational.AND[2].OR[1].admissionDate.lte;
      return read('collaborators', collaborators.filter(item => extra.id.in.includes(item.id) || (
        item.jobRole.isActive && item.jobRole.isOperational
        && (item.isActive || item.terminationDate >= from)
        && (!item.admissionDate || item.admissionDate <= to)
      )));
    } },
    project: { findMany: args => read('projects', projects.filter(item => args.where.OR[0].id.in.includes(item.id) || (item.isActive && !item.deletedAt))) },
    user: {
      findUnique: () => read('users', { id: 'u1', name: 'Gestora' }),
      findMany: () => read('users', [{ id: 'u1', name: 'Gestora' }])
    }
  };
  return {
    calls,
    reports,
    deps: {
      database,
      getTrails: ({ from, to }) => read('trails', new Map([...trails].map(([id, days]) => [id, new Map([...days].filter(([day]) => day >= from && day <= to))]))),
      loadEffectiveIndex: () => read('effectiveIndex', new Map()),
      loadCalendar: (_database, from, to) => read('calendar', {
        holidays: holidays.filter(item => item.date >= from && item.date <= to),
        holidayDates: new Set(holidays.filter(item => item.date >= from && item.date <= to).map(item => item.date))
      })
    }
  };
}
