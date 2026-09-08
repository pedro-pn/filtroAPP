import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectTagResolver,
  normalizePontoMaisSnapshot,
  normalizeRegistrationNumber
} from '../src/lib/pontomais/normalize.js';
import {
  buildAmbiguousDayPendencies,
  createPontoMaisSyncService,
  filterCurrentlyResolvedAmbiguousDays,
  partitionMissingProjectPendencies,
  PontoSyncError
} from '../src/lib/pontomais/sync.js';

const SUMMARY_HEADER = {
  summary: {
    subheader: [
      { csv_title: 'Crédito' },
      { csv_title: 'Débito' },
      { csv_title: 'H. intervalo' },
      { csv_title: 'Horas normais' }
    ]
  }
};

function fixture(overrides = {}) {
  return {
    periodStart: '2026-08-01',
    periodEnd: '2026-08-02',
    employees: [{
      id: 101,
      name: 'Pessoa Externa',
      registration_number: '000-42',
      cpf: '000.000.000-00'
    }],
    workDays: [{
      __header: SUMMARY_HEADER,
      date: 'Sáb, 01/08/2026',
      employee_id: 101,
      employee_name: 'Pessoa Externa',
      registration_number: '000-42',
      summary: ['00:00', '00:00', '00:00', '08:00'],
      extra_time: [
        { percent: null, raw_value: 10200 },
        { percent: 70, raw_value: 4200 },
        { percent: 100, raw_value: 6000 }
      ],
      overnight_time: '00:30'
    }],
    timeCards: [
      { date: 'Sáb, 01/08/2026', time: '08:00', registration_number: '000-42', tag_manager: 'Missão 5745' },
      { date: 'Sáb, 01/08/2026', time: '12:00', registration_number: '000-42', tag_manager: null },
      { date: 'Sáb, 01/08/2026', time: '13:00', registration_number: '000-42', tag_manager: 'Missão 5745' }
    ],
    collaborators: [{
      id: 'collaborator-1',
      name: 'Outra grafia',
      registrationNumber: '42',
      cpf: null
    }],
    externalLinks: [],
    projects: [{ id: 'project-1', code: '5745', name: 'Projeto teste' }],
    tagAliases: [],
    ...overrides
  };
}

test('normaliza matrícula para comparação estável', () => {
  assert.equal(normalizeRegistrationNumber(' 000-42 '), '42');
  assert.equal(normalizeRegistrationNumber('AB 001'), 'AB001');
});

test('normaliza jornada explícita e agrega etiquetas por colaborador/data', () => {
  const result = normalizePontoMaisSnapshot(fixture());
  assert.equal(result.periods.length, 1);
  const period = result.periods[0];
  assert.equal(period.collaboratorId, 'collaborator-1');
  assert.equal(period.workedMinutes, 480);
  assert.equal(period.he70Minutes, 70);
  assert.equal(period.he100Minutes, 100);
  assert.equal(period.nightMinutes, 30);
  assert.equal(period.monthly.schemaVersion, 2);
  assert.equal(period.monthly.months['2026-08'].genericOvertimeMinutes, 170);
  assert.equal(period.monthly.months['2026-08'].days[0].genericOvertimeMinutes, 170);
  assert.equal(
    period.monthly.months['2026-08'].genericOvertimeMinutes
      + period.monthly.months['2026-08'].he70Minutes
      + period.monthly.months['2026-08'].he100Minutes,
    340,
    'nenhum minuto extra retornado pela API pode ser descartado'
  );
  assert.deepEqual(period.monthly.months['2026-08'].days[0].tags, ['Missão 5745']);
  assert.deepEqual(result.pending.employees, []);
  assert.deepEqual(result.pending.projectTags, []);
});

test('preserva EM VIAGEM como contexto sem criar pendência de projeto', () => {
  const result = normalizePontoMaisSnapshot(fixture({
    timeCards: [
      { date: 'Sáb, 01/08/2026', time: '08:00', registration_number: '000-42', tag_manager: 'EM VIAGEM - cliente' },
      { date: 'Sáb, 01/08/2026', time: '17:00', registration_number: '000-42', tag_manager: null }
    ]
  }));

  assert.deepEqual(result.periods[0].monthly.months['2026-08'].days[0].tags, ['EM VIAGEM - cliente']);
  assert.deepEqual(result.pending.projectTags, []);
  const resolver = buildProjectTagResolver({
    projects: [{ id: 'project-1', code: '5745' }],
    tagAliases: [{ normalizedTag: 'em viagem - cliente', projectId: 'project-1' }]
  });
  assert.equal(resolver('EM VIAGEM - cliente'), null);
});

test('vínculo externo tem prioridade e correspondência ambígua fica pendente', () => {
  const linked = normalizePontoMaisSnapshot(fixture({
    collaborators: [
      { id: 'collaborator-a', name: 'Pessoa Externa', registrationNumber: '42', cpf: null },
      { id: 'collaborator-b', name: 'Pessoa Externa', registrationNumber: '42', cpf: null }
    ],
    externalLinks: [{ externalEmployeeId: '101', collaboratorId: 'collaborator-b' }]
  }));
  assert.equal(linked.periods[0].collaboratorId, 'collaborator-b');

  const pending = normalizePontoMaisSnapshot(fixture({
    collaborators: [
      { id: 'collaborator-a', name: 'Pessoa Externa', registrationNumber: '42', cpf: null },
      { id: 'collaborator-b', name: 'Pessoa Externa', registrationNumber: '42', cpf: null }
    ],
    externalLinks: []
  }));
  assert.equal(pending.periods[0].collaboratorId, null);
  assert.equal(pending.pending.employees[0].reason, 'NO_UNIQUE_MATCH');
});

