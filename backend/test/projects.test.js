import assert from 'node:assert/strict';
import test from 'node:test';

import { removeProjectById } from '../src/routes/resources/projects.js';

test('removeProjectById preserves projects with reports before hiding the project', async () => {
  const calls = [];
  const tx = {
    report: {
      findMany: async args => {
        calls.push(['report.findMany', args]);
        return [{ id: 'report-1' }, { id: 'report-2' }];
      },
      update: async args => {
        calls.push(['report.update', args]);
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
      update: async args => {
        calls.push(['project.update', args]);
      },
      delete: async args => {
        calls.push(['project.delete', args]);
      }
    }
  };
  const prismaClient = {
    $transaction: async callback => callback(tx)
  };

  await removeProjectById('project-1', prismaClient);

  assert.equal(calls[0][0], 'report.findMany');
  assert.deepEqual(calls[0][1], { where: { projectId: 'project-1' }, select: { id: true } });
  assert.equal(calls[1][0], 'project.update');
  assert.equal(calls[1][1].where.id, 'project-1');
  assert.equal(calls[1][1].data.isActive, false);
  assert.ok(calls[1][1].data.deletedAt instanceof Date);
  assert.equal(calls[2][0], 'report.findMany');
  assert.deepEqual(calls.slice(3), [
    ['report.update', {
      where: { id: 'report-1' },
      data: {
        zapsignDocToken: null,
        zapsignSignerToken: null,
        zapsignRequestedAt: null,
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: {}
      }
    }],
    ['report.update', {
      where: { id: 'report-2' },
      data: {
        zapsignDocToken: null,
        zapsignSignerToken: null,
        zapsignRequestedAt: null,
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: {}
      }
    }]
  ]);
});

test('removeProjectById clears dependent records before deleting projects without reports', async () => {
  const calls = [];
  const tx = {
    report: {
      findMany: async args => {
        calls.push(['report.findMany', args]);
        return [];
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

  assert.deepEqual(calls, [
    ['report.findMany', { where: { projectId: 'project-1' }, select: { id: true } }],
    ['reportDraft.updateMany', { where: { projectId: 'project-1' }, data: { projectId: null } }],
    ['satisfactionSurvey.deleteMany', { where: { projectId: 'project-1' } }],
    ['projectReportSeq.deleteMany', { where: { projectId: 'project-1' } }],
    ['project.delete', { where: { id: 'project-1' } }]
  ]);
});
