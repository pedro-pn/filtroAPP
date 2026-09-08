import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadModule(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

function project(overrides = {}) {
  return {
    id: 'project-1',
    code: '005719',
    name: 'Ilha Solteira',
    isActive: true,
    visibleToCollaborators: false,
    managerOnly: false,
    registrationPending: true,
    inhibitionServiceEnabled: false,
    requireServiceReportSignatures: false,
    clientName: 'Cliente Exemplo',
    clientCnpj: '12345678000190',
    clientEmailPrimary: '',
    clientEmailCc: [],
    clientSigners: [],
    contractCode: 'CT-001',
    location: 'Ilha Solteira - SP',
    workdayHours: '09:00',
    weekendWorkdayHours: '08:00',
    includesSaturday: false,
    includesSunday: false,
    operatorId: null,
    ...overrides
  };
}

test('pending project review validates and normalizes all six required fields', async () => {
  const review = await loadModule('/src/pages/gestor/projectPendingReview.ts');
  const parsed = review.pendingProjectReviewPayload({
    code: ' 005719 ',
    name: ' Ilha Solteira ',
    clientName: ' Cliente Exemplo ',
    clientCnpj: '12.345.678/0001-90',
    contractCode: ' CT-001 ',
    location: ' Ilha Solteira - SP '
  });
  assert.deepEqual(parsed, {
    code: '005719',
    name: 'Ilha Solteira',
    clientName: 'Cliente Exemplo',
    clientCnpj: '12345678000190',
    contractCode: 'CT-001',
    location: 'Ilha Solteira - SP'
  });

  for (const field of ['code', 'name', 'clientName', 'contractCode', 'location']) {
    const invalid = { ...parsed, [field]: '' };
    assert.equal(review.pendingProjectReviewSchema.safeParse(invalid).success, false, field);
  }
  assert.equal(review.pendingProjectReviewSchema.safeParse({ ...parsed, clientCnpj: '123' }).success, false);
  const proposalError = review.pendingProjectReviewSchema.safeParse({ ...parsed, contractCode: '' });
  assert.match(proposalError.error.issues[0].message, /Proposta/);
});

test('pending projects are counted, partitioned and identify webhook or Romaneio origin', async () => {
  const review = await loadModule('/src/pages/gestor/projectPendingReview.ts');
  const readyProject = project({ id: 'ready', registrationPending: false });
  const pendingProject = project({ id: 'pending' });
  const romaneioProject = project({
    id: 'pending-romaneio',
    name: '',
    clientName: '',
    clientCnpj: '',
    contractCode: '',
    location: ''
  });
  const groups = review.partitionProjectsByRegistration([readyProject, pendingProject]);

  assert.deepEqual(groups.pending.map(item => item.id), ['pending']);
  assert.deepEqual(groups.ready.map(item => item.id), ['ready']);
  const sequencedProject = project({
    reportSequences: [{ id: 'sequence-1', projectId: 'project-1', reportType: 'RDO', nextNumber: 8 }]
  });
  assert.equal(review.projectTitle(sequencedProject), '005719 - Ilha Solteira');
  assert.equal(review.projectVisibilityLabel(sequencedProject), 'Gestor e coordenador');
  assert.match(review.formatProjectSequences(sequencedProject), /RDO: próximo 8/);
  assert.ok(review.projectSearchParts(sequencedProject).includes('Ilha Solteira - SP'));
  assert.equal(review.pendingProjectRegistrationSource(pendingProject), 'WEBHOOK');
  assert.equal(review.pendingProjectRegistrationSource(romaneioProject), 'ROMANEIO');
  assert.equal(
    review.pendingProjectRegistrationMessage([pendingProject]),
    'Há 1 projeto recebido pelo webhook aguardando verificação manual.'
  );
  assert.match(review.pendingProjectRegistrationMessage([pendingProject, project({ id: 'pending-2' })]), /2 projetos recebidos pelo webhook/);
  assert.match(review.pendingProjectRegistrationMessage([pendingProject, romaneioProject]), /1 via webhook e 1 pelo Romaneio/);
  assert.match(review.automaticProjectReviewMessage(pendingProject), /recebido pelo webhook/i);
  assert.match(review.automaticProjectReviewMessage(romaneioProject), /criado pelo Romaneio/i);
});

test('project intake novelty is once per user and expires globally after 10 days', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-08-13T12:00:00-03:00').getTime();
    const navigation = await loadModule('/src/auth/moduleNavigation.ts');
    assert.equal(navigation.shouldShowProjectIntakeNovelty({ id: 'manager-1' }), true);
    navigation.markProjectIntakeNoveltySeen({ id: 'manager-1' });
    assert.equal(navigation.shouldShowProjectIntakeNovelty({ id: 'manager-1' }), false);
    assert.equal(navigation.shouldShowProjectIntakeNovelty({ id: 'manager-2' }), true);

    Date.now = () => new Date('2026-08-24T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowProjectIntakeNovelty({ id: 'manager-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});
