import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import {
  ProjectIntakeConflictError,
  projectIntakeCreateData,
  projectIntakeSchema,
  receiveProjectIntake,
  selectProjectIntakeCommercialRevision
} from '../src/lib/projects/project-intake.js';

const validPayload = {
  code: '005719',
  name: 'Ilha Solteira',
  clientName: 'Cliente Exemplo S.A.',
  clientCnpj: '12.345.678/0001-90',
  proposalCode: '3088',
  revision: 2,
  location: 'Ilha Solteira - SP'
};

function dispatchApp(method, pathName, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = pathName;
    req.headers = {
      host: '127.0.0.1',
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {}),
      ...headers
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '198.51.100.20';
    req.socket.encrypted = false;
    req.connection = req.socket;

    const chunks = [];
    const responseHeaders = new Map();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.statusCode = 200;
    res.setHeader = (name, value) => responseHeaders.set(String(name).toLowerCase(), value);
    res.getHeader = name => responseHeaders.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(responseHeaders);
    res.removeHeader = name => responseHeaders.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([name, value]) => res.setHeader(name, value));
      return res;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

function projectFromPayload(payload = validPayload, overrides = {}) {
  const projectFields = { ...projectIntakeSchema.parse(payload) };
  delete projectFields.revision;
  return {
    id: 'project-1',
    ...projectFields,
    registrationPending: true,
    ...overrides
  };
}

function stubProjectClient(t, { existing = null, created = projectFromPayload(), createError = null, concurrent = null } = {}) {
  const originalFindUnique = prisma.project.findUnique;
  const originalCreate = prisma.project.create;
  const originalBudgetFindUnique = prisma.projectBudget.findUnique;
  const originalProposalFindFirst = prisma.commercialProposal.findFirst;
  let findCount = 0;
  const calls = [];
  prisma.project.findUnique = async args => {
    calls.push(['findUnique', args]);
    findCount += 1;
    return findCount === 1 ? existing : concurrent;
  };
  prisma.project.create = async args => {
    calls.push(['create', args]);
    if (createError) throw createError;
    return created;
  };
  prisma.projectBudget.findUnique = async args => {
    calls.push(['budgetFindUnique', args]);
    return null;
  };
  prisma.commercialProposal.findFirst = async args => {
    calls.push(['proposalFindFirst', args]);
    return null;
  };
  t.after(() => {
    prisma.project.findUnique = originalFindUnique;
    prisma.project.create = originalCreate;
    prisma.projectBudget.findUnique = originalBudgetFindUnique;
    prisma.commercialProposal.findFirst = originalProposalFindFirst;
  });
  return calls;
}

function intakeClient(project) {
  return {
    project,
    projectBudget: {
      async findUnique() { return null; }
    },
    commercialProposal: {
      async findFirst() { return null; }
    }
  };
}

function configureToken(t, token) {
  const original = env.projectIntakeWebhookToken;
  env.projectIntakeWebhookToken = token;
  t.after(() => {
    env.projectIntakeWebhookToken = original;
  });
}

test('project intake schema normalizes fields and formats the proposal with its revision', () => {
  const parsed = projectIntakeSchema.parse({
    ...validPayload,
    code: ' 005719 ',
    name: ' Ilha Solteira ',
    clientCnpj: '12.345.678/0001-90',
    proposalCode: ' 3088 '
  });

  assert.equal(parsed.code, '005719');
  assert.equal(parsed.name, 'Ilha Solteira');
  assert.equal(parsed.clientCnpj, '12345678000190');
  assert.equal(parsed.contractCode, '3088 Rev. 2');
  assert.equal('proposalCode' in parsed, false);
  assert.equal(parsed.revision, 2);
});

test('project intake schema treats revision -1 as an unformatted proposal and commercial revision zero', () => {
  const parsed = projectIntakeSchema.parse({ ...validPayload, revision: -1 });

  assert.equal(parsed.contractCode, '3088');
  assert.equal(parsed.revision, 0);
});

test('project intake schema rejects missing, extra, invalid CNPJ and invalid revision fields', () => {
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, location: '' }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, clientCnpj: '1234567890123' }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, clientCnpj: '123456789012345' }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, revision: undefined }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, revision: -2 }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, revision: 1.5 }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, revision: '2' }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, proposalCode: 'sem-numero' }));
  assert.throws(() => projectIntakeSchema.parse({
    ...validPayload,
    proposalCode: undefined,
    contractCode: '3088'
  }));
  assert.throws(() => projectIntakeSchema.parse({ ...validPayload, unexpected: 'field' }));
  const missingProposal = projectIntakeSchema.safeParse({ ...validPayload, proposalCode: '' });
  assert.match(missingProposal.error.issues[0].message, /Proposta/);
});

