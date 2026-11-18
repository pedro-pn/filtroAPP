import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// Banco descartável com as migrations aplicadas; nunca executa contra o banco do app.
// Prova no PostgreSQL real o filtro JSON do Conecta RH e os campos usados pela retenção LGPD.
test('retenção LGPD anonimiza desligado há mais de 5 anos e respeita exceção, ativos e quem tem EPI/RDO', {
  skip: !process.env.LGPD_RETENTION_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.LGPD_RETENTION_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { runCollaboratorRetention, anonymizedCollaboratorName } = await import('../src/lib/privacy/collaborator-retention.js');
  const { runSurveyResponseRetention, ANONYMIZED_SURVEY_EMAIL } = await import('../src/lib/privacy/survey-retention.js');

  const suffix = randomUUID().slice(0, 8);
  const companyId = `lgpd-${suffix}`;
  const now = new Date('2026-11-18T12:00:00Z');
  const longAgo = new Date('2020-06-30T00:00:00Z');
  const recent = new Date('2024-01-10T00:00:00Z');
  const ids = { collaborators: [], projects: [] };
  t.after(async () => {
    await prisma.satisfactionSurvey.deleteMany({ where: { projectId: { in: ids.projects } } });
    await prisma.project.deleteMany({ where: { id: { in: ids.projects } } });
    await prisma.conectaRhAggregate.deleteMany({ where: { companyId } });
    await prisma.conectaRhPerson.deleteMany({ where: { companyId } });
    await prisma.collaboratorAbsence.deleteMany({ where: { collaboratorId: { in: ids.collaborators } } });
    await prisma.dataRetentionHold.deleteMany({ where: { targetId: { in: ids.collaborators } } });
    await prisma.collaborator.deleteMany({ where: { id: { in: ids.collaborators } } });
    await prisma.jobRole.deleteMany({ where: { name: `Cargo LGPD ${suffix}` } });
    await prisma.$disconnect();
  });

  const jobRole = await prisma.jobRole.create({ data: { name: `Cargo LGPD ${suffix}`, normalizedKey: `cargo-lgpd-${suffix}` } });
  const make = async (code, data) => {
    const collaborator = await prisma.collaborator.create({ data: {
      code: `${code}-${suffix}`, name: `Pessoa ${code}`, jobRoleId: jobRole.id, email: `${code}@exemplo.com`,
      cpf: '12345678901', registrationNumber: `M-${code}`, efetivoNote: 'nota pessoal', ...data
    } });
    ids.collaborators.push(collaborator.id);
    return collaborator;
  };
  const target = await make('alvo', { isActive: false, terminationDate: longAgo });
  const held = await make('excecao', { isActive: false, terminationDate: longAgo });
  await prisma.dataRetentionHold.create({ data: { kind: 'COLLABORATOR', targetId: held.id, reason: 'processo' } });
  const recentlyTerminated = await make('recente', { isActive: false, terminationDate: recent });
  const active = await make('ativo', { isActive: true, terminationDate: longAgo });

  await prisma.collaboratorAbsence.create({ data: {
    collaboratorId: target.id, type: 'AFASTAMENTO', startDate: longAgo, endDate: longAgo, note: 'CID sensível'
  } });
  const personId = randomUUID();
  await prisma.conectaRhPerson.create({ data: { companyId, personId, collaboratorId: target.id } });
  await prisma.conectaRhAggregate.create({ data: {
    companyId, aggregateType: 'employment', externalId: randomUUID(), revision: 1, occurredAt: longAgo,
    data: { personId, employmentId: randomUUID(), name: 'Pessoa alvo', cpf: '12345678901', email: 'alvo@exemplo.com',
      registrationNumber: 'M-alvo', isOperational: true, admissionDate: '2015-01-01', terminationDate: '2020-06-30',
      status: 'TERMINATED', currentJobRoleId: null }
  } });
  await prisma.conectaRhAggregate.create({ data: {
    companyId, aggregateType: 'employment', externalId: randomUUID(), revision: 1, occurredAt: longAgo,
    data: { personId: randomUUID(), name: 'Outra pessoa', cpf: '98765432100', status: 'ACTIVE' }
  } });

  const totals = await runCollaboratorRetention({ prismaClient: prisma, now, onlyIds: ids.collaborators });
  assert.equal(totals.collaboratorsAnonymized, 1);

  const after = await prisma.collaborator.findUnique({ where: { id: target.id } });
  assert.equal(after.name, anonymizedCollaboratorName(target.code));
  assert.equal(after.cpf, null);
  assert.equal(after.email, null);
  assert.equal(after.efetivoNote, null);
  assert.ok(after.privacyAnonymizedAt);
  assert.equal(await prisma.collaboratorAbsence.count({ where: { collaboratorId: target.id } }), 0);

  const aggregates = await prisma.conectaRhAggregate.findMany({ where: { companyId }, orderBy: { firstReceivedAt: 'asc' } });
  const redacted = aggregates.find(item => item.data.personId === personId);
  assert.ok(redacted.data.redactedAt);
  assert.equal('cpf' in redacted.data, false);
  assert.equal(redacted.data.terminationDate, '2020-06-30');
  const untouched = aggregates.find(item => item.data.personId !== personId);
  assert.equal(untouched.data.cpf, '98765432100');

  for (const keep of [held, recentlyTerminated, active]) {
    const row = await prisma.collaborator.findUnique({ where: { id: keep.id } });
    assert.equal(row.cpf, '12345678901', keep.code);
    assert.equal(row.privacyAnonymizedAt, null, keep.code);
  }

  // Segunda execução não encontra mais nada para o mesmo colaborador.
  const again = await runCollaboratorRetention({ prismaClient: prisma, now, onlyIds: ids.collaborators });
  const stillAnonymized = await prisma.collaborator.findUnique({ where: { id: target.id } });
  assert.equal(stillAnonymized.privacyAnonymizedAt.getTime(), after.privacyAnonymizedAt.getTime());
  assert.equal(again.collaboratorsAnonymized, 0);

  const project = await prisma.project.create({ data: {
    code: `lgpd-${suffix}`, name: 'Projeto LGPD', clientName: 'Cliente', clientCnpj: '', contractCode: '', location: ''
  } });
  ids.projects.push(project.id);
  const survey = await prisma.satisfactionSurvey.create({ data: {
    projectId: project.id, tokenHash: `hash-${suffix}`, tokenEncrypted: 'x', tokenIv: 'x', tokenAuthTag: 'x',
    emailTo: 'cliente@exemplo.com', expiresAt: new Date('2023-01-01'), sentAt: new Date('2022-11-01'),
    respondedAt: new Date('2022-11-10'), submittedIp: '10.0.0.1', followUpNotes: 'ligar para Fulano',
    responses: { nps: 9, improvement: 'o técnico Fulano atrasou' }
  } });
  const surveyTotals = await runSurveyResponseRetention({ prismaClient: prisma, now, onlyIds: [survey.id] });
  assert.equal(surveyTotals.surveyResponsesAnonymized, 1);
  const surveyAfter = await prisma.satisfactionSurvey.findUnique({ where: { id: survey.id } });
  assert.equal(surveyAfter.emailTo, ANONYMIZED_SURVEY_EMAIL);
  assert.equal(surveyAfter.followUpNotes, null);
  assert.equal(surveyAfter.submittedIp, null);
  assert.deepEqual(surveyAfter.responses, { nps: 9 });
});
