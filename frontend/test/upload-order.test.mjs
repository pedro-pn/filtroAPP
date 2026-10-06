import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false, root: new URL('..', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true }, appType: 'custom'
});
let moveUpload;
let buildReportServicePayload;
let updateServiceUploadGroup;
try {
  ({ moveUpload } = await server.ssrLoadModule('/src/utils/uploadOrder.ts'));
  ({ buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts'));
  ({ updateServiceUploadGroup } = await server.ssrLoadModule('/src/utils/serviceUploadGroups.ts'));
} finally {
  await server.close();
}

test('reordenação conserva as fotos e persiste a sequência após salvar o serviço novamente', () => {
  const files = ['primeira', 'segunda', 'terceira'].map(name => ({
    fileName: `${name}.jpg`, mimeType: 'image/jpeg', storagePath: `Missão 1/Fotos/${name}.jpg`
  }));
  const reordered = moveUpload(files, 0, 2);
  assert.deepEqual(reordered.map(file => file.fileName), ['segunda.jpg', 'terceira.jpg', 'primeira.jpg']);
  assert.deepEqual(files.map(file => file.fileName), ['primeira.jpg', 'segunda.jpg', 'terceira.jpg']);
  assert.deepEqual(moveUpload(reordered, 2, 0), files);
  const data = { __uploads__: [{ label: 'Fotos do sistema', files }], 'Fotos do sistema': files };
  const payload = buildReportServicePayload({ type: 'pressao', data: { ...data, ...updateServiceUploadGroup(data, 'Fotos do sistema', reordered) } });
  const savedAgain = buildReportServicePayload({ type: 'pressao', data: payload.extraData });
  assert.deepEqual(savedAgain.extraData.__uploads__[0].files, reordered);
  assert.deepEqual(savedAgain.extraData['Fotos do sistema'], reordered);
});

test('reordenação atualiza aliases antigos sem restaurar fotos removidas ou marcas da interface', () => {
  const files = ['primeira', 'segunda'].map(name => ({
    fileName: `${name}.jpg`, url: `Missão 1/Fotos/${name}.jpg`, mimeType: 'image/jpeg', __previouslyAdded: true
  }));
  const data = { 'Foto do laudo do contador': files, __uploads__: [{ label: 'Foto do laudo do contador', files }] };
  const update = updateServiceUploadGroup(data, 'Foto do laudo', moveUpload(files, 0, 1));
  const payload = buildReportServicePayload({ type: 'filtragem', data: { ...data, ...update } });
  assert.deepEqual(payload.extraData['Foto do laudo do contador'].map(file => file.fileName), ['segunda.jpg', 'primeira.jpg']);
  assert.equal(payload.extraData['Foto do laudo'][0].__previouslyAdded, undefined);
  const removed = updateServiceUploadGroup(payload.extraData, 'Foto do laudo', []);
  const saved = buildReportServicePayload({ type: 'filtragem', data: { ...payload.extraData, ...removed } });
  assert.deepEqual(saved.extraData.__uploads__, []);
  assert.deepEqual(saved.extraData['Foto do laudo do contador'], []);
});

test('movimentos além dos limites mantêm todas as fotos e a ordem', () => {
  const files = ['a', 'b', 'c'];
  for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0, 0], [0.5, 1]]) {
    assert.deepEqual(moveUpload(files, from, to), files);
  }
  assert.deepEqual(moveUpload([], 0, 1), []);
});