test('projectIntakeCreateData keeps a new project pending and operationally restricted', () => {
  const data = projectIntakeCreateData(projectIntakeSchema.parse(validPayload));
  assert.equal(data.registrationPending, true);
  assert.equal(data.visibleToCollaborators, false);
  assert.equal(data.managerOnly, false);
  assert.equal(data.clientEmailPrimary, '');
  assert.deepEqual(data.clientEmailCc, []);
  assert.deepEqual(data.clientSigners, []);
  assert.equal(data.contractCode, '3088 Rev. 2');
  assert.equal('revision' in data, false);
});

test('selectProjectIntakeCommercialRevision selects the matching primary proposal through the existing budget flow', async () => {
  const intake = projectIntakeSchema.parse(validPayload);
  const project = projectFromPayload();
  const proposal = {
    codBd: 9902,
    codProp: 3088,
    nRev: 2,
    parentCodProp: null,
    serviceModality: 'INLOCO',
    salePrice: 1000,
    plannedCost: 600,
    expectedProfit: 400,
    expectedMargin: 40,
    taxes: 100,
    plannedDays: 5,
    mobilizationLeadDays: 2,
    isComplete: true
  };
  const calls = [];
  const client = {
    commercialProposal: {
      async findFirst(args) {
        calls.push(['proposalFindFirst', args]);
        return proposal;
      },
      async findUnique(args) {
        calls.push(['proposalFindUnique', args]);
        return proposal;
      }
    },
    projectBudget: {
      async findUnique() { return null; },
      async upsert(args) {
        calls.push(['budgetUpsert', args]);
        return { sourceProposalCodBd: proposal.codBd };
      }
    },
    project: {
      async findUnique() { return project; },
      async update(args) {
        calls.push(['projectUpdate', args]);
        return project;
      }
    },
    async $transaction(callback) { return callback(client); }
  };

  const result = await selectProjectIntakeCommercialRevision(project, intake, client);

  assert.deepEqual(result, {
    status: 'selected',
    proposalCode: '3088',
    revision: 2,
    selectedCodBd: 9902
  });
  const lookup = calls.find(([name]) => name === 'proposalFindFirst')[1];
  assert.deepEqual(lookup.where, { codProp: 3088, nRev: 2, parentCodProp: null });
  assert.deepEqual(lookup.orderBy, [
    { modifiedInAccessAt: { sort: 'desc', nulls: 'last' } },
    { codBd: 'desc' }
  ]);
  assert.equal(calls.some(([name]) => name === 'budgetUpsert'), true);
  assert.equal(calls.some(([name]) => name === 'projectUpdate'), true);
});

test('selectProjectIntakeCommercialRevision selects revision zero when the webhook sends -1', async () => {
  const intake = projectIntakeSchema.parse({ ...validPayload, revision: -1 });
  const project = projectFromPayload({ ...validPayload, revision: -1 });
  const proposal = {
    codBd: 9900,
    codProp: 3088,
    nRev: 0,
    parentCodProp: null,
    isComplete: false
  };
  let lookupWhere = null;
  const client = {
    commercialProposal: {
      async findFirst(args) {
        lookupWhere = args.where;
        return { codBd: proposal.codBd };
      },
      async findUnique() { return proposal; }
    },
    projectBudget: {
      async findUnique() { return null; },
      async upsert() { return { sourceProposalCodBd: proposal.codBd }; }
    },
    project: {
      async findUnique() { return project; },
      async update() { return project; }
    },
    async $transaction(callback) { return callback(client); }
  };

  const result = await selectProjectIntakeCommercialRevision(project, intake, client);

  assert.deepEqual(lookupWhere, { codProp: 3088, nRev: 0, parentCodProp: null });
  assert.deepEqual(result, {
    status: 'selected',
    proposalCode: '3088',
    revision: 0,
    selectedCodBd: 9900
  });
});

test('selectProjectIntakeCommercialRevision preserves an existing manual selection', async () => {
  const project = projectFromPayload();
  let mutationCount = 0;
  const result = await selectProjectIntakeCommercialRevision(project, projectIntakeSchema.parse(validPayload), {
    projectBudget: {
      async findUnique() { return { sourceProposalCodBd: 8801 }; }
    },
    commercialProposal: {
      async findFirst() { return { codBd: 9902 }; }
    },
    project: {
      async update() { mutationCount += 1; }
    }
  });

  assert.equal(result.status, 'existing_selection_preserved');
  assert.equal(result.selectedCodBd, 8801);
  assert.equal(mutationCount, 0);
});

