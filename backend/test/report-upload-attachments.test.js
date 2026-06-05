import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractReportUploadAttachments,
  normalizeStoredReportUploadUrls,
  reportUploadAttachmentsNeedSync,
  syncReportUploadAttachments
} from '../src/lib/report-upload-attachments.js';
import { rememberTransientUploadAccess } from '../src/lib/transient-upload-access.js';

function attachmentClient(calls, existing = []) {
  return {
    reportAttachment: {
      findMany: async args => {
        calls.push(['findMany', args]);
        return existing;
      },
      deleteMany: async args => {
        calls.push(['deleteMany', args]);
        if (Array.isArray(args?.where?.id?.in)) return { count: args.where.id.in.length };
        return { count: existing.length };
      },
      createMany: async args => {
        calls.push(['createMany', args]);
        return { count: args.data.length };
      }
    }
  };
}

test('extractReportUploadAttachments only accepts known upload containers', () => {
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [{
        label: 'Registro',
        fileName: 'foto.jpg',
        mimeType: 'image/jpeg',
        url: '/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg'
      }, {
        label: 'Registro',
        fileName: 'foto-protocol-relative.jpg',
        mimeType: 'image/jpeg',
        url: '//relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto-protocol-relative.jpg'
      }],
      injected: {
        url: '/relatorios/outro-projeto/privado.jpg'
      }
    },
    services: [{
      id: 'service-1',
      extraData: {
        evidence: { storagePath: '/relatorios/outro-projeto/service-injetado.jpg' },
        __uploads__: [{
          label: 'Fotos do serviço',
          files: [{
            fileName: 'servico.png',
            mimeType: 'image/png',
            url: '/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/servico.png'
          }]
        }]
      }
    }]
  };

  assert.deepEqual(extractReportUploadAttachments(report), [{
    label: 'Registro',
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
    storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg',
    reportId: 'report-1',
    reportServiceId: null
  }, {
    label: 'Registro',
    fileName: 'foto-protocol-relative.jpg',
    mimeType: 'image/jpeg',
    storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-protocol-relative.jpg',
    reportId: 'report-1',
    reportServiceId: null
  }, {
    label: 'Fotos do serviço',
    fileName: 'servico.png',
    mimeType: 'image/png',
    storagePath: 'Missão P-100 - Projeto Seguro/servico.png',
    reportId: null,
    reportServiceId: 'service-1'
  }]);
});

test('normalizeStoredReportUploadUrls persists local upload urls with a single leading slash', () => {
  assert.deepEqual(normalizeStoredReportUploadUrls({
    note: '  manter espacos  ',
    external: '//cdn.example.com/image.jpg',
    generalUploads: [{
      url: '//relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg',
      fileName: 'foto.jpg'
    }],
    groups: [{
      files: [
        '//api/rdo/uploads/file/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/servico.jpg',
        '//uploads/tmp/foto.jpg'
      ]
    }]
  }), {
    note: '  manter espacos  ',
    external: '//cdn.example.com/image.jpg',
    generalUploads: [{
      url: '/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg',
      fileName: 'foto.jpg'
    }],
    groups: [{
      files: [
        '/api/rdo/uploads/file/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/servico.jpg',
        '/uploads/tmp/foto.jpg'
      ]
    }]
  });
});

