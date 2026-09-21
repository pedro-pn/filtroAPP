import assert from 'node:assert/strict';
import test from 'node:test';

import { cameraErrorMessage, capturedPhotoFileName } from '../src/utils/camera.ts';
import { prepareImageForUpload, UPLOAD_IMAGE_PASSTHROUGH_BYTES } from '../src/utils/imageUpload.ts';

test('foto tirada na hora recebe nome com data, hora e milissegundos, em .jpg', () => {
  assert.equal(capturedPhotoFileName(new Date(2026, 8, 21, 14, 3, 7, 45)), 'foto-2026-09-21-14h03m07s-045.jpg');
});

test('mensagem de erro da câmera segue a ação pedida e o motivo', () => {
  const denied = new DOMException('negado', 'NotAllowedError');
  assert.equal(cameraErrorMessage(denied), 'Permita o acesso à câmera para escanear o QR code.');
  assert.equal(cameraErrorMessage(denied, 'tirar a foto'), 'Permita o acesso à câmera para tirar a foto.');
  assert.match(cameraErrorMessage(new DOMException('', 'NotFoundError')), /Nenhuma câmera/);
  assert.match(cameraErrorMessage(new DOMException('', 'NotReadableError')), /outro aplicativo/);
  assert.match(cameraErrorMessage(new Error('qualquer')), /Não foi possível iniciar a câmera/);
});

test('foto leve, HEIC e formatos não decodificáveis seguem intactos para o envio', async () => {
  const heavy = new Uint8Array(UPLOAD_IMAGE_PASSTHROUGH_BYTES + 1);
  const light = new File([new Uint8Array(1000)], 'leve.jpg', { type: 'image/jpeg' });
  const exactlyAtLimit = new File([new Uint8Array(UPLOAD_IMAGE_PASSTHROUGH_BYTES)], 'limite.jpg', { type: 'image/jpeg' });
  const heic = new File([heavy], 'IMG_1.HEIC', { type: 'image/heic' });
  const gif = new File([heavy], 'animada.gif', { type: 'image/gif' });
  const noType = new File([heavy], 'sem-tipo.jpg', { type: '' });

  for (const file of [light, exactlyAtLimit, heic, gif, noType]) {
    assert.equal(await prepareImageForUpload(file), file, file.name);
  }
});

test('foto pesada que o navegador não consegue decodificar segue como está, sem erro', async () => {
  // Fora do navegador não há createImageBitmap/document: o envio do original continua possível.
  const broken = new File([new Uint8Array(UPLOAD_IMAGE_PASSTHROUGH_BYTES + 1)], 'quebrada.jpg', { type: 'image/jpeg' });
  assert.equal(await prepareImageForUpload(broken), broken);
});
