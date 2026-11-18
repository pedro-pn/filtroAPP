import assert from 'node:assert/strict';
import test from 'node:test';

import {
  anonymizeCollaborator,
  anonymizedCollaboratorName,
  collaboratorRetentionCutoff,
  collaboratorRetentionWhere,
  previewCollaboratorRetention,
  redactConectaAggregateData,
  runCollaboratorRetention
} from '../src/lib/privacy/collaborator-retention.js';
import {
  ANONYMIZED_SURVEY_EMAIL,
  previewSurveyResponseRetention,
  runSurveyResponseRetention,
  stripFreeTextResponses,
  surveyResponseRetentionCutoff
} from '../src/lib/privacy/survey-retention.js';
import { previewDataRetention, runDataRetention } from '../src/lib/data-retention.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');

function collaboratorTx({ collaborator, aggregates = [] }) {
  const calls = [];
  const record = model => new Proxy({}, {
    get: (_target, action) => async args => {
      calls.push([model, action, args]);
      if (model === 'collaborator' && action === 'findFirst') return collaborator;
      if (model === 'conectaRhAggregate' && action === 'findMany') return aggregates;
      if (action === 'deleteMany' || action === 'updateMany') return { count: 2 };
      return {};
    }
  });
  const tx = {};
  for (const model of ['collaborator', 'collaboratorAbsence', 'pontoNameAlias', 'pontoExternalEmployeeLink',
    'pontoPeriodSummary', 'conectaRhAggregate']) tx[model] = record(model);
  return { tx, calls };
}

test('cutoff is 5 calendar years and only inactive, terminated, unheld, not yet anonymized collaborators qualify', () => {
  const cutoff = collaboratorRetentionCutoff(NOW);
  assert.equal(cutoff.toISOString(), '2021-11-18T12:00:00.000Z');
  assert.deepEqual(collaboratorRetentionWhere(cutoff), {
    isActive: false, retentionHold: false, privacyAnonymizedAt: null, terminationDate: { lt: cutoff }
  });
});

test('collaborator with EPI or RDO history keeps name/CPF but loses contacts, signature, absences and RH payloads', async () => {
  const { tx, calls } = collaboratorTx({
    collaborator: {
      id: 'c1', code: 'C-001', conectaPerson: { companyId: 'co', personId: 'p1' },
      _count: { epiRecords: 3, epiSignatureRequests: 0, reportLinks: 0 }
    },
    aggregates: [
      { id: 'a1', aggregateType: 'employment', data: { personId: 'p1', employmentId: 'e1', name: 'Fulano', cpf: '12345678901',
        email: 'f@x.com', registrationNumber: '77', status: 'TERMINATED', terminationDate: '2020-01-10' } },
      { id: 'a2', aggregateType: 'compliance', data: { id: 'k1', personId: 'p1', category: 'EXAM', title: 'ASO', typeCode: 'ASO',
        status: 'VALID', evidence: { fileName: 'aso.pdf' } } },
      { id: 'a3', aggregateType: 'employment', data: { personId: 'p1', redactedAt: '2026-01-01T00:00:00.000Z' } }
    ]
  });
  const result = await anonymizeCollaborator(tx, 'c1', { now: NOW });

  assert.deepEqual(result, { keepIdentity: true, absencesDeleted: 2, pontoAliasesDeleted: 4,
    pontoSummariesAnonymized: 0, conectaAggregatesRedacted: 2 });
  const update = calls.find(([model, action]) => model === 'collaborator' && action === 'update')[2];
  assert.deepEqual(update.data, { email: null, efetivoNote: null, signatureImage: null, privacyAnonymizedAt: NOW });
  assert.equal(calls.some(([model]) => model === 'pontoPeriodSummary'), false);
  const eligibility = calls.find(([model, action]) => model === 'collaborator' && action === 'findFirst')[2].where;
  assert.equal(eligibility.retentionHold, false);
  assert.equal(eligibility.isActive, false);

  const redacted = calls.filter(([model, action]) => model === 'conectaRhAggregate' && action === 'update').map(call => call[2]);
  assert.deepEqual(redacted.map(item => item.where.id), ['a1', 'a2']);
  const employment = JSON.stringify(redacted[0].data.data);
  for (const leaked of ['Fulano', '12345678901', 'f@x.com', '"77"']) assert.equal(employment.includes(leaked), false, leaked);
  assert.equal(redacted[0].data.data.terminationDate, '2020-01-10');
  const compliance = JSON.stringify(redacted[1].data.data);
  for (const leaked of ['ASO', 'aso.pdf']) assert.equal(compliance.includes(leaked), false, leaked);
});