test('syncReportUploadAttachments creates expected attachments before removing stale rows', async () => {
  const calls = [];
  const client = attachmentClient(calls, [
    { id: 'old-report-attachment', reportId: 'report-1', reportServiceId: null, storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-antiga.jpg' },
    { id: 'old-service-attachment', reportId: null, reportServiceId: 'service-1', storagePath: 'Missão P-100 - Projeto Seguro/servico-antigo.jpg' }
  ]);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    services: [{
      id: 'service-1',
      extraData: {
        __uploads__: [{
          label: 'Fotos do serviço',
          files: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/servico.jpg']
        }]
      }
    }]
  };

  const result = await syncReportUploadAttachments(client, report, {
    trustedStoragePaths: [
      'Missão P-100 - Projeto Seguro/rdo/foto.jpg',
      'Missão P-100 - Projeto Seguro/servico.jpg'
    ]
  });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 2, created: 2 });
  assert.equal(calls[0][0], 'findMany');
  assert.equal(calls[1][0], 'createMany');
  assert.deepEqual(calls[1][1].data.map(item => ({
    reportId: item.reportId,
    reportServiceId: item.reportServiceId,
    storagePath: item.storagePath
  })), [{
    reportId: 'report-1',
    reportServiceId: null,
    storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg'
  }, {
    reportId: null,
    reportServiceId: 'service-1',
    storagePath: 'Missão P-100 - Projeto Seguro/servico.jpg'
  }]);
  assert.deepEqual(calls[2], ['deleteMany', {
    where: {
      id: {
        in: ['old-report-attachment', 'old-service-attachment']
      }
    }
  }]);
});

test('syncReportUploadAttachments keeps existing index if createMany fails', async () => {
  const calls = [];
  const client = {
    reportAttachment: {
      findMany: async args => {
        calls.push(['findMany', args]);
        return [{ id: 'old-valid-index', reportId: 'report-1', reportServiceId: null, storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-antiga.jpg' }];
      },
      createMany: async args => {
        calls.push(['createMany', args]);
        throw new Error('create failed');
      },
      deleteMany: async args => {
        calls.push(['deleteMany', args]);
        return { count: 1 };
      }
    }
  };
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    services: []
  };

  await assert.rejects(
    () => syncReportUploadAttachments(client, report, { trustedStoragePaths: ['Missão P-100 - Projeto Seguro/rdo/foto.jpg'] }),
    /create failed/
  );
  assert.deepEqual(calls.map(([name]) => name), ['findMany', 'createMany']);
});

test('syncReportUploadAttachments ignores known upload containers outside the report project folder', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-200%20-%20Outro%20Projeto/rdo/foto.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 0 });
  assert.deepEqual(calls.map(([name]) => name), ['findMany']);
});

test('syncReportUploadAttachments rejects untrusted JSON paths even inside the same project folder', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto-injetada.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 0 });
  assert.deepEqual(calls.map(([name]) => name), ['findMany']);
});

test('syncReportUploadAttachments accepts old project folder names only in explicit legacy backfill mode', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Nome Atual'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Nome%20Antigo/rdo/foto.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, { trustLegacyProjectScoped: true });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[1][1].data[0].storagePath, 'Missão P-100 - Nome Antigo/rdo/foto.jpg');
});

test('syncReportUploadAttachments accepts recently uploaded paths for the same authenticated user', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const storagePath = 'Missão P-100 - Projeto Seguro/rdo/foto-nova.jpg';
  const auth = { user: { id: 'user-upload' } };
  rememberTransientUploadAccess(storagePath, auth.user.id);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [`/relatorios/${encodeURIComponent('Missão P-100 - Projeto Seguro')}/rdo/foto-nova.jpg`]
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, { auth });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[1][1].data[0].storagePath, storagePath);
});

test('syncReportUploadAttachments trusts organized target when source path was trusted', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const sourcePath = 'Missão P-100 - Projeto Seguro/tmp/foto.jpg';
  const targetPath = 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RDO/foto.jpg';
  const auth = { user: { id: 'user-organize' } };
  rememberTransientUploadAccess(sourcePath, auth.user.id);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [`/relatorios/${targetPath.split('/').map(encodeURIComponent).join('/')}`]
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, {
    auth,
    trustedUrlMap: new Map([
      [`/relatorios/${sourcePath.split('/').map(encodeURIComponent).join('/')}`, `/relatorios/${targetPath.split('/').map(encodeURIComponent).join('/')}`]
    ])
  });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[1][1].data[0].storagePath, targetPath);
});

