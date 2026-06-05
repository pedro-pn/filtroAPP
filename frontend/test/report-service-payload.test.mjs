import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadReportServicePayload() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/reportServicePayload.ts');
  } finally {
    await server.close();
  }
}

test('buildReportServicePayload persists uploads copied from previous service continuations', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();

  const payload = buildReportServicePayload({
    type: 'filtragem',
    data: {
      equipmentId: 'EQ-1',
      system: 'Unidade hidráulica',
      tipoOleo: 'ISO VG 46',
      volumeOleo: '100',
      volumeOleoUnit: 'L',
      __uploads__: [{
        label: 'Foto do laudo',
        files: [{
          fileName: 'foto-antiga.jpg',
          mimeType: 'image/jpeg',
          storagePath: 'Missão 1 - Projeto/Registros Fotográficos/RCPU/foto-antiga.jpg',
          __previouslyAdded: true
        }, {
          fileName: 'foto-nova.jpg',
          mimeType: 'image/jpeg',
          storagePath: 'Missão 1 - Projeto/Registros Fotográficos/RCPU/foto-nova.jpg'
        }]
      }]
    }
  });

  assert.deepEqual(payload.extraData.__uploads__, [{
    label: 'Foto do laudo',
    files: [{
      fileName: 'foto-antiga.jpg',
      mimeType: 'image/jpeg',
      storagePath: 'Missão 1 - Projeto/Registros Fotográficos/RCPU/foto-antiga.jpg'
    }, {
      fileName: 'foto-nova.jpg',
      mimeType: 'image/jpeg',
      storagePath: 'Missão 1 - Projeto/Registros Fotográficos/RCPU/foto-nova.jpg'
    }]
  }]);
});

test('buildReportServicePayload removes only UI markers from inherited upload files', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();

  const payload = buildReportServicePayload({
    type: 'filtragem',
    data: {
      equipmentId: 'EQ-1',
      system: 'Unidade hidráulica',
      __uploads__: [{
        label: 'Foto do laudo',
        files: [{
          fileName: 'foto-antiga.jpg',
          mimeType: 'image/jpeg',
          storagePath: 'Missão 1 - Projeto/Registros Fotográficos/RCPU/foto-antiga.jpg',
          previouslyAdded: true
        }]
      }]
    }
  });

  assert.deepEqual(payload.extraData.__uploads__, [{
    label: 'Foto do laudo',
    files: [{
      fileName: 'foto-antiga.jpg',
      mimeType: 'image/jpeg',
      storagePath: 'Missão 1 - Projeto/Registros Fotográficos/RCPU/foto-antiga.jpg'
    }]
  }]);
});
