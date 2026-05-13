import assert from 'node:assert/strict';
import test from 'node:test';

import { ZodError } from 'zod';

import { assertActiveClientSegment } from '../src/routes/resources/projects.js';
import {
  buildDailyReport,
  buildServiceStats,
  parseDecimal,
  parseLocalDate,
  parseTubulacoes,
  parseVolumeOleo,
  periodKey,
  toLocalDateStr,
  validateDateRange
} from '../src/routes/resources/statistics.js';

test('statistics date helpers treat YYYY-MM-DD as an inclusive UTC date-only range', () => {
  assert.equal(parseLocalDate('2026-05-13').toISOString(), '2026-05-13T00:00:00.000Z');
  assert.equal(parseLocalDate('2026-05-13', true).toISOString(), '2026-05-13T23:59:59.999Z');
  assert.equal(toLocalDateStr(new Date('2026-05-13T00:00:00.000Z')), '2026-05-13');
  assert.equal(periodKey(new Date('2026-05-13T00:00:00.000Z'), 'day'), '2026-05-13');
});

test('statistics date range validation rejects invalid and excessive ranges', () => {
  assert.equal(validateDateRange('2026-05-13', '2026-05-13'), null);
  assert.match(validateDateRange('2026-05-14', '2026-05-13'), /Data final/);
  assert.match(validateDateRange('2026-13-01', '2026-05-13'), /Período inválido/);
  assert.match(validateDateRange('2024-01-01', '2026-01-02'), /Período máximo/);
});

test('statistics parsers normalize decimal, oil volume and tubing lengths', () => {
  assert.equal(parseDecimal('1.500,5'), 1500.5);
  assert.deepEqual(parseVolumeOleo({ extraData: { 'Volume de óleo': '1500 mL' } }), {
    liters: 1.5,
    ignored: false
  });
  assert.deepEqual(parseVolumeOleo({ extraData: { volumeOleo: '2,5', volumeOleoUnit: 'm3' } }), {
    liters: 2500,
    ignored: false
  });
  assert.deepEqual(parseTubulacoes({
    extraData: {
      'Diametros e comprimentos': [
        { d: '2', unit: 'pol', c: '120', lengthUnit: 'cm' },
        { diametro: '50', dUnit: 'mm', comprimento: '1.500,5', comprimentoUnit: 'mm' },
        { d: '', c: '10' }
      ]
    }
  }), {
    byDiameter: {
      '2 pol': 1.2,
      '50 mm': 1.5005
    },
    ignoredCount: 1
  });
  assert.deepEqual(parseTubulacoes({
    extraData: {
      tubes: [{ d: '3', unit: 'pol', c: '2,5', lengthUnit: 'm' }]
    }
  }), {
    byDiameter: { '3 pol': 2.5 },
    ignoredCount: 0
  });
});

test('service stats count measurements, tubing flag and ignored legacy rows once per pass', () => {
  const ignoredRows = { volumeOleo: 0, tubulacao: 0 };
  const stats = buildServiceStats([
    {
      serviceType: 'filtragem',
      extraData: { 'Volume de óleo': '1500 mL' }
    },
    {
      serviceType: 'filtragem',
      extraData: {}
    },
    {
      serviceType: 'flushing',
      extraData: {
        'Flushing em tubulação?': 'Sim',
        'Diâmetros e comprimentos': [
          { d: '4', unit: 'pol', c: '12', lengthUnit: 'm' },
          { d: '4', unit: 'pol', c: '', lengthUnit: 'm' }
        ]
      }
    }
  ], ignoredRows);

  assert.deepEqual(stats, {
    filtragem: {
      serviceCount: 2,
      volumeOleoLiters: 1.5,
      tubesByDiameter: {},
      hasTubulacao: 0
    },
    flushing: {
      serviceCount: 1,
      volumeOleoLiters: 0,
      tubesByDiameter: { '4 pol': 12 },
      hasTubulacao: 1
    }
  });
  assert.deepEqual(ignoredRows, { volumeOleo: 1, tubulacao: 1 });
});

test('daily report summary includes per-service measurements and standby minutes', () => {
  const daily = buildDailyReport({
    id: 'rdo-1',
    reportDate: new Date('2026-05-13T00:00:00.000Z'),
    sequenceNumber: 12,
    status: 'SIGNED',
    daytimeWorkedMinutes: 540,
    nighttimeWorkedMinutes: 120,
    daytimeOvertimeMinutes: 60,
    nighttimeOvertimeMinutes: 15,
    daytimeCount: 5,
    specialConditions: {
      standby: true,
      standbyDetails: { total: '02:30' },
      noturnoDetails: { collaboratorIds: ['c1', 'c2'] }
    },
    services: [{
      id: 'svc-1',
      serviceType: 'filtragem',
      system: 'Sistema hidráulico',
      equipment: { code: 'EQ-1', name: 'Unidade' },
      extraData: { 'Volume de óleo': '2 L' }
    }]
  });

  assert.equal(daily.reportId, 'rdo-1');
  assert.equal(daily.standbyMinutes, 150);
  assert.equal(daily.nighttimeCollaborators, 2);
  assert.equal(daily.services.filtragem.volumeOleoLiters, 2);
  assert.deepEqual(daily.services.filtragem.items, [{
    serviceId: 'svc-1',
    system: 'Sistema hidráulico',
    equipmentName: 'EQ-1 - Unidade',
    volumeOleoLiters: 2,
    tubesByDiameter: {}
  }]);
});

test('project segment validation accepts blank or active slugs and rejects inactive slugs', async () => {
  let lastWhere = null;
  const prismaClient = {
    clientSegment: {
      findFirst: async args => {
        lastWhere = args.where;
        return args.where.slug === 'siderurgica' ? { id: 'seg-1' } : null;
      }
    }
  };

  await assertActiveClientSegment('', prismaClient);
  assert.equal(lastWhere, null);
  await assertActiveClientSegment('siderurgica', prismaClient);
  assert.deepEqual(lastWhere, { slug: 'siderurgica', isActive: true });
  await assert.rejects(
    () => assertActiveClientSegment('inativo', prismaClient),
    error => error instanceof ZodError && error.issues[0].path[0] === 'clientSegment'
  );
});