test('syncReportUploadAttachments restores snapshot-trusted paths over edited attachments', async () => {
  const calls = [];
  const client = attachmentClient(calls, [
    { id: 'edited-attachment', reportId: 'report-1', reportServiceId: null, storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-editada.jpg' }
  ]);
  const restoredPath = 'Missão P-100 - Projeto Seguro/rdo/foto-original.jpg';
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [`/relatorios/${restoredPath.split('/').map(encodeURIComponent).join('/')}`]
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, {
    trustedStoragePaths: [restoredPath]
  });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 1, created: 1 });
  assert.equal(calls[1][1].data[0].storagePath, restoredPath);
  assert.deepEqual(calls[2], ['deleteMany', { where: { id: { in: ['edited-attachment'] } } }]);
});

test('syncReportUploadAttachments recreates trusted service attachment after services are replaced', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const storagePath = 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/servico.jpg';
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {},
    services: [{
      id: 'new-service-1',
      extraData: {
        __uploads__: [{
          label: 'Foto do laudo',
          files: [{
            fileName: 'servico-original.jpg',
            mimeType: 'image/jpeg',
            storagePath
          }]
        }]
      }
    }]
  };

  const result = await syncReportUploadAttachments(client, report, {
    trustedStoragePaths: [storagePath]
  });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[1][0], 'createMany');
  assert.deepEqual(calls[1][1].data.map(item => ({
    reportId: item.reportId,
    reportServiceId: item.reportServiceId,
    label: item.label,
    fileName: item.fileName,
    mimeType: item.mimeType,
    storagePath: item.storagePath
  })), [{
    reportId: null,
    reportServiceId: 'new-service-1',
    label: 'Foto do laudo',
    fileName: 'servico-original.jpg',
    mimeType: 'image/jpeg',
    storagePath
  }]);
});

test('syncReportUploadAttachments trusts inherited service uploads already attached in the same project', async () => {
  const calls = [];
  const storagePath = 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/servico-herdado.jpg';
  const client = {
    reportAttachment: {
      findMany: async args => {
        calls.push(['findMany', args]);
        if (args.where?.storagePath?.in) {
          return [{ storagePath }];
        }
        return [];
      },
      deleteMany: async args => {
        calls.push(['deleteMany', args]);
        return { count: 0 };
      },
      createMany: async args => {
        calls.push(['createMany', args]);
        return { count: args.data.length };
      }
    }
  };
  const report = {
    id: 'report-30',
    projectId: 'project-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {},
    services: [{
      id: 'continued-service',
      extraData: {
        __uploads__: [{
          label: 'Foto do laudo',
          files: [{
            fileName: 'servico-herdado.jpg',
            mimeType: 'image/jpeg',
            storagePath
          }]
        }]
      }
    }]
  };

  const result = await syncReportUploadAttachments(client, report, {
    trustProjectExistingAttachments: true
  });

  assert.deepEqual(result, { reportId: 'report-30', deleted: 0, created: 1 });
  assert.equal(calls[0][0], 'findMany');
  assert.equal(calls[1][0], 'findMany');
  assert.deepEqual(calls[1][1].where.storagePath.in, [storagePath]);
  assert.deepEqual(calls[1][1].where.OR, [
    { report: { projectId: 'project-1', deletedAt: null } },
    { reportService: { report: { projectId: 'project-1', deletedAt: null } } }
  ]);
  assert.equal(calls[2][0], 'createMany');
  assert.deepEqual(calls[2][1].data.map(item => ({
    reportId: item.reportId,
    reportServiceId: item.reportServiceId,
    fileName: item.fileName,
    storagePath: item.storagePath
  })), [{
    reportId: null,
    reportServiceId: 'continued-service',
    fileName: 'servico-herdado.jpg',
    storagePath
  }]);
});

test('reportUploadAttachmentsNeedSync detects legacy JSON uploads missing persisted attachments', () => {
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    attachments: [],
    services: []
  };

  assert.equal(reportUploadAttachmentsNeedSync(report), true);
  assert.equal(reportUploadAttachmentsNeedSync({
    ...report,
    attachments: [{ storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg' }]
  }), false);
});
