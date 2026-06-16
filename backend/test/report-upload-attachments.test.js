import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeUploadReference,
  extractReportUploadAttachments,
  looksLikeUploadReference,
  normalizeStoredReportUploadUrls,
  syncReportUploadAttachments
} from '../src/lib/report-upload-attachments.js';

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

  // Apenas os contêineres conhecidos (generalUploads e __uploads__) viram índice;
  // campos arbitrários (injected/evidence) são ignorados.
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

test('looksLikeUploadReference distingue referências de upload de texto comum', () => {
  assert.equal(looksLikeUploadReference('/relatorios/Missão X/foto.jpg'), true);
  assert.equal(looksLikeUploadReference('/api/rdo/uploads/file/Missão X/foto.jpg'), true);
  assert.equal(looksLikeUploadReference('Missão X/foto.jpg'), true);
  assert.equal(looksLikeUploadReference('https://relatorios.filtrovali.com.br/relatorios/Missão X/foto.jpg'), true);
  // não-referências:
  assert.equal(looksLikeUploadReference('01/06/2026'), false);
  assert.equal(looksLikeUploadReference('Diurno e Noturno'), false);
  assert.equal(looksLikeUploadReference('foto.jpg'), false);
  assert.equal(looksLikeUploadReference('//cdn.exemplo.com/image.jpg'), false);
  assert.equal(looksLikeUploadReference('data:image/png;base64,AAAA'), false);
});

test('canonicalizeUploadReference reduz qualquer formato à mesma forma relativa', () => {
  const canonical = 'Missão P-100 - Projeto Seguro/rdo/foto.jpg';
  const encoded = 'Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg';
  assert.equal(canonicalizeUploadReference(`/relatorios/${encoded}`), canonical);
  assert.equal(canonicalizeUploadReference(`//relatorios/${encoded}`), canonical);
  assert.equal(canonicalizeUploadReference(`/api/rdo/uploads/file/${encoded}`), canonical);
  assert.equal(canonicalizeUploadReference(`https://relatorios.filtrovali.com.br/relatorios/${encoded}`), canonical);
  assert.equal(canonicalizeUploadReference(canonical), canonical); // idempotente
});

test('normalizeStoredReportUploadUrls canonicaliza referências em qualquer profundidade e preserva o resto', () => {
  assert.deepEqual(normalizeStoredReportUploadUrls({
    note: '  manter espacos  ',
    external: '//cdn.example.com/image.jpg',
    generalUploads: [{
      url: '//relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg',
      fileName: 'foto.jpg'
    }],
    serviceData: {
      'Fotos do sistema': [{
        url: 'https://relatorios.filtrovali.com.br/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/sistema.jpg'
      }]
    },
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
      url: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg',
      fileName: 'foto.jpg'
    }],
    serviceData: {
      'Fotos do sistema': [{
        url: 'Missão P-100 - Projeto Seguro/sistema.jpg'
      }]
    },
    groups: [{
      files: [
        'Missão P-100 - Projeto Seguro/servico.jpg',
        'tmp/foto.jpg'
      ]
    }]
  });
});

test('syncReportUploadAttachments reconstrói o índice 1:1 do JSON (cria antes de remover obsoletos)', async () => {
  const calls = [];
  const client = attachmentClient(calls, [
    { id: 'old-report-attachment', reportId: 'report-1', reportServiceId: null, storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-antiga.jpg' },
    { id: 'old-service-attachment', reportId: null, reportServiceId: 'service-1', storagePath: 'Missão P-100 - Projeto Seguro/servico-antigo.jpg' }
  ]);
  const report = {
    id: 'report-1',
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

  const result = await syncReportUploadAttachments(client, report);

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

test('syncReportUploadAttachments indexa toda referência do JSON sem gating de confiança', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.deepEqual(calls.map(([name]) => name), ['findMany', 'createMany']);
  assert.equal(calls[1][1].data[0].storagePath, 'Missão P-100 - Projeto Seguro/rdo/foto.jpg');
});

test('syncReportUploadAttachments propaga falha do createMany sem remover índice', async () => {
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
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    services: []
  };

  await assert.rejects(
    () => syncReportUploadAttachments(client, report),
    /create failed/
  );
  assert.deepEqual(calls.map(([name]) => name), ['findMany', 'createMany']);
});

test('syncReportUploadAttachments indexa fotos de serviço a partir de __uploads__', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const storagePath = 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/servico.jpg';
  const report = {
    id: 'report-1',
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

  const result = await syncReportUploadAttachments(client, report);

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