test('hash é determinístico para a mesma fotografia normalizada', () => {
  const first = normalizePontoMaisSnapshot(fixture());
  const second = normalizePontoMaisSnapshot(fixture({ timeCards: [...fixture().timeCards].reverse() }));
  assert.equal(first.contentHash, second.contentHash);
});

test('colaborador externo ignorado não entra no snapshot nem gera pendência', () => {
  const normalized = normalizePontoMaisSnapshot(fixture({
    ignoredExternalEmployeeIds: ['101']
  }));

  assert.deepEqual(normalized.periods, []);
  assert.deepEqual(normalized.pending, { employees: [], projectTags: [], ambiguousDays: [] });
  assert.equal(normalized.collaboratorsTotal, 0);
  assert.equal(normalized.collaboratorsMatched, 0);
});

test('pendência histórica sem RDO/Efetivo atual é descartada em vez de perpetuada', () => {
  const ambiguousDays = [
    { externalEmployeeId: '101', date: '2026-08-01', projectCodes: ['5761', '5794'], reason: 'RDO_NOT_CONFIRMED' },
    { externalEmployeeId: '102', date: '2026-08-02', projectCodes: ['5761', '5794'], reason: 'RDO_NOT_CONFIRMED' }
  ];
  const unresolved = filterCurrentlyResolvedAmbiguousDays({
    ambiguousDays,
    periodLinks: [
      { externalEmployeeId: '101', collaboratorId: 'collaborator-1' },
      { externalEmployeeId: '102', collaboratorId: 'collaborator-2' }
    ],
    projects: [
      { id: 'project-5761', code: '5761' },
      { id: 'project-5794', code: '5794' }
    ],
    rdoReports: [{
      reportDate: new Date('2026-08-01T00:00:00.000Z'),
      reportType: 'RDO',
      projectId: 'project-5761',
      daytimeWorkedMinutes: 480,
      nighttimeWorkedMinutes: 0,
      project: { offshore: false, laborSleepModeByCollaborator: null },
      collaborators: [{ collaboratorId: 'collaborator-1' }],
      services: []
    }]
  });

  assert.deepEqual(unresolved, []);
});

test('dia sem etiqueta e com dois RDOs atuais continua visível para seleção manual', () => {
  const ambiguousDay = {
    externalEmployeeId: '101',
    date: '2026-08-01',
    projectCodes: ['5761', '5794'],
    tagProjectCodes: [],
    rdoProjectCodes: ['5761', '5794'],
    reason: 'RDO_NOT_CONFIRMED'
  };
  const report = projectId => ({
    reportDate: new Date('2026-08-01T00:00:00.000Z'),
    reportType: 'RDO',
    projectId,
    daytimeWorkedMinutes: 480,
    nighttimeWorkedMinutes: 0,
    project: { offshore: false, laborSleepModeByCollaborator: null },
    collaborators: [{ collaboratorId: 'collaborator-1' }],
    services: []
  });

  const unresolved = filterCurrentlyResolvedAmbiguousDays({
    ambiguousDays: [ambiguousDay],
    periodLinks: [{ externalEmployeeId: '101', collaboratorId: 'collaborator-1' }],
    projects: [
      { id: 'project-5761', code: '5761' },
      { id: 'project-5794', code: '5794' }
    ],
    rdoReports: [report('project-5761'), report('project-5794')]
  });

  assert.deepEqual(unresolved, [ambiguousDay]);
});

test('separa somente dias cujos projetos candidatos não existem no cadastro', () => {
  const knownAndMissing = {
    externalEmployeeId: '101',
    date: '2026-08-01',
    projectCodes: ['5000', '5761']
  };
  const onlyMissing = {
    externalEmployeeId: '102',
    date: '2025-01-10',
    projectCodes: ['5000']
  };
  const unidentified = {
    externalEmployeeId: '103',
    date: '2026-08-02',
    projectCodes: []
  };

  assert.deepEqual(partitionMissingProjectPendencies({
    ambiguousDays: [knownAndMissing, onlyMissing, unidentified],
    projects: [{ id: 'project-5761', code: '5761' }]
  }), {
    actionableDays: [knownAndMissing, unidentified],
    missingDays: [onlyMissing]
  });
});

test('várias etiquetas sem RDO/Efetivo não geram pendência nem expõem dados pessoais', () => {
  const normalized = normalizePontoMaisSnapshot(fixture({
    timeCards: [
      { date: 'Sáb, 01/08/2026', time: '08:00', registration_number: '000-42', tag_manager: 'Missão 5745' },
      { date: 'Sáb, 01/08/2026', time: '17:00', registration_number: '000-42', tag_manager: 'Missão 5752' }
    ],
    projects: [
      { id: 'project-1', code: '5745' },
      { id: 'project-2', code: '5752' }
    ]
  }));
  const pending = buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects: [
      { id: 'project-1', code: '5745' },
      { id: 'project-2', code: '5752' }
    ],
    rdoReports: []
  });

  assert.deepEqual(pending, []);
  assert.doesNotMatch(JSON.stringify(pending), /Pessoa Externa|000-42|000\.000/);
});

