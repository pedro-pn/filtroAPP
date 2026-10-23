import { expect, test, type Locator, type Page } from '@playwright/test';

const field = (page: Page, label: string, index = 0) => page.locator('.rdo-edit-form .upload-field').filter({
  has: page.locator('.upload-field-label', { hasText: new RegExp(`^${label}$`) })
}).nth(index);

async function dragPhoto(page: Page, source: Locator, destination: Locator, file: string) {
  const handle = source.getByRole('button', { name: `Reordenar ${file},` });
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  if (!start) throw new Error('Foto de origem não encontrada');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2);
  await expect(page.locator('.upload-drag-ghost')).toBeVisible();
  const zone = destination.locator('.upload-dropzone');
  await zone.scrollIntoViewIfNeeded();
  const end = await zone.boundingBox();
  if (!end) throw new Error('Campo de destino não encontrado');
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.upload-drag-ghost')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/test/browser/rdo-photo-transfer.html');
  await expect(page.locator('.rdo-edit-form')).toBeVisible();
});

test('move entre campos, serviços e atividades e preserva os destinos ao salvar e reabrir', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const gauge = field(page, 'Fotos do manômetro');
  const system = field(page, 'Fotos do sistema');
  const otherService = field(page, 'Imagens da limpeza');
  const activity = field(page, 'Fotos de registro');
  await dragPhoto(page, gauge, system, 'manometro.jpg');
  await expect(gauge.locator('.upload-list-item')).toHaveCount(0);
  await expect(system.locator('.upload-list-name')).toHaveText(['manometro.jpg']);
  await dragPhoto(page, activity, gauge, 'atividade.jpg');
  await dragPhoto(page, system, otherService, 'manometro.jpg');
  await expect(otherService.locator('.upload-list-name')).toHaveText(['mecanica.jpg', 'manometro.jpg']);
  await dragPhoto(page, otherService, activity, 'mecanica.jpg');
  await expect(activity.locator('.upload-list-name')).toHaveText(['mecanica.jpg']);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Relatório atualizado.', { exact: true })).toBeVisible();
  const writes = await page.evaluate(() => (window as unknown as { photoTransferCalls: { method: string; url: string }[] }).photoTransferCalls.filter(call => call.method !== 'get'));
  expect(writes.map(call => [call.method, call.url])).toEqual([['put', '/rdo/reports/report']]);
  await page.reload();
  await expect(gauge.locator('.upload-list-name')).toHaveText(['atividade.jpg']);
  await expect(system.locator('.upload-list-item')).toHaveCount(0);
  await expect(otherService.locator('.upload-list-name')).toHaveText(['manometro.jpg']);
  await expect(activity.locator('.upload-list-name')).toHaveText(['mecanica.jpg']);
  expect(errors).toEqual([]);
});

test('cancela fora dos campos e com Escape, isola outros RDOs e descarta movimentos não salvos', async ({ page }) => {
  const gauge = field(page, 'Fotos do manômetro');
  await dragPhoto(page, gauge, page.getByRole('complementary', { name: 'Outro RDO' }).locator('.upload-field'), 'manometro.jpg');
  await expect(gauge.locator('.upload-list-name')).toHaveText(['manometro.jpg']);
  const handle = gauge.locator('.upload-reorder-handle');
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  if (!start) throw new Error('Foto não encontrada');
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.upload-drag-ghost')).toHaveCount(0);
  await expect(gauge.locator('.upload-list-name')).toHaveText(['manometro.jpg']);
  await dragPhoto(page, gauge, field(page, 'Fotos de registro'), 'manometro.jpg');
  await page.reload();
  await expect(gauge.locator('.upload-list-name')).toHaveText(['manometro.jpg']);
});

test('relatório assinado não oferece movimentação de fotos', async ({ page }) => {
  await page.goto('/test/browser/rdo-photo-transfer.html?assinado=1');
  await expect(page.locator('.rdo-edit-form')).toHaveCount(0);
  await expect(page.locator('.upload-reorder-handle')).toHaveCount(0);
});

