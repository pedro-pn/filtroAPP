import assert from 'node:assert/strict';
import test from 'node:test';

import { pdfUploadUrlsForReport } from '../src/routes/resources/reports.js';

test('pdf upload fingerprint includes persisted and derived service photos', () => {
  const report = {
    id: 'report-1',
    specialConditions: {
      generalUploads: [{
        url: '/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto-geral.jpg',
        fileName: 'foto-geral.jpg',
        mimeType: 'image/jpeg'
      }],
      serviceData: {
        'Foto do laudo do contador': [{
          storagePath: 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/laudo.jpg',
          fileName: 'laudo.jpg',
          mimeType: 'image/jpeg'
        }]
      }
    },
    attachments: [{
      storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-geral.jpg',
      fileName: 'foto-geral.jpg',
      mimeType: 'image/jpeg'
    }],
    services: [{
      extraData: {
        __uploads__: [{
          label: 'Foto do laudo',
          files: [{
            storagePath: 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/laudo.jpg',
            fileName: 'laudo.jpg',
            mimeType: 'image/jpeg'
          }]
        }]
      },
      attachments: [{
        storagePath: 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/anexo-servico.jpg',
        fileName: 'anexo-servico.jpg',
        mimeType: 'image/jpeg'
      }]
    }]
  };

  assert.deepEqual(pdfUploadUrlsForReport(report).sort(), [
    'Missão P-100 - Projeto Seguro/rdo/foto-geral.jpg',
    'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/anexo-servico.jpg',
    'Missão P-100 - Projeto Seguro/Registros Fotográficos/RCPU/laudo.jpg'
  ].sort());
});

test('pdf upload fingerprint changes when a service photo is removed', () => {
  const servicePhoto = {
    storagePath: 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RTP/manometro.jpg',
    fileName: 'manometro.jpg',
    mimeType: 'image/jpeg'
  };
  const withPhoto = {
    id: 'rtp-1',
    specialConditions: {
      serviceData: {
        'Fotos do manômetro': [servicePhoto]
      }
    },
    services: [{
      extraData: {
        __uploads__: [{ label: 'Fotos do manômetro', files: [servicePhoto] }]
      },
      attachments: [servicePhoto]
    }]
  };
  const withoutPhoto = {
    ...withPhoto,
    specialConditions: { serviceData: { 'Fotos do manômetro': [] } },
    services: [{ extraData: { __uploads__: [] }, attachments: [] }]
  };

  assert.equal(pdfUploadUrlsForReport(withPhoto).includes(servicePhoto.storagePath), true);
  assert.equal(pdfUploadUrlsForReport(withoutPhoto).includes(servicePhoto.storagePath), false);
});
