import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

test('project systems HTTP + PostgreSQL: scope, all UGs, permissions, aliases, historical links and history', { skip: !process.env.SYSTEMS_TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.SYSTEMS_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { computeProgressHistoryForProjects } = await import('../src/lib/acompanhamento/avanco.js');
  const suffix = randomUUID();
  const projectIds = [], userIds = [];
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.projectPlannedService.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.historicalServiceReport.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.report.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
  for (const code of ['main', 'other']) {
    const project = await prisma.project.create({ data: { code: `systems-${code}-${suffix}`, name: 'UGs teste', clientName: 'Cliente teste', clientCnpj: '', contractCode: '', location: '', isActive: true } });
    projectIds.push(project.id);
  }
  const tokens = [];
  for (const [role, accountType, module, moduleRole] of [['MANAGER', 'ADMIN', 'RDO', 'RDO_MANAGER'], ['COLLABORATOR', 'INTERNAL', 'RDO', 'RDO_COLLABORATOR'], ['COLLABORATOR', 'INTERNAL', 'ACOMPANHAMENTO', 'ACOMPANHAMENTO_VIEWER']]) {
    const user = await prisma.user.create({ data: { username: `systems-${userIds.length}-${suffix}`, name: 'Teste', passwordHash: 'test-only', role, accountType, reportEmissionPermissions: ['SITE_RDO'], moduleRoles: { create: { module, role: moduleRole } } } });
    userIds.push(user.id);
    const token = randomUUID(); tokens.push(token);
    await prisma.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
  }
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, method = 'GET', body, token = tokens[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const scopePath = `/acompanhamento/comercial/projetos/${projectIds[0]}/escopo-previsto`;
  const systemsPath = `/acompanhamento/comercial/projetos/${projectIds[0]}/sistemas`;
  const progressPath = `/acompanhamento/comercial/projetos/${projectIds[0]}/avanco`;
  const suggestionsPath = `/rdo/reports/project-systems/${projectIds[0]}`;
  const scope = { services: [{ serviceType: 'LIMPEZA_QUIMICA', weight: 100, systems: ['01', '02', '14'].map(ug => ({ equipment: `Unidade Geradora ${ug}`, systemName: 'Regulador de velocidade', systemType: 'TUBULACAO', unit: 'M', quantity: 100, diameter: '2', diameterUnit: 'pol' })) }] };
  assert.equal((await request(scopePath, 'PUT', scope, tokens[2])).status, 403);
  const saved = await request(scopePath, 'PUT', scope);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const ids = saved.data.services[0].systems.map(system => system.projectSystemId);
  assert.equal(new Set(ids).size, 3);
  const again = await request(scopePath, 'PUT', scope);
  assert.deepEqual(again.data.services[0].systems.map(system => system.projectSystemId), ids);
  assert.equal((await request(suggestionsPath, 'GET', undefined, '')).status, 401);
  assert.equal((await request(suggestionsPath, 'GET', undefined, tokens[1])).status, 404);
  await prisma.project.update({ where: { id: projectIds[0] }, data: { authorizedUsers: { create: { userId: userIds[1] } } } });
  assert.equal((await request(suggestionsPath, 'GET', undefined, tokens[1])).data.length, 3);
  assert.equal((await request(`/rdo/reports/project-systems/${projectIds[1]}`, 'GET', undefined, tokens[1])).status, 404);
  const foreignPayload = structuredClone(scope);
  foreignPayload.services[0].systems.forEach((system, index) => { system.projectSystemId = ids[index]; });
  const foreign = await request(`/acompanhamento/comercial/projetos/${projectIds[1]}/escopo-previsto`, 'PUT', foreignPayload);
  assert.equal(foreign.status, 400);
  assert.match(foreign.data.error, /não corresponde/);
  const mixed = structuredClone(scope); mixed.services[0].systems.push({ systemType: 'TUBULACAO', quantity: 300, unit: 'M' });
  assert.equal((await request(scopePath, 'PUT', mixed)).status, 400);
  const historyBase = `/rdo/reports/historical-services/${projectIds[0]}`;
  const csv = 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade\nRLQ;1;01/01/2026;Limpeza;UG01;RV;2;50;m\nRLQ;1;01/01/2026;Limpeza;UG01;Mancais superior e inferior;3;30;m';
  const preview = await request(`${historyBase}/preview`, 'POST', { csv });
  assert.equal((await request(`${historyBase}/import`, 'POST', { csv, token: preview.data.token })).status, 201);
  assert.equal((await request(progressPath)).data.progressPct, 0);
  const alias = { equipment: 'UG01', system: 'RV', serviceType: 'LIMPEZA_QUIMICA', revision: 1 };
  assert.equal((await request(`${systemsPath}/${ids[0]}/alias`, 'PUT', alias, tokens[2])).status, 403);
  const linked = await request(`${systemsPath}/${ids[0]}/alias`, 'PUT', alias);
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal((await request(`${systemsPath}/${ids[0]}/alias`, 'PUT', alias)).status, 409);
  const progress = (await request(progressPath)).data;
  assert.equal(progress.progressPct, 16.7);
  assert.deepEqual(progress.services[0].systems.map(system => system.realizedQty), [50, 0, 0]);
  assert.equal(progress.pendingMeasurements.length, 1);
  assert.equal((await computeProgressHistoryForProjects([projectIds[0]])).get(projectIds[0]).at(-1).progressPct, progress.progressPct);
  const historical = (await request(historyBase)).data.items[0];
  const before = await prisma.historicalServiceReport.findUnique({ where: { id: historical.id } });
  const itemPath = `${historyBase}/${historical.id}/items/0/system`;
  assert.equal((await request(itemPath, 'PUT', { projectSystemId: ids[1], revision: 1 }, tokens[1])).status, 403);
  assert.equal((await request(itemPath, 'PUT', { projectSystemId: 'foreign', revision: 1 })).status, 400);
  const mapped = await request(itemPath, 'PUT', { projectSystemId: ids[1], revision: 1 });
  assert.equal(mapped.status, 200, JSON.stringify(mapped.data));
  assert.equal(mapped.data.fingerprint, before.fingerprint);
  assert.equal(mapped.data.items[0].system, 'RV');
  assert.equal((await request(itemPath, 'PUT', { projectSystemId: ids[1], revision: 1 })).status, 409);
  assert.deepEqual((await request(progressPath)).data.services[0].systems.map(system => system.realizedQty), [0, 50, 0]);
  assert.equal((await request(`${historyBase}/preview`, 'POST', { csv })).data.reports[0].action, 'SKIP');
  assert.equal(await prisma.equipment.count(), 0);
  const unitScope = structuredClone(scope);
  unitScope.services[0].systems.push({ equipment: 'Unidade Geradora 02', systemName: 'Mancal de escora', systemType: 'SISTEMA', unit: 'UN', quantity: 4 });
  for (const patch of [{ quantity: 1.5 }, { quantity: 0 }, { quantity: null }, { equipment: '' }, { systemName: '' }]) {
    const invalid = structuredClone(unitScope); Object.assign(invalid.services[0].systems.at(-1), patch);
    assert.equal((await request(scopePath, 'PUT', invalid)).status, 400);
  }
  const wrongService = structuredClone(unitScope); wrongService.services[0].serviceType = 'FLUSHING';
  assert.equal((await request(scopePath, 'PUT', wrongService)).status, 400);
  const unitSaved = await request(scopePath, 'PUT', unitScope);
  assert.equal(unitSaved.status, 200, JSON.stringify(unitSaved.data));
  const unitSystem = unitSaved.data.services[0].systems.at(-1);
  assert.equal(unitSystem.unit, 'UN');
  const suggestion = (await request(suggestionsPath, 'GET', undefined, tokens[1])).data.find(item => item.id === unitSystem.projectSystemId);
  assert.deepEqual(suggestion.measurements, [{ serviceType: 'LIMPEZA_QUIMICA', systemType: 'SISTEMA' }]);
  assert.equal(suggestion.measurements[0].quantity, undefined); // suggestion cannot imply execution of the planned total
  const unitsCsv = 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade\nRLQ;20;08/01/2026;Limpeza;Unidade Geradora 02;Mancal de escora;;1;UN';
  const unitsPreview = await request(`${historyBase}/preview`, 'POST', { csv: unitsCsv });
  const unitsImport = await request(`${historyBase}/import`, 'POST', { csv: unitsCsv, token: unitsPreview.data.token });
  assert.equal(unitsImport.status, 201, JSON.stringify(unitsImport.data));
  const unitProgress = () => request(progressPath).then(result => result.data.services[0].systems.find(row => row.systemType === 'SISTEMA'));
  assert.equal((await unitProgress()).realizedQty, 1);
  const nativeBody = { projectId: projectIds[0], createdByUserId: userIds[0], reportType: 'RDO', reportDate: '2026-01-15',
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 0, status: 'PENDING',
    services: [{ serviceType: 'limpeza', system: 'Mancal de escora', finalized: false, startTime: '08:00', endTime: '17:00',
      extraData: { equipmentId: 'Unidade Geradora 02', __projectSystemId: unitSystem.projectSystemId, limpezaTubulacao: 'Não', quantidadeSistemas: 2, tubes: [] } }]
  };
  for (const invalidQuantity of [null, 0, 1.5]) {
    const invalid = structuredClone(nativeBody); invalid.services[0].extraData.quantidadeSistemas = invalidQuantity;
    const response = await request('/rdo/reports', 'POST', invalid);
    assert.equal(response.status, 400, JSON.stringify(response.data));
    assert.match(response.data.error, /inteira positiva/);
  }
  const createdNative = await request('/rdo/reports', 'POST', nativeBody);
  assert.equal(createdNative.status, 201, JSON.stringify(createdNative.data));
  const native = createdNative.data;
  await prisma.report.update({ where: { id: native.id }, data: { status: 'APPROVED' } });
  assert.equal((await unitProgress()).realizedQty, 1); // unfinished services do not advance
  await prisma.reportService.updateMany({ where: { reportId: native.id }, data: { finalized: true } });
  const finalUnits = await unitProgress();
  assert.equal(finalUnits.realizedQty, 3);
  assert.equal(finalUnits.pct, 75);
  const finalProgress = (await request(progressPath)).data;
  assert.deepEqual(finalProgress.services[0].systems.filter(row => row.systemType === 'TUBULACAO').map(row => row.realizedQty), [0, 50, 0]);
  assert.equal((await computeProgressHistoryForProjects([projectIds[0]])).get(projectIds[0]).at(-1).progressPct, finalProgress.progressPct);
  const namedScope = { ...unitScope, services: unitScope.services[0].systems.map((system, index) => ({
    serviceType: 'LIMPEZA_QUIMICA', weight: 25, scopeName: `Escopo ${index + 1}`, systems: [system]
  })) };
  const namedSaved = await request(scopePath, 'PUT', namedScope);
  assert.equal(namedSaved.status, 200, JSON.stringify(namedSaved.data));
  assert.deepEqual(namedSaved.data.services.map(item => item.scopeName), namedScope.services.map(item => item.scopeName));
  assert.deepEqual((await request(scopePath)).data.services.map(item => item.scopeName), namedScope.services.map(item => item.scopeName));
  const groupedProgress = (await request(progressPath)).data;
  assert.equal(groupedProgress.progressPct, finalProgress.progressPct);
  assert.equal(groupedProgress.scopeGroups.length, 4);
  const conflictScope = structuredClone(namedScope);
  conflictScope.services.push({ ...conflictScope.services[0], scopeName: 'Duplicado em outro escopo' });
  const conflict = await request(scopePath, 'PUT', conflictScope);
  assert.equal(conflict.status, 400);
  assert.match(conflict.data.error, /único escopo/);
  assert.deepEqual((await request(scopePath)).data, namedSaved.data); // invalid grouping never overwrites saved scope
  const longName = structuredClone(namedScope); longName.services[0].scopeName = 'a'.repeat(181);
  assert.equal((await request(scopePath, 'PUT', longName)).status, 400);
  assert.ok((await request(suggestionsPath, 'GET', undefined, tokens[1])).data.every(item => item.scopeName === undefined));

  // O mesmo cadastro pode ter metas de vários serviços, mas um alias nunca pode
  // escolher um serviço que não pertença ao destino no escopo salvo.
  const serviceScope = structuredClone(namedScope);
  serviceScope.services.push({ serviceType: 'FILTRAGEM', weight: 1, systems: [
    { equipment: 'Unidade Geradora 01', systemName: 'Regulador de velocidade', systemType: 'OLEO', quantity: 100, unit: 'L' },
    { equipment: 'Unidade Geradora 01', systemName: 'Óleo de lubrificação', systemType: 'OLEO', quantity: 100, unit: 'L' }
  ] });
  assert.equal((await request(scopePath, 'PUT', serviceScope)).status, 200);
  const registry = (await request(systemsPath)).data;
  const shared = registry.find(item => item.id === ids[0]);
  assert.deepEqual(shared.measurements.map(item => item.serviceType).sort(), ['FILTRAGEM', 'LIMPEZA_QUIMICA']);
  const cleaningOnly = registry.find(item => item.id === ids[1]);
  const oilOnly = registry.find(item => item.name === 'Óleo de lubrificação');
  for (const [target, serviceType] of [[cleaningOnly, 'FILTRAGEM'], [oilOnly, 'LIMPEZA_QUIMICA']]) {
    const rejected = await request(`${systemsPath}/${target.id}/alias`, 'PUT', { ...alias, serviceType, revision: target.revision });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    assert.match(rejected.data.error, /tipo de serviço no escopo atual/);
    assert.deepEqual((await request(systemsPath)).data.find(item => item.id === target.id), target);
  }
  const sharedAlias = await request(`${systemsPath}/${shared.id}/alias`, 'PUT', { ...alias, serviceType: 'FILTRAGEM', revision: shared.revision });
  assert.equal(sharedAlias.status, 200, JSON.stringify(sharedAlias.data));
  assert.deepEqual(sharedAlias.data.measurements, shared.measurements); // resposta de save preserva os filtros do cache
  assert.equal(sharedAlias.data.plannedRows, undefined);
  assert.equal((await request(scopePath, 'PUT', { services: [] })).status, 200);
  const obsolete = (await request(systemsPath)).data.find(item => item.id === shared.id);
  assert.deepEqual(obsolete.measurements, []);
  assert.equal((await request(`${systemsPath}/${shared.id}/alias`, 'PUT', { ...alias, serviceType: 'FILTRAGEM', revision: obsolete.revision })).status, 400);
  const removedAlias = await request(`${systemsPath}/${shared.id}/alias`, 'PUT', { ...alias, serviceType: 'FILTRAGEM', revision: obsolete.revision, remove: true });
  assert.equal(removedAlias.status, 200, JSON.stringify(removedAlias.data));
  assert.ok(!removedAlias.data.aliases.some(item => item.serviceType === 'FILTRAGEM'));
});