test('um upload em andamento não restaura fotos movidas de outro campo do serviço', async ({ page }) => {
  await page.goto('/test/browser/rdo-photo-transfer.html?envio-lento=1');
  const gauge = field(page, 'Fotos do manômetro');
  const system = field(page, 'Fotos do sistema');
  const otherService = field(page, 'Imagens da limpeza');
  await dragPhoto(page, field(page, 'Fotos de registro'), system, 'atividade.jpg');
  await gauge.locator('input[type="file"][multiple]').setInputFiles({
    name: 'nova.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64')
  });
  await expect(gauge.locator('.upload-dropzone strong')).toHaveText('Enviando…');
  await dragPhoto(page, system, otherService, 'atividade.jpg');
  await page.evaluate(() => (window as unknown as { completePhotoUpload: () => void }).completePhotoUpload());
  await expect(gauge.locator('.upload-list-name')).toHaveText(['manometro.jpg', 'nova.png']);
  await expect(system.locator('.upload-list-item')).toHaveCount(0);
  await expect(otherService.locator('.upload-list-name')).toHaveText(['mecanica.jpg', 'atividade.jpg']);
});

test('rola a revisão ao manter a foto perto da borda e cancela sem mover', async ({ page }) => {
  const gauge = field(page, 'Fotos do manômetro');
  const handle = gauge.locator('.upload-reorder-handle');
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const before = await gauge.boundingBox();
  if (!start || !before) throw new Error('Foto não encontrada');
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, page.viewportSize()!.height - 10, { steps: 5 });
  await expect.poll(async () => (await gauge.boundingBox())?.y ?? before.y).toBeLessThan(before.y - 30);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(gauge.locator('.upload-list-name')).toHaveText(['manometro.jpg']);
});

test('reordena com teclado e cancela ao soltar fora de um campo de fotos', async ({ page }) => {
  const gauge = field(page, 'Fotos do manômetro');
  const system = field(page, 'Imagens da limpeza');
  await dragPhoto(page, gauge, system, 'manometro.jpg');
  const handle = system.getByRole('button', { name: 'Reordenar manometro.jpg,' });
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(system.locator('.upload-list-name')).toHaveText(['manometro.jpg', 'mecanica.jpg']);
  await page.keyboard.press('ArrowDown');
  await expect(system.locator('.upload-list-name')).toHaveText(['mecanica.jpg', 'manometro.jpg']);
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  if (!start) throw new Error('Foto não encontrada');
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(1, 200, { steps: 5 });
  await page.mouse.up();
  await expect(system.locator('.upload-list-name')).toHaveText(['mecanica.jpg', 'manometro.jpg']);
});

test.describe('toque', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('move uma foto entre serviço e atividade no celular', async ({ page, context }) => {
    const gauge = field(page, 'Fotos do manômetro');
    const activity = field(page, 'Fotos de registro');
    const handle = gauge.locator('.upload-reorder-handle');
    await handle.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox();
    if (!start) throw new Error('Foto não encontrada');
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + 10, y: start.y + 10 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 25, y: start.y + 10 }] });
    await expect(page.locator('.upload-drag-ghost')).toBeVisible();
    await activity.locator('.upload-dropzone').scrollIntoViewIfNeeded();
    const end = await activity.locator('.upload-dropzone').boundingBox();
    if (!end) throw new Error('Destino não encontrado');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x + end.width / 2, y: end.y + end.height / 2 }] });
    await expect(activity).toHaveAttribute('data-transfer-over', 'true');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(gauge.locator('.upload-list-item')).toHaveCount(0);
    await expect(activity.locator('.upload-list-name')).toHaveText(['atividade.jpg', 'manometro.jpg']);
    await touch.detach();
  });
});
