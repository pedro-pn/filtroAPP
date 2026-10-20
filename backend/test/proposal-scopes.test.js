import assert from 'node:assert/strict';
import test from 'node:test';
import { contributionServiceKey, loadProposalScopes, resolveServiceContribution } from '../src/lib/acompanhamento/proposal-scopes.js';
import { projectReportsToProposal } from '../src/lib/databook/montar-dados.js';
const main = 'ACCESS_IMPORT:500', a = 'COMERCIAL_APP:502', b = 'COMERCIAL_APP:503';
const service = (id, meters = 20, extra = {}) => ({ id, serviceType: 'pressao', finalized: true, system: 'Linha', extraData: { tubes: [{ d: '2', unit: 'pol', c: String(meters) }], ...extra } });
const planned = key => ({ contributionKey: key, serviceType: 'TESTE_PRESSAO', systems: [{ systemType: 'TUBULACAO', quantity: 100, unit: 'M' }] });
const context = { main: { key: main }, options: [{ key: main }, { key: a }, { key: b }], planned: [planned(main), planned(a), planned(b)], plannedKey: s => s.contributionKey || main };

test('fontes mistas: o escopo consultado da mãe acompanha a principal e participa da sua versão', async () => {
  for (const source of ['ACCESS_IMPORT', 'COMERCIAL_APP']) {
    const other = source === 'ACCESS_IMPORT' ? 'COMERCIAL_APP' : 'ACCESS_IMPORT';
    const services = [planned(`${other}:500`), planned(`${other}:502`), planned(null)];
    const client = {
      projectBudget: { findUnique: async () => ({ source, sourceProposalCodBd: 500, commercialAppProposalId: 'mother' }) },
      projectAdditionalProposal: { findMany: async () => [] },
      commercialProposal: { findMany: async () => [{ codBd: 500, codProp: 500, nRev: 0 }] },
      commercialAppProposal: { findMany: async () => [{ externalId: 'mother', proposalCode: '500', revisionNumber: 0 }] }
    };
    const load = () => loadProposalScopes('project', client, { id: 'project', plannedServices: services });
    const loaded = await load();
    assert.deepEqual(services.map(loaded.plannedKey), [`${source}:500`, `${other}:502`, `${source}:500`]);
    assert.equal(services[0].contributionKey, `${other}:500`, 'a procedência persistida não muda');
    assert.equal(resolveServiceContribution(service('rdo', 15, { __proposalScope: { projectId: 'project', contributionKey: `${other}:500` } }),
      { reportType: 'RDO' }, loaded).key, loaded.main.key, 'origem da mãe em outra fonte acompanha a principal selecionada');
    services[0].systems[0].quantity++;
    assert.notEqual((await load()).main.version, loaded.main.version, 'editar o escopo consultado invalida a versão do databook da mãe');
  }
});

test('mesmo título/tipo nas propostas fica pendente; vínculo explícito prevalece e não depende do ID', () => {
  const s = service('s1');
  assert.equal(resolveServiceContribution(s, {}, context).key, null);
  const report = { contributionAssignments: { [contributionServiceKey(s)]: { contributionKey: a } } };
  assert.equal(resolveServiceContribution({ ...s, id: 'recriado' }, report, context).key, a);
  assert.equal(resolveServiceContribution(service('s1', 21), report, context).key, null);
  assert.equal(contributionServiceKey(s), contributionServiceKey({ ...s, extraData: { __uploads__: [], tubes: s.extraData.tubes } }));
});
test('remoção de adicional não reatribui automaticamente seus serviços à mãe', () => {
  assert.equal(resolveServiceContribution(service('s1'), {}, { ...context, options: [context.main], hasRetired: true }).key, null);
});
test('RDO misto: filtra serviços, texto, fotos, avanço anterior e técnico por chave explícita', () => {
  const m = service('mother', 100), sa = service('a', 20, { __uploads__: [{ label: 'A', files: ['/relatorios/a.jpg'] }] }), sb = service('b', 5);
  const assignments = { [contributionServiceKey(m)]: { contributionKey: main }, [contributionServiceKey(sa)]: { contributionKey: a }, [contributionServiceKey(sb)]: { contributionKey: b } };
  const rdo = { id: 'r', reportDate: '2026-10-19', sequenceNumber: 1, services: [m, sa, sb], dailyDescription: 'Texto geral da mãe', specialConditions: { generalUploads: ['/relatorios/mae.jpg'] }, contributionAssignments: assignments };
  const derived = [{ id: 'ta', reportType: 'RTP', specialConditions: { parentRdoId: 'r', serviceId: 'a' } },
    { id: 'tm', reportType: 'RTP', specialConditions: { parentRdoId: 'r', serviceId: 'mother' } },
    { id: 'guess', reportType: 'RTP', reportDate: '2026-10-19', services: [service('unknown')], specialConditions: { serviceData: { 'Desenhos / TAGs': 'Linha' } } }];
  const projected = projectReportsToProposal([rdo], [rdo], derived, context, a);
  assert.deepEqual(projected.rdos[0].services.map(s => s.id), ['a']);
  assert.equal(projected.rdos[0].dailyDescription, '');
  assert.deepEqual(projected.rdos[0].specialConditions.generalUploads, []);
  assert.deepEqual(projected.derivados.map(r => r.id), ['ta']);
  assert.deepEqual(projected.rdosAvanco[0].services.map(s => s.id), ['a']);
  assert.match(projected.avisos[0], /omitidos/);
  assert.equal(rdo.services.length, 3);
});

