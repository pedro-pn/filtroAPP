import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractReportUploadAttachments,
  syncReportUploadAttachments
} from '../src/lib/report-upload-attachments.js';

test('extractReportUploadAttachments only accepts known upload containers', () => {
  const report = {
    id: 'report-1',
    specialConditions: {
      generalUploads: [{
        label: 'Registro',
        fileName: 'foto.jpg',
        mimeType: 'image/jpeg',
        url: '/relatorios/projeto/rdo/foto.jpg'
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
            url: '/relatorios/projeto/servico.png'
          }]
        }]
      }
    }]
  };

  assert.deepEqual(extractReportUploadAttachments(report), [{
    label: 'Registro',
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
    storagePath: 'projeto/rdo/foto.jpg',
    reportId: 'report-1',
    reportServiceId: null
  }, {
    label: 'Fotos do serviço',
    fileName: 'servico.png',
    mimeType: 'image/png',
    storagePath: 'projeto/servico.png',
    reportId: null,
    reportServiceId: 'service-1'
  }]);
});

test('syncReportUploadAttachments replaces managed report and service attachments', async () => {
  const calls = [];
  const client = {
    reportAttachment: {
      deleteMany: async args => {
        calls.push(['deleteMany', args]);
        return { count: 2 };
      },
      createMany: async args => {
        calls.push(['createMany', args]);
        return { count: args.data.length };
      }
    }
  };
  const report = {
    id: 'report-1',
    specialConditions: {
      generalUploads: ['/relatorios/projeto/rdo/foto.jpg']
    },
    services: [{
      id: 'service-1',
      extraData: {
        __uploads__: [{
          label: 'Fotos do serviço',
          files: ['/relatorios/projeto/servico.jpg']
        }]
      }
    }]
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 2, created: 2 });
  assert.deepEqual(calls[0], ['deleteMany', {
    where: {
      OR: [
        { reportId: 'report-1' },
        { reportServiceId: { in: ['service-1'] } }
      ]
    }
  }]);
  assert.deepEqual(calls[1][1].data.map(item => ({
    reportId: item.reportId,
    reportServiceId: item.reportServiceId,
    storagePath: item.storagePath
  })), [{
    reportId: 'report-1',
    reportServiceId: null,
    storagePath: 'projeto/rdo/foto.jpg'
  }, {
    reportId: null,
    reportServiceId: 'service-1',
    storagePath: 'projeto/servico.jpg'
  }]);
});