test('collaborator without long-retention records is fully pseudonymized, ponto summaries included', async () => {
  const { tx, calls } = collaboratorTx({
    collaborator: { id: 'c2', code: 'C-002', conectaPerson: null, _count: { epiRecords: 0, epiSignatureRequests: 0, reportLinks: 0 } }
  });
  const result = await anonymizeCollaborator(tx, 'c2', { now: NOW });
  assert.equal(result.keepIdentity, false);
  assert.equal(result.conectaAggregatesRedacted, 0);
  const update = calls.find(([model, action]) => model === 'collaborator' && action === 'update')[2];
  assert.equal(update.data.name, anonymizedCollaboratorName('C-002'));
  assert.equal(update.data.cpf, null);
  assert.equal(update.data.registrationNumber, null);
  const ponto = calls.find(([model]) => model === 'pontoPeriodSummary')[2];
  assert.deepEqual(ponto.data, { rawName: 'Colaborador anonimizado C-002', normalizedName: 'colaborador anonimizado c-002',
    registrationNumber: null, externalEmployeeId: null });
});

test('a collaborator that is no longer eligible (hold, reactivated, already done) is left untouched', async () => {
  const { tx, calls } = collaboratorTx({ collaborator: null });
  assert.equal(await anonymizeCollaborator(tx, 'c3', { now: NOW }), null);
  assert.deepEqual(calls.map(([model, action]) => `${model}.${action}`), ['collaborator.findFirst']);
});

test('redaction keeps only identifiers and employment state', () => {
  assert.deepEqual(redactConectaAggregateData('employment', { personId: 'p', employmentId: 'e', name: 'X', cpf: '1',
    status: 'TERMINATED', admissionDate: '2010-01-01', terminationDate: '2015-01-01', currentJobRoleId: 'j', isOperational: true }, NOW), {
    personId: 'p', employmentId: 'e', status: 'TERMINATED', admissionDate: '2010-01-01', terminationDate: '2015-01-01',
    currentJobRoleId: 'j', isOperational: true, redactedAt: NOW.toISOString()
  });
});

test('collaborator retention runs one transaction per collaborator and totals the result', async () => {
  const anonymized = new Set();
  const prismaClient = {
    collaborator: {
      findMany: async () => ['c1', 'c2'].filter(id => !anonymized.has(id)).map(id => ({ id })),
      findFirst: async ({ where }) => anonymized.has(where.id) ? null
        : { id: where.id, code: where.id, conectaPerson: null, _count: { epiRecords: where.id === 'c1' ? 1 : 0 } },
      update: async ({ where }) => { anonymized.add(where.id); }
    },
    collaboratorAbsence: { deleteMany: async () => ({ count: 1 }) },
    pontoNameAlias: { deleteMany: async () => ({ count: 0 }) },
    pontoExternalEmployeeLink: { deleteMany: async () => ({ count: 0 }) },
    pontoPeriodSummary: { updateMany: async () => ({ count: 5 }) },
    $transaction: async callback => callback(prismaClient)
  };
  let locks = 0;
  const totals = await runCollaboratorRetention({ prismaClient, now: NOW, batchSize: 10, lock: async () => { locks += 1; } });
  assert.deepEqual(totals, { collaboratorsAnonymized: 2, collaboratorsIdentityKept: 1, collaboratorAbsencesDeleted: 2,
    pontoAliasesDeleted: 0, pontoSummariesAnonymized: 5, conectaAggregatesRedacted: 0, collaboratorBatches: 1 });
  assert.equal(locks, 2);
});

test('collaborator preview returns counts and ids only', async () => {
  const prismaClient = { collaborator: {
    count: async ({ where }) => where.terminationDate === null ? 7 : (where.retentionHold ? 0 : 2),
    findMany: async ({ select }) => { assert.deepEqual(select, { id: true, code: true }); return [{ id: 'c1', code: 'C-1' }]; }
  } };
  assert.deepEqual(await previewCollaboratorRetention({ prismaClient, now: NOW }), {
    collaboratorAnonymizeBefore: '2021-11-18T12:00:00.000Z', collaboratorsToAnonymize: 2,
    collaboratorsToAnonymizeSample: [{ id: 'c1', code: 'C-1' }], inactiveCollaboratorsWithoutTerminationDate: 7,
    collaboratorsOnRetentionHold: 0
  });
});