test('receiveProjectIntake selects a revision imported after the first idempotent webhook', async () => {
  const existing = projectFromPayload(validPayload, { registrationPending: false });
  let proposal = null;
  let selectedCodBd = null;
  const client = {
    commercialProposal: {
      async findFirst() { return proposal ? { codBd: proposal.codBd } : null; },
      async findUnique() { return proposal; }
    },
    projectBudget: {
      async findUnique() {
        return selectedCodBd === null ? null : { sourceProposalCodBd: selectedCodBd };
      },
      async upsert(args) {
        selectedCodBd = args.create.sourceProposalCodBd;
        return { sourceProposalCodBd: selectedCodBd };
      }
    },
    project: {
      async findUnique() { return existing; },
      async create() { throw new Error('must not create'); },
      async update() { return existing; }
    },
    async $transaction(callback) { return callback(client); }
  };

  const beforeImport = await receiveProjectIntake(validPayload, client);
  assert.equal(beforeImport.commercialRevision.status, 'not_found');

  proposal = {
    codBd: 9902,
    codProp: 3088,
    nRev: 2,
    parentCodProp: null,
    isComplete: false
  };
  const afterImport = await receiveProjectIntake(validPayload, client);
  assert.equal(afterImport.status, 'already_exists');
  assert.equal(afterImport.project.registrationPending, false);
  assert.equal(afterImport.commercialRevision.status, 'selected');
  assert.equal(afterImport.commercialRevision.selectedCodBd, 9902);
});

test('POST /api/webhooks/projects returns 503 when the integration is not configured', async t => {
  configureToken(t, '');
  const response = await dispatchApp('POST', '/api/webhooks/projects', validPayload);
  assert.equal(response.statusCode, 503);
  assert.equal(response.json.code, 'PROJECT_WEBHOOK_NOT_CONFIGURED');
});

test('POST /api/webhooks/projects returns the same 401 for missing and invalid tokens', async t => {
  configureToken(t, 'secret-token');
  const missing = await dispatchApp('POST', '/api/webhooks/projects', validPayload);
  const invalid = await dispatchApp('POST', '/api/webhooks/projects', validPayload, {
    authorization: 'Bearer wrong-token'
  });
  assert.equal(missing.statusCode, 401);
  assert.equal(invalid.statusCode, 401);
  assert.deepEqual(missing.json, invalid.json);
});

test('POST /api/webhooks/projects creates and returns a normalized pending project', async t => {
  configureToken(t, 'secret-token');
  const calls = stubProjectClient(t);
  const response = await dispatchApp('POST', '/api/webhooks/projects', {
    ...validPayload,
    code: ' 005719 ',
    name: ' Ilha Solteira '
  }, { authorization: 'Bearer secret-token' });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.status, 'created');
  assert.equal(response.json.commercialRevision.status, 'not_found');
  assert.equal(response.json.project.proposalCode, '3088 Rev. 2');
  assert.equal('contractCode' in response.json.project, false);
  assert.equal(response.json.commercialRevision.proposalCode, '3088');
  assert.equal('contractCode' in response.json.commercialRevision, false);
  const createCall = calls.find(([name]) => name === 'create');
  assert.equal(createCall[1].data.code, '005719');
  assert.equal(createCall[1].data.clientCnpj, '12345678000190');
  assert.equal(createCall[1].data.contractCode, '3088 Rev. 2');
  assert.equal('revision' in createCall[1].data, false);
  assert.equal(createCall[1].data.registrationPending, true);
});

