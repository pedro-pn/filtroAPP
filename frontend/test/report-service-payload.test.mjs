import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { materialSelection, selectedChemicalProducts } from '../../shared/modules/rdo-material.js';

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

test('Outro, material digitado e produtos marcados sobrevivem a salvar e reabrir', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();
  for (const type of ['limpeza', 'pressao', 'mecanica', 'inibicao']) {
    const first = buildReportServicePayload({
      type,
      data: { materialSelection: 'Outro', material: 'PVC', materialOther: 'PVC', chemicalProducts: ['Ácido fosfórico', 'Carbonato de sódio'] }
    });
    const reopened = buildReportServicePayload({ type, data: first.extraData });
    assert.equal(reopened.material, 'PVC');
    assert.equal(materialSelection(reopened.extraData), 'Outro');
    assert.equal(reopened.extraData.materialOther, 'PVC');
    if (type === 'limpeza') {
      assert.deepEqual(selectedChemicalProducts(reopened.extraData), ['Ácido fosfórico', 'Carbonato de sódio']);
      assert.deepEqual(reopened.extraData['Produtos químicos utilizados'], ['Ácido fosfórico', 'Carbonato de sódio']);
    }
  }
});

test('rascunho preserva Outro sem material digitado e material padrão descarta produtos manuais', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();
  const draft = buildReportServicePayload({ type: 'limpeza', data: { materialSelection: 'Outro', material: '' } });
  assert.equal(materialSelection(draft.extraData), 'Outro');
  assert.equal(draft.material, null);
  const standard = buildReportServicePayload({
    type: 'limpeza',
    data: { material: 'Inox', chemicalProducts: ['Ácido cítrico'], 'Produtos químicos utilizados': ['Ácido cítrico'] }
  });
  assert.deepEqual(standard.extraData.chemicalProducts, []);
  assert.equal(standard.extraData['Produtos químicos utilizados'], undefined);
});

test('aço carbono preserva múltiplos ácidos e salva etapas na ordem do formulário', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();
  const payload = buildReportServicePayload({ type: 'limpeza', data: {
    material: 'Aço carbono', chemicalProducts: ['Ácido cítrico', 'Ácido clorídrico (muriático)', 'Ácido nítrico'],
    etapas: ['Secagem', 'Fase ácida', 'Desengraxe', 'Fase sequestrante']
  } });
  const saved = buildReportServicePayload({ type: 'limpeza', data: payload.extraData });
  assert.deepEqual(new Set(saved.extraData.chemicalProducts), new Set(['Ácido cítrico', 'Ácido clorídrico']));
  assert.deepEqual(saved.extraData['Produtos químicos utilizados'], saved.extraData.chemicalProducts);
  assert.deepEqual(saved.extraData.etapas, ['Desengraxe', 'Fase ácida', 'Fase sequestrante', 'Secagem']);
  assert.deepEqual(saved.extraData['Etapas realizadas no dia'], saved.extraData.etapas);
  const inox = buildReportServicePayload({ type: 'limpeza', data: { material: 'Inox', etapas: ['Fase passivante', 'Fase sequestrante', 'Fase ácida'] } });
  assert.deepEqual(inox.extraData.etapas, ['Fase ácida', 'Fase passivante']);
});

test('escopo selecionado permanece associado ao serviço após salvar e retomar', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();
  const first = buildReportServicePayload({ id: 'svc-1', type: 'limpeza', data: { __scopeKey: '"UG 2"', __scopeName: 'UG 2' } });
  const second = buildReportServicePayload({ id: 'svc-1', type: 'limpeza', data: first.extraData });
  assert.equal(second.extraData.__scopeKey, '"UG 2"');
  assert.equal(second.extraData.__scopeName, 'UG 2');
  assert.equal(second.extraData.Escopo, undefined);
});

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

test('buildReportServicePayload keeps a stable service key and persists the visible default oil-volume unit', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();

  const firstSave = buildReportServicePayload({
    id: 'svc-new-flushing',
    type: 'flushing',
    data: {
      equipmentId: 'LAMINADOR',
      system: 'Linha de lubrificação',
      tipoOleo: 'VG32',
      volumeOleo: '400'
    }
  });

  assert.equal(firstSave.extraData.__serviceLinkKey, 'svc-new-flushing');
  assert.equal(firstSave.extraData.volumeOleoUnit, 'L');
  assert.equal(firstSave.extraData['Volume de óleo'], '400 L');

  const secondSave = buildReportServicePayload({
    id: 'database-row-created-after-first-save',
    type: 'flushing',
    data: {
      ...firstSave.extraData,
      __uploads__: [{
        label: 'Foto do laudo',
        files: [{ fileName: 'laudo.jpg', mimeType: 'image/jpeg', storagePath: 'missao/laudo.jpg' }]
      }]
    }
  });

  assert.equal(secondSave.extraData.__serviceLinkKey, 'svc-new-flushing');
  assert.equal(secondSave.extraData.volumeOleoUnit, 'L');
  assert.equal(secondSave.extraData['Volume de óleo'], '400 L');
});

test('buildReportServicePayload keeps the same service key for every derived report type after a re-save', async () => {
  const { buildReportServicePayload } = await loadReportServicePayload();
  const serviceTypes = ['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica', 'inibicao'];

  for (const type of serviceTypes) {
    const originalKey = `draft-${type}`;
    const firstSave = buildReportServicePayload({
      id: originalKey,
      type,
      data: {
        equipmentId: 'EQ-1',
        system: 'Sistema A',
        tipoRelatorio: type === 'inibicao' ? ['RLI', 'RLF'] : undefined
      }
    });
    const secondSave = buildReportServicePayload({
      id: `database-row-${type}`,
      type,
      data: {
        ...firstSave.extraData,
        notes: 'Conteúdo adicionado na segunda gravação'
      }
    });

    assert.equal(firstSave.extraData.__serviceLinkKey, originalKey, type);
    assert.equal(secondSave.extraData.__serviceLinkKey, originalKey, type);
  }
});