test('survey answers older than 2 years lose e-mail, notes, IP and free text but keep scores', async () => {
  assert.deepEqual(stripFreeTextResponses({ nps: 9, serviceQuality: 4, improvement: 'texto', highlight: 'x' }, null),
    { nps: 9, serviceQuality: 4 });
  assert.deepEqual(stripFreeTextResponses({ q1: 'A', q2: 'livre' }, [{ id: 'q1', type: 'SELECT' }, { id: 'q2', type: 'TEXT' }]),
    { q1: 'A' });

  const updates = [];
  const prismaClient = {
    satisfactionSurvey: {
      count: async () => 1,
      findMany: async () => updates.length ? [] : [{ id: 's1', responses: { nps: 10, improvement: 'nome do técnico' }, questions: null }],
      updateMany: async args => { updates.push(args); return { count: 1 }; }
    },
    $transaction: async callback => callback(prismaClient)
  };
  assert.equal((await previewSurveyResponseRetention({ prismaClient, now: NOW })).surveyResponsesToAnonymize, 1);
  const result = await runSurveyResponseRetention({ prismaClient, now: NOW, batchSize: 1 });
  assert.equal(result.surveyResponsesAnonymized, 1);
  assert.deepEqual(updates[0].data, { emailTo: ANONYMIZED_SURVEY_EMAIL, followUpNotes: null, submittedIp: null,
    submittedUserAgent: null, responses: { nps: 10 } });
  assert.equal(updates[0].where.AND[1].id, 's1');
  assert.equal(surveyResponseRetentionCutoff(NOW).toISOString(), '2024-11-18T12:00:00.000Z');
});

function emptyModel() {
  return { count: async () => 0, findMany: async () => [], deleteMany: async () => ({ count: 0 }),
    updateMany: async () => ({ count: 0 }), groupBy: async () => [] };
}

function emptyRetentionClient(extra = {}) {
  const client = {
    userSession: emptyModel(), passwordResetToken: emptyModel(), reportAuditLog: emptyModel(),
    epiSignatureRequestAuditLog: emptyModel(), satisfactionSurvey: emptyModel(), reportDraft: emptyModel(),
    collaborator: emptyModel(), jobRun: emptyModel(),
    dataRetentionRun: { create: async args => { client.audit.push(args); return { id: 'run' }; },
      update: async args => { client.audit.push(args); } },
    audit: [],
    ...extra
  };
  client.$transaction = async callback => callback(client);
  return client;
}

test('LGPD targets stay off unless their flags are passed, and the run audit records the flags', async () => {
  const off = emptyRetentionClient();
  const summaryOff = await runDataRetention({ prismaClient: off, now: NOW, logger: { info() {} } });
  assert.equal('lgpd' in summaryOff, false);
  assert.equal('collaboratorRetention' in off.audit[0].data.summary, false);

  const on = emptyRetentionClient();
  const summaryOn = await runDataRetention({ prismaClient: on, now: NOW, logger: { info() {} },
    collaboratorRetention: true, surveyResponseRetention: true });
  assert.equal(summaryOn.lgpd.collaboratorsAnonymized, 0);
  assert.equal(summaryOn.lgpd.surveyResponsesAnonymized, 0);
  assert.equal(on.audit[0].data.summary.collaboratorRetention, true);
  assert.equal(on.audit.at(-1).data.status, 'COMPLETED');
});

test('dry-run preview includes the LGPD targets only when asked', async () => {
  const client = emptyRetentionClient();
  assert.equal('lgpd' in await previewDataRetention({ prismaClient: client, now: NOW }), false);
  const preview = await previewDataRetention({ prismaClient: client, now: NOW, lgpdTargets: true,
    lgpdFlags: { COLLABORATOR_RETENTION_ENABLED: false } });
  assert.equal(preview.lgpd.collaboratorsToAnonymize, 0);
  assert.equal(preview.lgpd.surveyResponsesToAnonymize, 0);
  assert.deepEqual(preview.lgpd.flags, { COLLABORATOR_RETENTION_ENABLED: false });
});
