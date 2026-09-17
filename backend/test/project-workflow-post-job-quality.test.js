import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __postJobQualityTestables,
  synchronizePostJobQualityRecord
} from '../src/lib/efetivo/project-workflow/post-job-quality.js';

test('síntese do pós-job preserva os campos pesquisáveis da lição', () => {
  const description = __postJobQualityTestables.qualityDescription({
    problemsFound: 'Mangueira sem identificação.',
    solutionsAdopted: 'Conferência cruzada.',
    lessonsLearned: 'Separar kits por sistema.'
  });
  assert.match(description, /Problemas encontrados:\nMangueira/);
  assert.match(description, /Soluções adotadas:\nConferência/);
  assert.match(description, /Lições aprendidas:\nSeparar kits/);
  assert.equal(__postJobQualityTestables.qualityOrigin(['FLUSHING']), 'Pós-job / fechamento técnico · FLUSHING');
});

test('lição cria um registro numerado e atualizações reutilizam o mesmo registro', async () => {
  const created = [];
  const updated = [];
  let current = null;
  const tx = {
    qualityRecordSeq: {
      upsert: async () => ({ lastSeq: 4 })
    },
    qualityRecord: {
      findFirst: async () => current,
      create: async ({ data }) => {
        created.push(data);
        current = { id: 'quality-1' };
        return current;
      },
      update: async ({ where, data }) => {
        updated.push({ where, data });
        return { id: where.id };
      },
      updateMany: async () => ({ count: 0 })
    }
  };
  const input = {
    projectId: 'project-1',
    postJob: { meetingDate: new Date('2026-09-25T00:00:00Z'), lessonsLearned: 'Identificar os kits.' },
    serviceTypes: ['FLUSHING'],
    actorUserId: 'leader-1',
    now: new Date('2026-09-26T00:00:00Z')
  };
  const id = await synchronizePostJobQualityRecord(tx, input);
  assert.equal(id, 'quality-1');
  assert.equal(created[0].number, 'L-004/26');
  assert.equal(created[0].type, 'LICAO_APRENDIDA');
  assert.equal(created[0].projectId, 'project-1');
  assert.equal(created[0].status, 'DIVULGADO');

  const reused = await synchronizePostJobQualityRecord(tx, { ...input, qualityRecordId: id });
  assert.equal(reused, id);
  assert.equal(created.length, 1);
  assert.equal(updated.length, 1);
});

test('remoção da lição arquiva o registro sincronizado', async () => {
  let archived = null;
  const tx = {
    qualityRecord: {
      updateMany: async args => {
        archived = args;
        return { count: 1 };
      }
    }
  };
  const result = await synchronizePostJobQualityRecord(tx, {
    projectId: 'project-1',
    qualityRecordId: 'quality-1',
    postJob: { lessonsLearned: null },
    actorUserId: 'leader-1',
    now: new Date('2026-09-26T00:00:00Z')
  });
  assert.equal(result, null);
  assert.equal(archived.where.id, 'quality-1');
  assert.equal(archived.data.deletedById, 'leader-1');
});