test('pendência do sync usa a mesma janela individual do Efetivo do cálculo financeiro', () => {
  const projects = [
    { id: 'project-a', code: '5745' },
    { id: 'project-b', code: '5752' }
  ];
  const normalized = normalizePontoMaisSnapshot(fixture({
    projects,
    timeCards: [
      { date: 'Sáb, 01/08/2026', time: '08:00', registration_number: '000-42', tag_manager: 'EM VIAGEM' },
      { date: 'Sáb, 01/08/2026', time: '17:00', registration_number: '000-42', tag_manager: 'EM VIAGEM' }
    ]
  }));
  const allocation = projectId => ({
    id: `allocation-${projectId}`,
    collaboratorId: 'collaborator-1',
    mobilizationDate: new Date('2026-08-01T00:00:00.000Z'),
    demobilizationDate: new Date('2026-08-10T00:00:00.000Z'),
    mission: {
      id: `mission-${projectId}`,
      projectId,
      mobilizationDate: new Date('2026-07-20T00:00:00.000Z'),
      executionEndDate: new Date('2026-08-15T00:00:00.000Z'),
      returnDate: new Date('2026-08-15T00:00:00.000Z')
    }
  });

  assert.deepEqual(buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects,
    effectiveAllocations: [allocation('project-a')]
  }), []);

  assert.deepEqual(buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects,
    effectiveAllocations: [allocation('project-a'), allocation('project-b')]
  }), [{
    externalEmployeeId: '101',
    date: '2026-08-01',
    projectCodes: ['5745', '5752'],
    tagProjectCodes: [],
    rdoProjectCodes: [],
    reason: 'EFFECTIVE_ALLOCATION_AMBIGUOUS',
    travelContext: true
  }]);
});

test('pendência usa o mesmo fallback de missão mesclada do cálculo financeiro', () => {
  const projects = [
    { id: 'project-a', code: '5745' },
    { id: 'project-b', code: '5761' },
    { id: 'project-c', code: '5752' },
    { id: 'project-d', code: '5794' }
  ];
  const normalized = normalizePontoMaisSnapshot(fixture({
    projects,
    timeCards: [
      { date: 'Sáb, 01/08/2026', time: '08:00', registration_number: '000-42', tag_manager: 'Missão 5745' }
    ]
  }));
  const report = (projectId, minutes = 480) => ({
    reportDate: new Date('2026-08-01T00:00:00.000Z'),
    reportType: 'RDO',
    projectId,
    daytimeWorkedMinutes: minutes,
    nighttimeWorkedMinutes: 0,
    project: { offshore: false, laborSleepModeByCollaborator: null },
    collaborators: [{ collaboratorId: 'collaborator-1' }],
    services: []
  });
  const missionGroups = [{
    id: 'group-detroit',
    members: [
      { projectId: 'project-a' },
      { projectId: 'project-b' },
      { projectId: 'project-d' }
    ]
  }];

  assert.deepEqual(buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects,
    missionGroups,
    rdoReports: [report('project-b'), report('project-c', 240)]
  }), []);

  const unresolved = buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects,
    missionGroups,
    rdoReports: [report('project-b'), report('project-d', 240)]
  });
  assert.equal(unresolved.length, 1);
  assert.deepEqual(unresolved[0].rdoProjectCodes, ['5761', '5794']);
});

test('RDO posterior sugere o projeto, mas não substitui o RDO do próprio dia', () => {
  const projects = [
    { id: 'project-a', code: '5810', mobilizationDate: new Date('2026-08-01T00:00:00.000Z') },
    { id: 'project-b', code: '5813', mobilizationDate: new Date('2026-08-01T00:00:00.000Z') }
  ];
  const normalized = normalizePontoMaisSnapshot(fixture({
    projects,
    timeCards: [
      { date: 'Sáb, 01/08/2026', time: '08:00', registration_number: '000-42', tag_manager: 'EM VIAGEM' }
    ]
  }));
  const laterRdo = projectId => ({
    reportDate: new Date('2026-08-03T00:00:00.000Z'),
    reportType: 'RDO',
    projectId,
    daytimeWorkedMinutes: 480,
    nighttimeWorkedMinutes: 0,
    project: {
      offshore: false,
      laborSleepModeByCollaborator: null,
      mobilizationDate: new Date('2026-08-01T00:00:00.000Z')
    },
    collaborators: [{ collaboratorId: 'collaborator-1' }],
    services: []
  });

  assert.deepEqual(buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects,
    rdoReports: [laterRdo('project-a')]
  }), [{
    externalEmployeeId: '101',
    date: '2026-08-01',
    projectCodes: ['5810'],
    tagProjectCodes: [],
    rdoProjectCodes: [],
    reason: 'RDO_PERIOD_MISMATCH',
    travelContext: true
  }]);

  const ambiguous = buildAmbiguousDayPendencies({
    periods: normalized.periods,
    projects,
    rdoReports: [laterRdo('project-a'), laterRdo('project-b')]
  });
  assert.deepEqual(ambiguous, [{
    externalEmployeeId: '101',
    date: '2026-08-01',
    projectCodes: ['5810', '5813'],
    tagProjectCodes: [],
    rdoProjectCodes: [],
    reason: 'RDO_PERIOD_MISMATCH',
    travelContext: true
  }]);

  assert.deepEqual(filterCurrentlyResolvedAmbiguousDays({
    ambiguousDays: ambiguous,
    periodLinks: [{ externalEmployeeId: '101', collaboratorId: 'collaborator-1' }],
    projects,
    rdoReports: [laterRdo('project-a')]
  }), ambiguous);
});

