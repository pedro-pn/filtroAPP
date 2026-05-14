import assert from 'node:assert/strict';
import test from 'node:test';

import { removeProjectById } from '../src/routes/resources/projects.js';

test('removeProjectById clears dependent records before deleting the project', async () => {
  const calls = [];
  const tx = {
    report: {
      findMany: async args => {
        calls.push(['report.findMany', args]);
        return [{ id: 'report-1' }, { id: 'report-2' }];
      },
      deleteMany: async args => {
        calls.push(['report.deleteMany', args]);
      }
    },
    reportDraft: {
      updateMany: async args => {
        calls.push(['reportDraft.updateMany', args]);
      }
    },
    satisfactionSurvey: {
      deleteMany: async args => {
        calls.push(['satisfactionSurvey.deleteMany', args]);
      }
    },
    projectReportSeq: {
      deleteMany: async args => {
        calls.push(['projectReportSeq.deleteMany', args]);
      }
    },
    reportAttachment: {
      deleteMany: async args => {
        calls.push(['reportAttachment.deleteMany', args]);
      }
    },
    clientReportReview: {
      deleteMany: async args => {
        calls.push(['clientReportReview.deleteMany', args]);
      }
    },
    reportCollaborator: {
      deleteMany: async args => {
        calls.push(['reportCollaborator.deleteMany', args]);
      }
    },
    reportService: {
      deleteMany: async args => {
        calls.push(['reportService.deleteMany', args]);
      }
    },
    project: {
      delete: async args => {
        calls.push(['project.delete', args]);
      }
    }
  };
  const prismaClient = {
    $transaction: async callback => callback(tx)
  };

  await removeProjectById('project-1', prismaClient);

  const reportIdFilter = { reportId: { in: ['report-1', 'report-2'] } };
  assert.deepEqual(calls, [
    ['report.findMany', { where: { projectId: 'project-1' }, select: { id: true } }],
    ['reportDraft.updateMany', { where: { projectId: 'project-1' }, data: { projectId: null } }],
    ['satisfactionSurvey.deleteMany', { where: { projectId: 'project-1' } }],
    ['projectReportSeq.deleteMany', { where: { projectId: 'project-1' } }],
    ['reportAttachment.deleteMany', { where: reportIdFilter }],
    ['clientReportReview.deleteMany', { where: reportIdFilter }],
    ['reportCollaborator.deleteMany', { where: reportIdFilter }],
    ['reportService.deleteMany', { where: reportIdFilter }],
    ['report.deleteMany', { where: { id: { in: ['report-1', 'report-2'] } } }],
    ['project.delete', { where: { id: 'project-1' } }]
  ]);
});
