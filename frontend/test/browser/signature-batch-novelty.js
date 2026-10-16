async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const base = page.url().split('/test/')[0] + '/test/browser/signature-batch.html?novelty=1';
  const key = 'filtrovali:assinaturas-batch-novelty:v1:signature-batch-novelty-browser';
  await page.addInitScript(() => {
    const start = performance.now();
    const timestamp = Date.parse(location.search.includes('expired=1') ? '2026-10-21T00:00:00-03:00' : '2026-10-16T12:00:00-03:00');
    Date.now = () => timestamp + performance.now() - start;
  });
  await page.evaluate(() => {
    localStorage.removeItem('filtrovali:assinaturas-tutorial:v1:signature-batch-novelty-browser');
    localStorage.removeItem('filtrovali:assinaturas-batch-novelty:v1:signature-batch-novelty-browser');
  });
  await page.goto(base);
  const title = page.locator('.driver-popover-title');
  await title.filter({ hasText: '1. Envie os PDFs' }).waitFor();
  await page.waitForTimeout(1600);
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'aguardar outro tutorial não deve consumir a novidade');
  await page.locator('.driver-popover-close-btn').click();
  await title.filter({ hasText: 'Novidade: assinatura em lote' }).waitFor();
  await page.waitForFunction(key => localStorage.getItem(key) === '1', key);
  assert(await page.locator('.driver-popover-description').innerText().then(text => text.includes('vários PDFs')), 'o anúncio deve explicar a seleção múltipla');
  await page.locator('.driver-popover-next-btn').click();
  await title.filter({ hasText: 'Um convite por assinante' }).waitFor();
  await page.locator('.driver-popover-next-btn').click();
  await title.filter({ hasText: 'Acompanhe o lote' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'a campanha deve caber no celular');
  await page.screenshot({ path: 'output/playwright/assinaturas-lote-novidade-mobile.png' });
  await page.locator('.driver-popover-next-btn').click();
  await page.reload();
  await page.waitForTimeout(1600);
  assert(await title.count() === 0, 'a campanha não pode reaparecer para quem já viu');

  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.reload();
  await page.getByRole('button', { name: 'Novo documento', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Novos documentos' }).waitFor();
  await page.waitForTimeout(1600);
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'abrir um formulário antes do aviso não deve marcá-lo como visto');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await title.filter({ hasText: 'Novidade: assinatura em lote' }).waitFor();
  await page.locator('.driver-popover-close-btn').click();
  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.goto(`${base}&expired=1`);
  await page.waitForTimeout(1600);
  assert(await title.count() === 0, 'a campanha expira globalmente ao completar cinco dias');
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'uma campanha expirada não deve ser marcada como vista');
  return { passed: true, checks: ['tutorial anterior preservado', 'aviso aguardado sem consumo', 'três etapas', 'exibição única', 'modal sem sobreposição', 'mobile', 'expiração em cinco dias'] };
}