function createFakeDb({ running = false, automationState = null } = {}) {
  let sequence = 0;
  let transactionTail = Promise.resolve();
  const state = {
    runs: running ? [{
      id: 'run-existing',
      status: 'RUNNING',
      startedAt: new Date('2026-08-17T11:55:00.000Z'),
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-02T00:00:00.000Z')
    }] : [],
    imports: [],
    periods: [],
    externalLinks: [],
    nameAliases: [],
    tagAliases: [],
    externalEmployees: [],
    dayOverrides: [],
    projects: fixture().projects,
    reports: []
  };

  const db = {
    pontoSyncRun: {
      async updateMany({ where, data }) {
        let count = 0;
        for (const run of state.runs) {
          if (run.status === where.status && run.startedAt < where.startedAt.lt) {
            Object.assign(run, data);
            count += 1;
          }
        }
        return { count };
      },
      async findFirst({ where } = {}) {
        return state.runs.find(run => !where?.status || run.status === where.status) || null;
      },
      async create({ data }) {
        const run = { id: `run-${++sequence}`, startedAt: new Date('2026-08-17T12:00:00.000Z'), ...data };
        state.runs.push(run);
        return run;
      },
      async update({ where, data }) {
        const run = state.runs.find(item => item.id === where.id);
        Object.assign(run, data);
        return run;
      },
      async findMany() {
        return [...state.runs].reverse();
      }
    },
    pontoSyncState: {
      async findUnique() { return automationState; }
    },
    collaborator: {
      async findMany() { return fixture().collaborators; },
      async findUnique({ where }) { return fixture().collaborators.find(item => item.id === where.id) || null; }
    },
    pontoExternalEmployeeLink: {
      async findMany() { return state.externalLinks; },
      async upsert({ where, create, update }) {
        const existing = state.externalLinks.find(item => item.externalEmployeeId === where.externalEmployeeId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { id: `employee-link-${++sequence}`, ...create };
        state.externalLinks.push(created);
        return created;
      }
    },
    pontoNameAlias: {
      async upsert({ where, create, update }) {
        const existing = state.nameAliases.find(item => item.normalizedName === where.normalizedName);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { id: `name-alias-${++sequence}`, ...create };
        state.nameAliases.push(created);
        return created;
      }
    },
    pontoExternalEmployee: {
      async findMany({ where } = {}) {
        let rows = state.externalEmployees;
        if (where?.ignoredAt?.not === null) rows = rows.filter(item => item.ignoredAt !== null);
        if (where?.externalEmployeeId?.in) {
          rows = rows.filter(item => where.externalEmployeeId.in.includes(item.externalEmployeeId));
        }
        return rows;
      },
      async findUnique({ where }) {
        return state.externalEmployees.find(item => item.externalEmployeeId === where.externalEmployeeId) || null;
      },
      async createMany({ data }) {
        let count = 0;
        for (const item of data) {
          if (state.externalEmployees.some(existing => existing.externalEmployeeId === item.externalEmployeeId)) continue;
          state.externalEmployees.push({ ...item, ignoredAt: null, ignoredByUserId: null });
          count += 1;
        }
        return { count };
      },
      async update({ where, data }) {
        const existing = state.externalEmployees.find(item => item.externalEmployeeId === where.externalEmployeeId);
        Object.assign(existing, data);
        return existing;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const existing of state.externalEmployees) {
          if (where.externalEmployeeId.in.includes(existing.externalEmployeeId)) {
            Object.assign(existing, data);
            count += 1;
          }
        }
        return { count };
      }
    },
    project: {
      async findMany() { return state.projects; },
      async findUnique({ where }) { return state.projects.find(item => item.id === where.id) || null; }
    },
    pontoDayProjectOverride: {
      async findMany() { return state.dayOverrides; },
      async deleteMany({ where }) {
        const before = state.dayOverrides.length;
        state.dayOverrides = state.dayOverrides.filter(item => !(
          item.collaboratorId === where.collaboratorId
          && new Date(item.workDate).getTime() === new Date(where.workDate).getTime()
        ));
        return { count: before - state.dayOverrides.length };
      },
      async createMany({ data }) {
        for (const item of data) state.dayOverrides.push({ id: `day-override-${++sequence}`, ...item });
        return { count: data.length };
      },
      async upsert({ where, create, update }) {
        const key = where.collaboratorId_workDate;
        const existing = state.dayOverrides.find(item => (
          item.collaboratorId === key.collaboratorId
          && new Date(item.workDate).getTime() === new Date(key.workDate).getTime()
        ));
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { id: `day-override-${++sequence}`, ...create };
        state.dayOverrides.push(created);
        return created;
      }
    },
    pontoProjectTagAlias: {
      async findMany() { return state.tagAliases; },
      async upsert({ where, create, update }) {
        const existing = state.tagAliases.find(item => item.normalizedTag === where.normalizedTag);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { id: `tag-link-${++sequence}`, ...create };
        state.tagAliases.push(created);
        return created;
      }
    },
    report: {
      async findMany() { return state.reports; }
    },
    pontoImport: {
      async findFirst({ where }) {
        return state.imports.find(item => item.contentHash === where.contentHash && item.source === where.source) || null;
      },
      async create({ data }) {
        const imported = { id: `import-${++sequence}`, createdAt: new Date(), ...data, periods: undefined };
        state.imports.push(imported);
        for (const period of data.periods.create) state.periods.push({ ...period, importId: imported.id });
        return imported;
      }
    },
    pontoPeriodSummary: {
      async findFirst({ where }) {
        return [...state.periods].reverse().find(item => item.externalEmployeeId === where.externalEmployeeId) || null;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const period of state.periods) {
          const filters = where.OR || [where];
          const matches = filters.some(filter => Object.entries(filter).every(
            ([key, value]) => period[key] === value
          ));
          if (matches) {
            Object.assign(period, data);
            count += 1;
          }
        }
        return { count };
      },
      async findMany() { return [...state.periods].reverse(); }
    },
    async $executeRaw() { return 1; },
    async $transaction(callback) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        return await callback(db);
      } finally {
        release();
      }
    }
  };
  return { db, state };
}

