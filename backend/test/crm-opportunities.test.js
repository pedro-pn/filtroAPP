import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCrmOpportunity } from '../src/lib/projects/crm-opportunities.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { validatePlaygroundRequest } from '../src/lib/api-credentials/playground.js';
import { validateProjectWriteAccess } from '../src/lib/api-credentials/efetivo-project-writes.js';

const hot = { externalId: 'prisma-123', sourceVersion: 1, sourceUpdatedAt: '2026-10-20T12:00:00Z',
  status: 'HOT', name: 'Limpeza', clientName: 'Cliente' };
const project = { code: '5801', name: 'Limpeza', clientName: 'Cliente', clientCnpj: '12345678000190',
  proposalCode: '4621', revision: 0, location: 'Sede' };

test('oportunidade quente exige somente identidade, versão, sinalização, nome e cliente', () => {
  const parsed = validateCrmOpportunity(hot);
  assert.equal(parsed.project, null);
  assert.equal(parsed.clientCnpj, null);
  assert.equal(parsed.proposalCode, null);
  assert.equal(parsed.estimatedValue, null);
  assert.equal(validateCrmOpportunity({ ...hot, expectedStartDate: '2026-12-01', estimatedValue: 123.45 }).estimatedValue, 123.45);
  for (const change of [{ sourceVersion: 0 }, { sourceVersion: 1.5 }, { name: '' }, { externalId: '' },
    { project }, { expectedStartDate: '2026-02-30' }, { externalUrl: 'javascript:alert(1)' },
    { estimatedValue: -1 }, { estimatedValue: 0.001 }, { probability: 90 }]) {
    assert.throws(() => validateCrmOpportunity({ ...hot, ...change }));
  }
});

test('fechamento exige cadastro definitivo válido e cliente correspondente', () => {
  assert.throws(() => validateCrmOpportunity({ ...hot, status: 'WON' }));
  assert.throws(() => validateCrmOpportunity({ ...hot, status: 'WON', project: { ...project, proposalCode: 'inválida' } }));
  assert.throws(() => validateCrmOpportunity({ ...hot, status: 'WON', clientCnpj: '98765432000199', project }));
  assert.equal(validateCrmOpportunity({ ...hot, status: 'WON', clientCnpj: '12.345.678/0001-90', project }).project.code, '5801');
});

test('rota e playground usam os dois escopos e exigem acesso ALL', () => {
  const route = createOperationalRouter().stack.find(layer => layer.route?.path === '/acompanhamento/oportunidades').route;
  for (const scopes of [[], ['efetivo.projetos.create'], ['acompanhamento.oportunidades.write']]) {
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    route.stack[0].handle({ apiAuth: { scopeCodes: new Set(scopes) }, query: {} }, res, () => assert.fail('Escopos incompletos'));
    assert.equal(res.statusCode, 403);
  }
  let allowed = false;
  route.stack[0].handle({ apiAuth: { scopeCodes: new Set(['efetivo.projetos.create', 'acompanhamento.oportunidades.write']) }, query: {} }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
  assert.throws(() => validateProjectWriteAccess(null, {}, { projectAccessMode: 'SELECTED' }, { create: true }), error => error.code === 'PROJECT_NOT_ALLOWED');
  assert.equal(validatePlaygroundRequest({ operationId: 'acompanhamento.opportunities.post', body: hot }).body.status, 'HOT');
  assert.throws(() => validatePlaygroundRequest({ operationId: 'acompanhamento.opportunities.post', body: { ...hot, status: 'WON' } }));
});
