import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  driveFileId,
  excelSerialToDateKey,
  extractHyperlink,
  parseThirdPartyServices,
  splitServices
} from '../scripts/extract-legacy-maintenance-history.js';
import { uniqueAssets } from '../scripts/download-legacy-maintenance-assets.js';
import {
  effectiveProfileSnapshots,
  exactEquipmentCode,
  maintenanceAuditId,
  maintenanceRecordId,
  normalizeEquipmentCode,
  recordCreateData,
  resolveEquipment
} from '../scripts/import-legacy-maintenance-history.js';

const datasetUrl = new URL(
  '../scripts/data/legacy-maintenance-history.json',
  import.meta.url
);

test('extração do histórico legado interpreta datas, links e listas', () => {
  assert.equal(excelSerialToDateKey('45719.0'), '2025-03-03');
  assert.equal(
    extractHyperlink(
      'HYPERLINK("https://drive.google.com/file/d/abc_DEF-123456789/view", "Registro")'
    ),
    'https://drive.google.com/file/d/abc_DEF-123456789/view'
  );
  assert.equal(
    driveFileId('https://drive.google.com/file/d/abc_DEF-123456789/view'),
    'abc_DEF-123456789'
  );
  assert.deepEqual(splitServices('Pintura, Teste'), [
    { label: 'Pintura', order: 1 },
    { label: 'Teste', order: 2 }
  ]);
  assert.deepEqual(
    parseThirdPartyServices(
      '2025-09-29 - Usinagem Potter - Usinagem no alojamento.\n'
      + '2025-08-05 - LZ aut - Manutenção elétrica.',
      15
    ),
    [
      {
        serviceDate: '2025-09-29',
        location: 'Usinagem Potter',
        description: 'Usinagem no alojamento.',
        order: 1
      },
      {
        serviceDate: '2025-08-05',
        location: 'LZ aut',
        description: 'Manutenção elétrica.',
        order: 2
      }
    ]
  );
});

test('snapshot do histórico legado preserva todas as linhas e anexos levantados', async () => {
  const dataset = JSON.parse(await fs.readFile(datasetUrl, 'utf8'));
  assert.equal(dataset.version, 1);
  assert.deepEqual(dataset.summary, {
    records: 102,
    equipmentCodes: 56,
    firstMaintenanceDate: '2025-03-03',
    lastMaintenanceDate: '2026-09-02',
    documents: 66,
    uniqueDocuments: 66,
    photoReferences: 182,
    uniquePhotos: 173,
    recordsWithThirdPartyServices: 2,
    recordsWithObservations: 45
  });
  assert.equal(dataset.records[0].sourceRow, 3);
  assert.equal(dataset.records.at(-1).sourceRow, 104);
  assert.equal(new Set(dataset.records.map((record) => record.sourceKey)).size, 102);

  const documents = uniqueAssets(dataset, { documentsOnly: true });
  const allAssets = uniqueAssets(dataset);
  assert.equal(documents.length, 66);
  assert.equal(allAssets.length, 239);
});

test('importador usa IDs estáveis e encontra TAGs apesar da pontuação e zeros', () => {
  const record = {
    sourceKey: 'google-sheets:sheet:gid:39',
    sourceRow: 39
  };
  assert.equal(maintenanceRecordId(record), maintenanceRecordId(record));
  assert.notEqual(maintenanceRecordId(record), maintenanceAuditId(record));
  assert.equal(normalizeEquipmentCode(' UFI-008 '), 'UFI8');
  assert.equal(normalizeEquipmentCode('UFI 8'), 'UFI8');
  assert.equal(exactEquipmentCode(' uth   001 '), 'UTH 001');

  const equipment = { id: 'eq-1', code: 'UFI-8', name: 'Unidade 8' };
  const match = resolveEquipment(
    { equipmentCode: 'UFI 008' },
    new Map([['UFI8', [equipment]]])
  );
  assert.equal(match.status, 'matched');
  assert.equal(match.equipment.id, 'eq-1');

  const ambiguousNormalizedMatch = resolveEquipment(
    { equipmentCode: 'UTH 001' },
    new Map([
      ['UTH1', [
        { id: 'uth-short', code: 'UTH 01', name: 'Unidade 01 curta' },
        { id: 'uth-exact', code: 'UTH 001', name: 'Unidade 001 exata' }
      ]]
    ])
  );
  assert.equal(ambiguousNormalizedMatch.status, 'matched');
  assert.equal(ambiguousNormalizedMatch.equipment.id, 'uth-exact');
  assert.equal(ambiguousNormalizedMatch.strategy, 'exact-code');
});

test('serviços importados mantêm o texto legado e ligam itens atuais equivalentes', () => {
  const currentItem = {
    id: 'item-1',
    label: 'Pintura',
    order: 7,
    isActive: true
  };
  const equipment = {
    maintenanceProfileOverride: true,
    maintenanceProfile: {
      id: 'profile-1',
      name: 'Perfil UFI',
      isActive: true,
      items: [currentItem]
    },
    category: { maintenanceProfile: null }
  };
  const snapshots = effectiveProfileSnapshots(
    {
      selectedServices: [
        { label: 'Pintura', order: 1 },
        { label: 'Teste legado', order: 2 }
      ]
    },
    equipment
  );
  assert.equal(snapshots.profileId, 'profile-1');
  assert.deepEqual(snapshots.selectedServices, [
    { itemId: 'item-1', label: 'Pintura', order: 1 },
    { label: 'Teste legado', order: 2 }
  ]);
});

test('registro legado é criado aprovado, avulso e com trilha da linha de origem', () => {
  const source = {
    sourceKey: 'google-sheets:sheet:gid:15',
    sourceRow: 15,
    maintenanceDate: '2025-10-10',
    responsibleName: 'Cléo Éder',
    selectedServices: [{ label: 'Teste', order: 1 }],
    observations: 'Revisão concluída.',
    thirdPartyServices: [
      {
        serviceDate: '2025-09-29',
        location: 'Usinagem Potter',
        description: 'Usinagem no alojamento.',
        order: 1
      }
    ]
  };
  const data = recordCreateData(
    {
      id: maintenanceRecordId(source),
      source,
      match: {
        equipment: {
          id: 'eq-1',
          maintenanceProfileOverride: false,
          maintenanceProfile: null,
          category: { maintenanceProfile: null }
        }
      }
    },
    { supervisorName: 'Não informado (controle legado)' },
    null
  );

  assert.equal(data.reportId, null);
  assert.equal(data.status, 'APPROVED');
  assert.equal(data.equipmentId, 'eq-1');
  assert.equal(data.responsibleNameSnapshot, 'Cléo Éder');
  assert.equal(data.supervisorNameSnapshot, 'Não informado (controle legado)');
  assert.match(data.reviewNotes, /google-sheets:sheet:gid:15/);
  assert.equal(data.thirdPartyServices.create[0].location, 'Usinagem Potter');
  assert.equal(data.reviewAudits.create.nextStatus, 'APPROVED');
});