function fakeClient({ fail = null, sourceOverrides = {} } = {}) {
  const source = fixture(sourceOverrides);
  return {
    async listEmployees() {
      if (fail) throw fail;
      return source.employees;
    },
    async listWorkDays() { return source.workDays; },
    async listTimeCards() { return source.timeCards; }
  };
}

test('sincronização publica snapshot completo e reaproveita fotografia idêntica', async () => {
  const { db, state } = createFakeDb();
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient(),
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });
  const input = { startDate: '2026-08-01', endDate: '2026-08-02', requestedByUserId: 'user-1' };

  const first = await service.runSync(input);
  const second = await service.runSync(input);

  assert.equal(first.skippedDuplicate, false);
  assert.equal(second.skippedDuplicate, true);
  assert.equal(second.importId, first.importId);
  assert.equal(state.imports.length, 1);
  assert.equal(state.periods.length, 1);
  assert.equal(state.runs.filter(run => run.status === 'SUCCEEDED').length, 2);
});

test('auditoria distingue gatilho automático e status projeta cursor sem segredo', async () => {
  const automationState = {
    bootstrapStatus: 'RUNNING',
    historyStart: new Date('2024-01-10T00:00:00.000Z'),
    historyThrough: new Date('2026-06-30T00:00:00.000Z'),
    nextPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
    lastDailySyncDate: null,
    lastAttemptAt: new Date('2026-08-17T12:00:00.000Z'),
    lastSuccessfulAt: new Date('2026-08-17T11:59:00.000Z'),
    lastErrorCode: null,
    lastErrorMessage: null,
    token: 'não deve sair'
  };
  const { db, state } = createFakeDb({ automationState });
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient(),
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });

  await service.runSync({
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    trigger: 'AUTOMATIC_BOOTSTRAP'
  });
  assert.equal(state.runs[0].trigger, 'AUTOMATIC_BOOTSTRAP');
  assert.equal((await service.listSyncRuns({ limit: 10 }))[0].trigger, 'AUTOMATIC_BOOTSTRAP');

  const status = await service.getIntegrationStatus();
  assert.deepEqual(status.automation, {
    bootstrapStatus: 'RUNNING',
    historyStart: '2024-01-10',
    historyThrough: '2026-06-30',
    nextPeriodStart: '2026-07-01',
    lastDailySyncDate: null,
    lastAttemptAt: new Date('2026-08-17T12:00:00.000Z'),
    lastSuccessfulAt: new Date('2026-08-17T11:59:00.000Z'),
    lastErrorCode: null,
    lastErrorMessage: null,
    scheduledTime: '03:00',
    timeZone: 'America/Sao_Paulo'
  });
  assert.doesNotMatch(JSON.stringify(status), /não deve sair/);
});

test('falha externa finaliza auditoria sem publicar import parcial', async () => {
  const { db, state } = createFakeDb();
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient({ fail: new Error('resposta com dado privado') }),
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });

  await assert.rejects(
    () => service.runSync({ startDate: '2026-08-01', endDate: '2026-08-02' }),
    error => error instanceof PontoSyncError && error.code === 'PONTOMAIS_UNAVAILABLE'
  );
  assert.equal(state.imports.length, 0);
  assert.equal(state.runs.at(-1).status, 'FAILED');
  assert.doesNotMatch(state.runs.at(-1).errorMessage, /privado/);
});

test('conteúdo externo incompleto falha sem substituir o último snapshot válido', async () => {
  const { db, state } = createFakeDb();
  const validService = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient(),
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });
  await validService.runSync({ startDate: '2026-08-01', endDate: '2026-08-02' });
  const validImportId = state.imports[0].id;

  const incompleteService = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient({
      sourceOverrides: {
        workDays: [{
          date: 'Sáb, 01/08/2026',
          employee_id: 101,
          employee_name: 'Pessoa Externa',
          registration_number: '000-42'
        }]
      }
    }),
    now: () => new Date('2026-08-17T12:05:00.000Z')
  });

  await assert.rejects(
    () => incompleteService.runSync({ startDate: '2026-08-01', endDate: '2026-08-02' }),
    error => error instanceof PontoSyncError && error.code === 'PONTOMAIS_INVALID_RESPONSE'
  );
  assert.equal(state.imports.length, 1);
  assert.equal(state.imports[0].id, validImportId);
  assert.equal(state.runs.at(-1).status, 'FAILED');
});

test('sincronização simultânea é rejeitada antes de consultar o fornecedor', async () => {
  const { db } = createFakeDb({ running: true });
  let clientCreated = false;
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => { clientCreated = true; return fakeClient(); },
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });
  await assert.rejects(
    () => service.runSync({ startDate: '2026-08-01', endDate: '2026-08-02' }),
    error => error instanceof PontoSyncError && error.code === 'SYNC_IN_PROGRESS'
  );
  assert.equal(clientCreated, false);
});

test('duas solicitações concorrentes admitem exatamente uma sincronização', async () => {
  const { db, state } = createFakeDb();
  let releaseCollection;
  const collectionGate = new Promise(resolve => { releaseCollection = resolve; });
  let clientsCreated = 0;
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => {
      clientsCreated += 1;
      const client = fakeClient();
      return {
        ...client,
        async listEmployees() {
          await collectionGate;
          return client.listEmployees();
        }
      };
    },
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });
  const input = { startDate: '2026-08-01', endDate: '2026-08-02' };

  const first = service.runSync(input);
  const second = service.runSync(input);
  const settled = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  releaseCollection();
  const results = await settled;

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.reason instanceof PontoSyncError);
  assert.equal(rejected.reason.code, 'SYNC_IN_PROGRESS');
  assert.equal(clientsCreated, 1);
  assert.equal(state.runs.length, 1);
});