test('retenta conflito PostgreSQL na confirmação da transação via adapter sem duplicar efeitos', async () => {
  const { commercialTransaction } = await import('../src/lib/acompanhamento/commercial-contributions.js');
  let attempts = 0;
  const database = { $transaction: async operation => {
    if (++attempts === 1) throw Object.assign(new Error('TransactionWriteConflict'), { cause: { originalCode: '40001' } });
    return operation();
  } };
  assert.equal(await commercialTransaction(async () => 'confirmed', database), 'confirmed');
  assert.equal(attempts, 2);
});

test('meta global ou escopo ausente da mãe não permite atribuir automaticamente seu realizado ao adicional', () => {
  const projectSystem = { id: 'sys', equipment: 'Unidade', name: 'Linha' };
  const linked = { contributionKey: a, serviceType: 'TESTE_PRESSAO', systems: [{ projectSystemId: 'sys', projectSystem,
    systemType: 'TUBULACAO', quantity: 20, diameter: '2', diameterUnit: 'pol' }] };
  const contextWithGlobal = { ...context, options: [{ key: main }, { key: a }], planned: [planned(main), linked] };
  const reported = service('s', 15, { __projectSystemId: 'sys' });
  assert.equal(resolveServiceContribution(reported, {}, contextWithGlobal).key, null, 'o cadastro global da principal também pode ser o dono');
  assert.equal(resolveServiceContribution(reported, {}, { ...contextWithGlobal, planned: [linked] }).key, null, 'principal sem escopo estruturado exige conferência');
  const distinct = { ...planned(main), systems: [{ systemType: 'MANGOTE', quantity: 10 }] };
  assert.equal(resolveServiceContribution(reported, {}, { ...contextWithGlobal, planned: [distinct, linked] }).key, a, 'métricas distintas permitem vínculo único');
});

test('proposta registrada no escopo do RDO resolve o serviço mesmo com outros adicionais sem escopo', () => {
  const project = { id: 'project' };
  const incomplete = { ...context, project, planned: [planned(main)], hasRetired: true };
  const rdo = { reportType: 'RDO' };
  for (const key of [main, a, b]) {
    const reported = service('s', 15, { __proposalScope: { projectId: project.id, contributionKey: key } });
    assert.equal(resolveServiceContribution(reported, rdo, incomplete).key, key);
    const assignment = { contributionAssignments: { [contributionServiceKey(reported)]: { contributionKey: a } } };
    assert.equal(resolveServiceContribution(reported, { ...rdo, ...assignment }, incomplete).key, a, 'conferência manual tem prioridade sobre o escopo do RDO');
    const unassigned = { contributionAssignments: { [contributionServiceKey(reported)]: { contributionKey: null } } };
    assert.equal(resolveServiceContribution(reported, { ...rdo, ...unassigned }, incomplete).key, null);
    assert.equal(resolveServiceContribution(reported, { reportType: 'RLQ' }, incomplete).key, null, 'técnico independente não usa metadados exclusivos do RDO');
  }
  for (const scope of [{ projectId: 'other', contributionKey: a }, { projectId: project.id, contributionKey: 'ACCESS_IMPORT:removed' }]) {
    assert.equal(resolveServiceContribution(service('s', 15, { __proposalScope: scope }), rdo, incomplete).key, null);
  }
  assert.equal(resolveServiceContribution(service('s'), {}, { ...incomplete, hasRetired: false }).key, null,
    'dados antigos sem origem comprovada continuam pendentes');
});