test('POST /api/webhooks/projects accepts revision -1 without persisting it in the proposal text', async t => {
  configureToken(t, 'secret-token');
  const payload = { ...validPayload, revision: -1 };
  const calls = stubProjectClient(t, { created: projectFromPayload(payload) });
  const response = await dispatchApp('POST', '/api/webhooks/projects', payload, {
    authorization: 'Bearer secret-token'
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.project.proposalCode, '3088');
  assert.equal(response.json.commercialRevision.revision, 0);
  const createCall = calls.find(([name]) => name === 'create');
  assert.equal(createCall[1].data.contractCode, '3088');
  assert.equal('revision' in createCall[1].data, false);
  const proposalLookup = calls.find(([name]) => name === 'proposalFindFirst');
  assert.equal(proposalLookup[1].where.nRev, 0);
});

test('receiveProjectIntake treats an identical pending or reviewed project as idempotent without mutation', async () => {
  for (const payload of [validPayload, { ...validPayload, revision: -1 }]) {
    for (const registrationPending of [true, false]) {
      let createCount = 0;
      const existing = projectFromPayload(payload, { registrationPending });
      const result = await receiveProjectIntake(payload, intakeClient({
        async findUnique() { return existing; },
        async create() { createCount += 1; }
      }));
      assert.equal(result.status, 'already_exists');
      assert.equal(result.project.registrationPending, registrationPending);
      assert.equal(result.commercialRevision.status, 'not_found');
      assert.equal(createCount, 0);
    }
  }
});

test('receiveProjectIntake rejects a divergent existing project without updating it', async () => {
  for (const [field, value] of [
    ['name', 'Outro nome'],
    ['clientName', 'Outro cliente'],
    ['clientCnpj', '98765432000199'],
    ['contractCode', 'OUTRA-PROPOSTA'],
    ['location', 'Outro local']
  ]) {
    await assert.rejects(
      receiveProjectIntake(validPayload, intakeClient({
          async findUnique() { return projectFromPayload(validPayload, { [field]: value }); },
          async create() { throw new Error('must not create'); }
      })),
      error => error instanceof ProjectIntakeConflictError && error.code === 'PROJECT_CODE_CONFLICT',
      field
    );
  }
});

test('receiveProjectIntake treats an existing soft-deleted record as a reserved code', async () => {
  await assert.rejects(receiveProjectIntake(validPayload, intakeClient({
      async findUnique() {
        return projectFromPayload(validPayload, { deletedAt: new Date(), name: 'Projeto excluído' });
      },
      async create() { throw new Error('must not create'); }
  })), ProjectIntakeConflictError);
});

test('receiveProjectIntake recovers a concurrent equal project after P2002', async () => {
  const uniqueError = new Error('unique project code');
  uniqueError.code = 'P2002';
  let findCount = 0;
  const result = await receiveProjectIntake(validPayload, intakeClient({
      async findUnique() {
        findCount += 1;
        return findCount === 1 ? null : projectFromPayload();
      },
      async create() { throw uniqueError; }
  }));
  assert.equal(result.status, 'already_exists');
});

test('receiveProjectIntake rejects a concurrent divergent project after P2002', async () => {
  const uniqueError = new Error('unique project code');
  uniqueError.code = 'P2002';
  let findCount = 0;
  await assert.rejects(receiveProjectIntake(validPayload, intakeClient({
      async findUnique() {
        findCount += 1;
        return findCount === 1 ? null : projectFromPayload(validPayload, { contractCode: 'OUTRO' });
      },
      async create() { throw uniqueError; }
  })), ProjectIntakeConflictError);
});

test('POST /api/webhooks/projects returns a stable conflict without exposing internals', async t => {
  configureToken(t, 'secret-token');
  stubProjectClient(t, { existing: projectFromPayload(validPayload, { name: 'Outro nome' }) });
  const response = await dispatchApp('POST', '/api/webhooks/projects', validPayload, {
    authorization: 'Bearer secret-token'
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json.code, 'PROJECT_CODE_CONFLICT');
  assert.equal('stack' in response.json, false);
});

test('POST /api/webhooks/projects rejects invalid data before touching the database', async t => {
  configureToken(t, 'secret-token');
  let touchedDatabase = false;
  const originalFindUnique = prisma.project.findUnique;
  prisma.project.findUnique = async () => {
    touchedDatabase = true;
    return null;
  };
  t.after(() => {
    prisma.project.findUnique = originalFindUnique;
  });

  const response = await dispatchApp('POST', '/api/webhooks/projects', {
    ...validPayload,
    clientCnpj: '123456789012345'
  }, { authorization: 'Bearer secret-token' });
  assert.equal(response.statusCode, 400);
  assert.equal(touchedDatabase, false);
});

test('POST /api/webhooks/projects rejects the obsolete contractCode field without compatibility alias', async t => {
  configureToken(t, 'secret-token');
  let touchedDatabase = false;
  const originalFindUnique = prisma.project.findUnique;
  prisma.project.findUnique = async () => {
    touchedDatabase = true;
    return null;
  };
  t.after(() => {
    prisma.project.findUnique = originalFindUnique;
  });

  const { proposalCode: _proposalCode, ...obsoletePayload } = validPayload;
  const response = await dispatchApp('POST', '/api/webhooks/projects', {
    ...obsoletePayload,
    contractCode: '3088'
  }, { authorization: 'Bearer secret-token' });

  assert.equal(response.statusCode, 400);
  assert.equal(touchedDatabase, false);
});