test('vínculo externo é persistido e reaplica colaborador aos resumos históricos', async () => {
  const { db, state } = createFakeDb();
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient(),
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });
  await service.runSync({ startDate: '2026-08-01', endDate: '2026-08-02' });
  state.runs[0].summary.pending.employees = [{
    externalEmployeeId: '101',
    registrationNumber: '42',
    externalName: 'Pessoa Externa',
    reason: 'NO_UNIQUE_MATCH'
  }];
  state.periods.push({
    id: 'legacy-xlsx-period',
    importId: 'legacy-xlsx-import',
    externalEmployeeId: null,
    collaboratorId: null,
    registrationNumber: null,
    rawName: 'Pessoa Externa',
    normalizedName: 'pessoa externa',
    monthly: null,
    createdAt: new Date('2026-07-01T12:00:00.000Z')
  });
  assert.equal((await service.getPending()).employees.length, 1);

  const result = await service.linkExternalEmployee({
    externalEmployeeId: '101',
    collaboratorId: 'collaborator-1',
    createdByUserId: 'manager-1'
  });

  assert.deepEqual(result, {
    externalEmployeeId: '101',
    collaboratorId: 'collaborator-1',
    normalizedName: 'pessoa externa',
    relinked: 2
  });
  assert.equal(state.externalLinks[0].createdByUserId, 'manager-1');
  assert.equal(state.nameAliases[0].collaboratorId, 'collaborator-1');
  assert.equal(state.periods.every(period => period.collaboratorId === 'collaborator-1'), true);
  assert.equal((await service.getPending()).employees.length, 0);
});

test('diretório lista todos os encontrados e torna a preferência de ignorar reversível', async () => {
  const { db, state } = createFakeDb();
  const service = createPontoMaisSyncService({
    db,
    configured: () => true,
    clientFactory: () => fakeClient(),
    now: () => new Date('2026-08-17T12:00:00.000Z')
  });
  await service.runSync({ startDate: '2026-08-01', endDate: '2026-08-02' });

  assert.equal((await service.listExternalEmployees())[0].externalName, 'Pessoa Externa');
  assert.equal((await service.setExternalEmployeeIgnored({
    externalEmployeeId: '101', ignored: true, ignoredByUserId: 'manager-1'
  })).ignored, true);
  assert.equal(state.externalEmployees[0].ignoredByUserId, 'manager-1');
  const ignoredRun = await service.runSync({ startDate: '2026-08-03', endDate: '2026-08-04' });
  assert.equal(ignoredRun.collaboratorsTotal, 0);
  assert.equal(state.periods.length, 1, 'o segundo snapshot não publica período para o ID ignorado');
  assert.equal((await service.setExternalEmployeeIgnored({
    externalEmployeeId: '101', ignored: false, ignoredByUserId: 'manager-1'
  })).ignored, false);
  assert.equal(state.externalEmployees[0].ignoredByUserId, null);
});

test('alias de etiqueta é normalizado, auditado e atualizado por upsert', async () => {
  const { db, state } = createFakeDb();
  const service = createPontoMaisSyncService({ db, configured: () => true });

  const first = await service.linkProjectTag({ rawTag: '  Equipe Ilha  ', projectId: 'project-1', createdByUserId: 'manager-1' });
  const second = await service.linkProjectTag({ rawTag: 'EQUIPE ÍLHA', projectId: 'project-1', createdByUserId: 'manager-2' });

  assert.deepEqual(first, { normalizedTag: 'equipe ilha', projectId: 'project-1' });
  assert.deepEqual(second, first);
  assert.equal(state.tagAliases.length, 1);
  assert.equal(state.tagAliases[0].createdByUserId, 'manager-2');
});

test('RDO único divergente resolve snapshot histórico sem seleção manual', async () => {
  const { db, state } = createFakeDb();
  state.projects.push({ id: 'project-2', code: '5752', name: 'Projeto RDO' });
  state.externalEmployees.push({
    externalEmployeeId: '101', externalName: 'Pessoa Externa', registrationNumber: '42',
    isActive: true, ignoredAt: null
  });
  state.periods.push({
    externalEmployeeId: '101', collaboratorId: 'collaborator-1',
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-02T00:00:00.000Z'),
    createdAt: new Date('2026-08-17T12:00:00.000Z'),
    monthly: {
      schemaVersion: 2,
      months: {
        '2026-08': {
          days: [{ date: '2026-08-01', workedMinutes: 480, tags: ['Missão 5745'] }]
        }
      }
    }
  });
  state.reports.push({
    reportDate: new Date('2026-08-01T00:00:00.000Z'), reportType: 'RDO',
    projectId: 'project-2', daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0,
    project: { offshore: false, laborSleepModeByCollaborator: null },
    collaborators: [{ collaboratorId: 'collaborator-1' }], services: []
  });
  state.runs.push({
    id: 'run-conflict', status: 'SUCCEEDED',
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-02T00:00:00.000Z'),
    completedAt: new Date('2026-08-17T12:01:00.000Z'),
    summary: { pending: { employees: [], projectTags: [], ambiguousDays: [] } }
  });
  const service = createPontoMaisSyncService({ db, configured: () => true });

  assert.deepEqual((await service.getPending()).ambiguousDays, []);
});

