import assert from 'node:assert/strict';
import test from 'node:test';

import {
  withCurrentAttachments,
  equipmentAttachmentFileName,
  EquipmentAttachmentKinds
} from '../src/lib/equipment-attachments.js';

const {
  CALIBRATION_CERTIFICATE,
  TECHNICAL_DOC,
  TECHNICAL_DOC_GENERATED,
  TECHNICAL_PHOTO
} = EquipmentAttachmentKinds;

function att(id, kind, createdAt, fileName = `${id}.pdf`) {
  return { id, kind, fileName, mimeType: 'application/pdf', publicToken: `tok-${id}`, createdAt };
}

test('withCurrentAttachments separa o anexo atual dos arquivados (certificados e datasheets)', () => {
  const item = withCurrentAttachments({
    id: 'eq1',
    technicalUpdatedAt: null,
    attachments: [
      att('cert-new', CALIBRATION_CERTIFICATE, '2026-03-01T00:00:00Z'),
      att('cert-old', CALIBRATION_CERTIFICATE, '2026-01-01T00:00:00Z'),
      att('ds-rev2', TECHNICAL_DOC_GENERATED, '2026-03-10T00:00:00Z', 'Datasheet - X - Y - Rev 2.pdf'),
      att('ds-rev1', TECHNICAL_DOC_GENERATED, '2026-02-10T00:00:00Z', 'Datasheet - X - Y - Rev 1.pdf'),
      att('legacy', TECHNICAL_DOC, '2026-01-05T00:00:00Z'),
      att('photo1', TECHNICAL_PHOTO, '2026-01-02T00:00:00Z')
    ]
  });

  // Certificado atual = mais recente; o restante vai para o arquivo.
  assert.equal(item.calibrationCertificate.id, 'cert-new');
  assert.deepEqual(item.calibrationCertificateArchive.map(a => a.id), ['cert-old']);

  // Datasheet "atual" = gerado mais recente; demais gerados + PDF legado = arquivados.
  assert.equal(item.technicalDocGenerated.id, 'ds-rev2');
  assert.deepEqual(item.technicalDocArchive.map(a => a.id), ['ds-rev1', 'legacy']);
  assert.equal(item.technicalDoc.id, 'legacy');

  // Fotos preservadas (ordem de criação ascendente).
  assert.deepEqual(item.technicalPhotos.map(a => a.id), ['photo1']);
});

test('withCurrentAttachments marca o datasheet como desatualizado quando os dados mudaram depois', () => {
  const attachments = [att('ds', TECHNICAL_DOC_GENERATED, '2026-02-10T00:00:00Z', 'Datasheet - Rev 1.pdf')];
  const outdated = withCurrentAttachments({ id: 'eq', technicalUpdatedAt: '2026-02-11T00:00:00Z', attachments });
  const upToDate = withCurrentAttachments({ id: 'eq', technicalUpdatedAt: '2026-02-09T00:00:00Z', attachments });
  assert.equal(outdated.technicalDocGeneratedOutdated, true);
  assert.equal(upToDate.technicalDocGeneratedOutdated, false);
});

test('equipmentAttachmentFileName preserva o nome com a revisão dos datasheets arquivados', () => {
  assert.equal(
    equipmentAttachmentFileName({
      kind: TECHNICAL_DOC_GENERATED,
      fileName: 'Datasheet - CMR 001 - Compressor - Rev 3.pdf',
      equipment: { code: 'CMR 001', name: 'Compressor' }
    }),
    'Datasheet - CMR 001 - Compressor - Rev 3.pdf'
  );
});

test('equipmentAttachmentFileName recompõe o nome quando o datasheet não tem revisão', () => {
  assert.equal(
    equipmentAttachmentFileName({
      kind: TECHNICAL_DOC_GENERATED,
      fileName: 'datasheet-antigo.pdf',
      equipment: { code: 'CMR 001', name: 'Compressor' }
    }),
    'Datasheet - CMR 001 - Compressor.pdf'
  );
});

test('equipmentAttachmentFileName usa o padrão de certificado de calibração (com serial)', () => {
  assert.equal(
    equipmentAttachmentFileName({
      kind: CALIBRATION_CERTIFICATE,
      fileName: 'qualquer.pdf',
      equipment: { code: 'MAN 7', name: 'Manômetro', attributes: { serialNumber: 'SN-9' } }
    }),
    'Certificado de calibração - MAN 7 - SN-9 - Manômetro.pdf'
  );
});
