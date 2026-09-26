import assert from 'node:assert/strict';
import test from 'node:test';

test('nome do card individual não altera o nome oficial do projeto e pode ser restaurado', async () => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/card_name_test';
  const { setProjectCardName } = await import('../src/lib/acompanhamento/project-card-name.js');
  const project = { id: 'p1', name: 'Missão oficial', acompanhamentoCardName: null };
  const writes = [];
  const db = { project: {
    findFirst: async ({ where }) => where.id === project.id && where.deletedAt === null ? project : null,
    update: async ({ where, data, select }) => {
      assert.equal(where.id, project.id);
      assert.deepEqual(select, { id: true, acompanhamentoCardName: true });
      writes.push(data);
      Object.assign(project, data);
      return { id: project.id, acompanhamentoCardName: project.acompanhamentoCardName };
    }
  } };

  assert.deepEqual(await setProjectCardName({ projectId: 'p1', name: 'Apelido no Acompanhamento', db }),
    { projectId: 'p1', cardName: 'Apelido no Acompanhamento' });
  assert.deepEqual(writes[0], { acompanhamentoCardName: 'Apelido no Acompanhamento' });
  assert.equal(project.name, 'Missão oficial');

  assert.deepEqual(await setProjectCardName({ projectId: 'p1', name: 'Missão oficial', db }),
    { projectId: 'p1', cardName: null });
  assert.deepEqual(writes[1], { acompanhamentoCardName: null });
  assert.equal(await setProjectCardName({ projectId: 'inexistente', name: 'Novo nome', db }), null);
  assert.equal(writes.length, 2);
});