test('etiqueta divergente de múltiplos RDOs fica pendente até seleção manual auditável', async () => {
  const { db, state } = createFakeDb();
  state.projects.push(
    { id: 'project-2', code: '5752', name: 'Projeto RDO A' },
    { id: 'project-3', code: '5761', name: 'Projeto RDO B' }
  );
  state.externalEmployees.push({
    externalEmployeeId: '101', externalName: 'Pessoa Externa', registrationNumber: '42',
    isActive: true, ignoredAt: null
  });
  state.periods.push({
    externalEmployeeId: '101', collaboratorId: 'collaborator-1',
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-02T00:00:00.000Z'),
    createdAt: new Date('2026-08-17T12:00:00.000Z'),
    monthly: {
      schemaVersion: 2,
      months: {
        '2026-08': {
          days: [{ date: '2026-08-01', workedMinutes: 480, tags: ['Missão 5745'] }]
        }
      }
    }
  });
  for (const [projectId, minutes] of [['project-2', 480], ['project-3', 240]]) {
    state.reports.push({
      reportDate: new Date('2026-08-01T00:00:00.000Z'), reportType: 'RDO',
      projectId, daytimeWorkedMinutes: minutes, nighttimeWorkedMinutes: 0,
      project: { offshore: false, laborSleepModeByCollaborator: null },
      collaborators: [{ collaboratorId: 'collaborator-1' }], services: []
    });
  }
  state.runs.push({
    id: 'run-conflict', status: 'SUCCEEDED',
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-02T00:00:00.000Z'),
    completedAt: new Date('2026-08-17T12:01:00.000Z'),
    summary: { pending: { employees: [], projectTags: [], ambiguousDays: [] } }
  });
  const service = createPontoMaisSyncService({ db, configured: () => true });

  const before = await service.getPending();
  assert.equal(before.ambiguousDays.length, 1);
  assert.equal(before.ambiguousDays[0].externalName, 'Pessoa Externa');
  assert.equal(before.ambiguousDays[0].reason, 'TAG_RDO_CONFLICT');
  assert.deepEqual(before.ambiguousDays[0].projectCodes, ['5745', '5752', '5761']);

  const resolved = await service.setDayProjectOverride({
    externalEmployeeId: '101', date: '2026-08-01', projectIds: ['project-2', 'project-3'],
    createdByUserId: 'manager-1'
  });
  assert.deepEqual(resolved, {
    externalEmployeeId: '101', date: '2026-08-01', projectIds: ['project-2', 'project-3']
  });
  assert.equal(state.dayOverrides.length, 2);
  assert.equal(state.dayOverrides[0].createdByUserId, 'manager-1');
  assert.deepEqual((await service.getPending()).ambiguousDays, []);

  await assert.rejects(
    () => service.setDayProjectOverride({
      externalEmployeeId: '101', date: '2026-08-02', projectId: 'project-1', createdByUserId: 'manager-1'
    }),
    error => error instanceof PontoSyncError && error.code === 'PENDING_NOT_FOUND'
  );
});

test('auditoria e pendências usam projeção segura e ocultam itens já vinculados', async () => {
  const { db, state } = createFakeDb();
  state.runs.push({
    id: 'run-success',
    status: 'SUCCEEDED',
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-02T00:00:00.000Z'),
    employeesRead: 2,
    workDaysRead: 2,
    timeCardsRead: 4,
    collaboratorsMatched: 1,
    pendingCount: 2,
    summary: {
      pending: {
        employees: [{ externalEmployeeId: '101', registrationNumber: '42', externalName: 'Pessoa Externa', reason: 'NO_UNIQUE_MATCH', cpf: 'não deve sair' }],
        projectTags: [{ rawTag: 'Equipe Ilha', normalizedTag: 'equipe ilha', reason: 'PROJECT_NOT_FOUND', token: 'não deve sair' }],
        ambiguousDays: []
      }
    },
    errorCode: null,
    errorMessage: null,
    startedAt: new Date('2026-08-17T12:00:00.000Z'),
    completedAt: new Date('2026-08-17T12:01:00.000Z')
  });
  const service = createPontoMaisSyncService({ db, configured: () => true });

  const runs = await service.listSyncRuns({ limit: 10 });
  const pending = await service.getPending();
  assert.equal(runs[0].id, 'run-success');
  assert.equal(Object.hasOwn(runs[0], 'summary'), false);
  assert.doesNotMatch(JSON.stringify(pending), /cpf|token|não deve sair/i);

  state.externalLinks.push({ externalEmployeeId: '101', collaboratorId: 'collaborator-1' });
  state.tagAliases.push({ normalizedTag: 'equipe ilha', projectId: 'project-1' });
  assert.deepEqual(await service.getPending(), {
    employees: [],
    ambiguousDays: [],
    missingProjects: { projectTags: [], ambiguousDays: [] }
  });
});

