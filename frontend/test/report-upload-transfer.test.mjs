import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false, root: new URL('..', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true }, appType: 'custom'
});
let moveReportUpload, getServiceUploadGroup, buildReportServicePayload;
try {
  ({ moveReportUpload } = await server.ssrLoadModule('/src/utils/reportUploadTransfer.ts'));
  ({ getServiceUploadGroup } = await server.ssrLoadModule('/src/utils/serviceUploadGroups.ts'));
  ({ buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts'));
} finally {
  await server.close();
}

const photo = name => ({ label: 'Fotos do manômetro', fileName: `${name}.jpg`, mimeType: 'image/jpeg', url: `Missão/Fotos/${name}.jpg` });
const gauge = { serviceId: 'pressure', label: 'Fotos do manômetro' };
const system = { serviceId: 'pressure', label: 'Fotos do sistema' };
const activity = { label: 'Fotos de registro' };
const report = () => ({
  generalUploads: [photo('atividade')],
  services: [
    { id: 'pressure', type: 'pressao', data: {
      notes: 'Preservar', __uploads__: [{ label: gauge.label, files: [photo('a'), photo('b')] }],
      [gauge.label]: [photo('a'), photo('b')]
    } },
    { id: 'filter', type: 'filtragem', data: { 'Foto do laudo do contador': [photo('laudo')] } }
  ]
});
const filesAt = (form, target) => target.serviceId
  ? getServiceUploadGroup(form.services.find(service => service.id === target.serviceId).data, target.label)
  : form.generalUploads;
const move = (form, source, destination, from = 0, to = 0) => moveReportUpload(form, {
  source, destination, from, to, fileUrl: filesAt(form, source)[from]?.url
});

test('move entre dois campos do mesmo serviço de forma atômica e persiste após salvar novamente', () => {
  const original = report();
  const result = move(original, gauge, system);
  assert.deepEqual(filesAt(result, gauge).map(file => file.fileName), ['b.jpg']);
  assert.deepEqual(filesAt(result, system), [{ ...photo('a'), label: system.label }]);
  assert.equal(result.services[0].data.notes, 'Preservar');
  assert.deepEqual(filesAt(original, gauge), [photo('a'), photo('b')]);
  let data = result.services[0].data;
  for (let i = 0; i < 2; i++) data = buildReportServicePayload({ type: 'pressao', data }).extraData;
  assert.deepEqual(getServiceUploadGroup(data, gauge.label), [photo('b')]);
  assert.deepEqual(getServiceUploadGroup(data, system.label), [{ ...photo('a'), label: system.label }]);
});

test('move de atividade para serviço, de serviço para atividade e entre serviços diferentes', () => {
  const original = report();
  const withActivity = move(original, activity, system);
  assert.deepEqual(withActivity.generalUploads, []);
  assert.equal(filesAt(withActivity, system)[0].url, photo('atividade').url);
  const withService = move(withActivity, gauge, activity);
  assert.deepEqual(withService.generalUploads, [{ ...photo('a'), label: activity.label }]);
  const otherService = { serviceId: 'filter', label: 'Foto do laudo' };
  const betweenServices = move(withService, system, otherService, 0, 1);
  assert.deepEqual(filesAt(betweenServices, system), []);
  const data = betweenServices.services[1].data;
  assert.deepEqual(data['Foto do laudo'].map(file => file.fileName), ['laudo.jpg', 'atividade.jpg']);
  assert.deepEqual(data['Foto do laudo do contador'], data['Foto do laudo']);
});

test('remove também o alias antigo da origem e conserva URLs, marcadores e ordem relativa', () => {
  const original = report();
  const legacy = { serviceId: 'filter', label: 'Foto do laudo' };
  const result = move(original, legacy, gauge, 0, 1);
  assert.deepEqual(filesAt(result, legacy), []);
  assert.deepEqual(result.services[1].data['Foto do laudo do contador'], []);
  assert.deepEqual(filesAt(result, gauge).map(file => file.fileName), ['a.jpg', 'laudo.jpg', 'b.jpg']);
  const inherited = { ...photo('a'), __previouslyAdded: true, storagePath: 'Missão/Fotos/a.jpg' };
  original.generalUploads = [inherited];
  assert.deepEqual(filesAt(move(original, activity, system), system), [{ ...inherited, label: system.label }]);
});

test('mantém reordenação no mesmo campo e evita duplicar uma foto já presente no destino', () => {
  const original = report();
  assert.deepEqual(filesAt(move(original, gauge, gauge, 0, 1), gauge), [photo('b'), photo('a')]);
  original.generalUploads = [photo('a')];
  const result = move(original, gauge, activity);
  assert.deepEqual(filesAt(result, gauge), [photo('b')]);
  assert.deepEqual(result.generalUploads, [photo('a')]);
});

test('ignora índices inválidos, serviço de outro RDO e origem alterada durante o gesto', () => {
  const original = report();
  for (const patch of [
    { from: -1 }, { from: 2 }, { from: 0.5 }, { to: -1 }, { to: 1 },
    { destination: { serviceId: 'outro-rdo', label: system.label } },
    { source: { serviceId: 'apagado', label: gauge.label } }, { fileUrl: 'outra-foto.jpg' }
  ]) {
    assert.equal(moveReportUpload(original, { source: gauge, destination: system, from: 0, to: 0, fileUrl: photo('a').url, ...patch }), original);
  }
});
