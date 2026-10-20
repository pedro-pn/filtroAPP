import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import reportsRouter, { canAccessReportPdf } from '../src/routes/resources/reports.js';
import { projectListWhereForAuth } from '../src/routes/resources/projects.js';

function invoke(method, path, req) {
  const handler = reportsRouter.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); }
    };
    handler(req, res, error => error ? resolve({ statusCode: error.statusCode || 500, error }) : reject(new Error('Resposta ausente')));
  });
}

test('operador, usuário autorizado e equipe da missão só consultam relatórios de projetos arquivados', async t => {
  const originals = {
    transaction: prisma.$transaction, findReport: prisma.report.findUniqueOrThrow,
    findReports: prisma.report.findMany, findUser: prisma.user.findUnique,
    createReport: prisma.report.create, updateReport: prisma.report.update
  };
  t.after(() => {
    prisma.$transaction = originals.transaction;
    prisma.report.findUniqueOrThrow = originals.findReport;
    prisma.report.findMany = originals.findReports;
    prisma.user.findUnique = originals.findUser;
    prisma.report.create = originals.createReport;
    prisma.report.update = originals.updateReport;
  });
  let writes = 0;
  prisma.report.create = prisma.report.update = async () => { writes += 1; throw new Error('Gravação indevida'); };
  for (const link of ['operator', 'authorized', 'mission']) {
    const auth = { user: {
      id: 'user-1', collaboratorId: 'collaborator-1', role: 'COLLABORATOR', accountType: 'INTERNAL',
      isActive: true, moduleRoles: ['rdo:collaborator'], reportEmissionPermissions: ['SITE_RDO']
    } };
    const project = {
      id: 'archived', code: 'P-001', name: 'Projeto arquivado', location: 'Santos',
      isActive: false, deletedAt: null, managerOnly: false, registrationPending: false,
      visibleToCollaborators: link === 'operator', operatorId: link === 'operator' ? auth.user.collaboratorId : 'other-operator',
      authorizedUsers: link === 'operator' ? [] : [{ userId: auth.user.id }],
      efetivoMissionPlans: link === 'mission' ? [{ allocations: [{ collaboratorId: auth.user.collaboratorId }] }] : []
    };
    const report = {
      id: 'existing', projectId: project.id, project, reportType: 'RDO', status: 'PENDING',
      createdByUserId: auth.user.id, collaborators: [{ collaboratorId: auth.user.collaboratorId }],
      specialConditions: {}, services: [], attachments: [], reportSignatures: []
    };
    const body = {
      projectId: project.id, createdByUserId: auth.user.id, reportType: 'RDO', reportDate: '2026-10-20',
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
      collaboratorIds: [auth.user.collaboratorId], services: []
    };
    prisma.$transaction = callback => callback({
      project: { findFirstOrThrow: async () => project }, report: prisma.report
    });
    prisma.report.findUniqueOrThrow = async () => report;
    prisma.user.findUnique = async () => ({ collaboratorId: auth.user.collaboratorId });
    let listWhere;
    prisma.report.findMany = async ({ where }) => { listWhere = where; return [report]; };

    const created = await invoke('post', '/', { auth, body });
    assert.equal(created.statusCode, 403, `${link}: POST não pode criar`);
    const updated = await invoke('put', '/:id', { auth, body, params: { id: report.id } });
    assert.equal(updated.statusCode, 403, `${link}: PUT não pode editar nem como autor do RDO`);
    const detail = await invoke('get', '/:id', { auth, params: { id: report.id } });
    assert.equal(detail.statusCode, 200, `${link}: GET continua disponível`);
    assert.equal(detail.body.id, report.id);
    assert.equal(await canAccessReportPdf(auth, report), true, `${link}: PDF continua disponível`);
    const archived = await invoke('get', '/', { auth, query: { mine: 'true', projectActive: 'false' } });
    assert.equal(archived.statusCode, 200);
    assert.equal(archived.body[0].id, report.id);
    assert.equal(listWhere.project.isActive, false);
    assert.equal((await projectListWhereForAuth(auth, 'true')).isActive, true, 'novo relatório só oferece projetos ativos');
  }
  assert.equal(writes, 0, 'nenhum relatório criado ou atualizado');
});