test('pendências históricas permanecem visíveis entre lotes e dia ambíguo respeita o lote mais novo', async () => {
  const { db, state } = createFakeDb();
  state.runs.push({
    id: 'run-old', status: 'SUCCEEDED',
    periodStart: new Date('2025-01-01T00:00:00.000Z'),
    periodEnd: new Date('2025-01-31T00:00:00.000Z'),
    completedAt: new Date('2025-02-01T00:00:00.000Z'),
    summary: { pending: {
      employees: [{ externalEmployeeId: 'old-employee', externalName: 'Pessoa histórica', reason: 'NO_UNIQUE_MATCH' }],
      projectTags: [{ rawTag: 'Projeto antigo', normalizedTag: 'projeto antigo', reason: 'PROJECT_NOT_FOUND' }],
      ambiguousDays: [{ externalEmployeeId: 'old-employee', date: '2025-01-10', projectCodes: ['5000'], reason: 'RDO_NOT_CONFIRMED' }]
    } }
  });
  state.runs.push({
    id: 'run-current', status: 'SUCCEEDED',
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-16T00:00:00.000Z'),
    completedAt: new Date('2026-08-17T00:00:00.000Z'),
    summary: { pending: { employees: [], projectTags: [], ambiguousDays: [] } }
  });
  const service = createPontoMaisSyncService({ db, configured: () => true });

  const historical = await service.getPending();
  assert.equal(historical.employees[0].externalEmployeeId, 'old-employee');
  assert.deepEqual(historical.ambiguousDays, []);
  assert.equal(historical.missingProjects.projectTags[0].normalizedTag, 'projeto antigo');
  assert.equal(historical.missingProjects.ambiguousDays[0].date, '2025-01-10');

  state.runs.push({
    id: 'run-corrected', status: 'SUCCEEDED',
    periodStart: new Date('2025-01-01T00:00:00.000Z'),
    periodEnd: new Date('2025-01-31T00:00:00.000Z'),
    completedAt: new Date('2026-08-18T00:00:00.000Z'),
    summary: { pending: { employees: [], projectTags: [], ambiguousDays: [] } }
  });
  const corrected = await service.getPending();
  assert.deepEqual(corrected.ambiguousDays, []);
  assert.equal(corrected.employees.length, 1);
  assert.equal(corrected.missingProjects.projectTags.length, 1);
  assert.deepEqual(corrected.missingProjects.ambiguousDays, []);
});

test('Efetivo individual resolve viagem; fora do período não perpetua pendência histórica', () => {
  const ambiguousDay = {
    externalEmployeeId: '101',
    date: '2026-07-15',
    projectCodes: ['5804', '5820'],
    tagProjectCodes: [],
    rdoProjectCodes: [],
    reason: 'MOBILIZATION_RDO_AMBIGUOUS',
    travelContext: true
  };
  const periodLinks = [{ externalEmployeeId: '101', collaboratorId: 'collaborator-1' }];
  const effective = ({ mobilizationDate, demobilizationDate }) => ({
    id: 'allocation-1',
    collaboratorId: 'collaborator-1',
    mobilizationDate: new Date(`${mobilizationDate}T00:00:00.000Z`),
    demobilizationDate: new Date(`${demobilizationDate}T00:00:00.000Z`),
    mission: {
      id: 'mission-5804',
      projectId: 'project-5804',
      mobilizationDate: new Date('2026-07-01T00:00:00.000Z'),
      executionEndDate: new Date('2026-08-31T00:00:00.000Z'),
      returnDate: new Date('2026-08-31T00:00:00.000Z')
    }
  });

  // Sem nenhuma evidência atual, a pendência congelada do snapshot é descartada.
  const semEvidencia = filterCurrentlyResolvedAmbiguousDays({
    ambiguousDays: [ambiguousDay],
    periodLinks,
    projects: [{ id: 'project-5804', code: '5804' }],
    rdoReports: []
  });
  assert.deepEqual(semEvidencia, []);

  const dentroDoEfetivo = filterCurrentlyResolvedAmbiguousDays({
    ambiguousDays: [ambiguousDay],
    periodLinks,
    projects: [{ id: 'project-5804', code: '5804' }],
    rdoReports: [],
    effectiveAllocations: [effective({ mobilizationDate: '2026-07-14', demobilizationDate: '2026-08-31' })]
  });
  assert.deepEqual(dentroDoEfetivo, []);

  const foraDoPeriodoIndividual = filterCurrentlyResolvedAmbiguousDays({
    ambiguousDays: [ambiguousDay],
    periodLinks,
    projects: [{ id: 'project-5804', code: '5804' }],
    rdoReports: [],
    effectiveAllocations: [effective({ mobilizationDate: '2026-07-16', demobilizationDate: '2026-08-31' })]
  });
  assert.deepEqual(foraDoPeriodoIndividual, []);
});

test('ignorar etiqueta guarda a forma normalizada e recusa etiqueta já vinculada', async () => {
  const ignored = new Map();
  const aliases = new Map([['missao 5745', { normalizedTag: 'missao 5745', projectId: 'project-1' }]]);
  const db = {
    pontoIgnoredProjectTag: {
      upsert: async ({ where, create }) => { ignored.set(where.normalizedTag, create); },
      deleteMany: async ({ where }) => { ignored.delete(where.normalizedTag); },
      findMany: async () => [...ignored.values()]
    },
    pontoProjectTagAlias: {
      findUnique: async ({ where }) => aliases.get(where.normalizedTag) || null
    }
  };
  const service = createPontoMaisSyncService({ db, configured: () => true });

  // Acento e caixa não criam entradas diferentes.
  assert.deepEqual(
    await service.setProjectTagIgnored({ rawTag: '  Missão 9999  ' }),
    { normalizedTag: 'missao 9999', ignored: true }
  );
  assert.deepEqual(await service.listIgnoredProjectTags(), [{ normalizedTag: 'missao 9999', rawTag: 'Missão 9999' }]);

  // Etiqueta já vinculada a projeto não pode virar ignorada: são decisões excludentes.
  await assert.rejects(
    () => service.setProjectTagIgnored({ rawTag: 'MISSAO 5745' }),
    error => error instanceof PontoSyncError && error.code === 'INVALID_TAG'
  );

  await assert.rejects(
    () => service.setProjectTagIgnored({ rawTag: '   ' }),
    error => error instanceof PontoSyncError && error.code === 'INVALID_TAG'
  );

  assert.deepEqual(
    await service.setProjectTagIgnored({ rawTag: 'Missão 9999', ignored: false }),
    { normalizedTag: 'missao 9999', ignored: false }
  );
  assert.deepEqual(await service.listIgnoredProjectTags(), []);
});
