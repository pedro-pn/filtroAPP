async (page) => {
  const base = page.url().split('/test/')[0] + '/test/browser/notification-center.html';
  await page.goto(base);
  await page.evaluate(() => sessionStorage.removeItem('notification-fixture-reads'));
  await page.reload();
  const bell = () => page.getByRole('button', { name: /^Notificações/ });
  const waitLabel = label => page.waitForFunction(label => document.querySelector('[aria-haspopup="dialog"]')?.getAttribute('aria-label') === label, label);
  const rows = page.locator('.notification-center-item');
  const closeDialog = () => page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  const waitRows = count => page.waitForFunction(count => document.querySelectorAll('.notification-center-item').length === count, count);
  await waitLabel('Notificações, 23 não lidas');
  const assertBellOnRight = async () => {
    const header = page.locator('header').first();
    const actions = header.locator('.fv-topbar__actions, .topbar-actions-react');
    if (!await actions.locator('.notification-center-trigger').count()) throw new Error('Bell is outside the header actions');
    const bounds = await header.boundingBox();
    const trigger = await bell().boundingBox();
    if (!bounds || !trigger || trigger.x + trigger.width / 2 < bounds.x + bounds.width / 2
      || trigger.x + trigger.width > bounds.x + bounds.width + 1) throw new Error('Bell is not on the right of the header');
  };
  await assertBellOnRight();
  await bell().click();
  await waitRows(20);
  await page.evaluate(() => { window.notificationFixture.failPage = true; });
  await page.getByRole('button', { name: 'Carregar anteriores' }).click();
  await page.getByRole('alert').filter({ hasText: 'avisos anteriores' }).waitFor();
  await waitLabel('Notificações, 23 não lidas');
  if (await rows.count() !== 20) throw new Error('Next-page failure discarded loaded items');
  await page.evaluate(() => { window.notificationFixture.failPage = false; });
  await page.getByRole('button', { name: 'Tentar carregar novamente' }).click();
  await waitRows(23);
  await page.evaluate(() => { window.notificationFixture.failRead = true; });
  await rows.first().getByRole('button').click();
  await page.getByRole('alert').filter({ hasText: 'Falha na comunicação' }).waitFor();
  if (new URL(page.url()).searchParams.has('opened')) throw new Error('Failed read navigated');
  await page.evaluate(() => { window.notificationFixture.failRead = false; });
  await rows.first().getByRole('button').click();
  await page.waitForURL(url => url.searchParams.get('opened') === '0');
  await waitLabel('Notificações, 22 não lidas');
  await bell().click();
  await page.getByRole('button', { name: /^Não lidas/ }).click();
  await waitRows(20);
  if (await rows.filter({ hasText: '5800 —' }).count()) throw new Error('Read item remains in unread filter');
  await page.evaluate(() => { window.notificationFixture.failAll = true; });
  await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
  await page.getByRole('alert').filter({ hasText: 'Falha na comunicação' }).waitFor();
  await waitLabel('Notificações, 22 não lidas');
  await page.evaluate(() => { window.notificationFixture.failAll = false; });
  await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
  await page.getByText('Tudo em dia', { exact: true }).waitFor();
  await waitLabel('Notificações');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  if (!await bell().evaluate(node => node === document.activeElement)) throw new Error('Escape did not restore focus');
  await page.reload();
  await waitLabel('Notificações');
  await bell().click();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await waitRows(20);
  if (await page.locator('.notification-center-item.is-unread').count()) throw new Error('Read status was lost on reload');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const dimensions = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth }));
    if (dimensions.width > width || dimensions.scroll > dimensions.client) throw new Error(`Overflow at ${width}: ${JSON.stringify(dimensions)}`);
  }
  await page.screenshot({ path: 'output/playwright/notification-center-mobile.png' });
  await closeDialog();
  await page.getByRole('button', { name: 'Trocar conta' }).click();
  await bell().click();
  await page.getByText('Nenhuma notificação por enquanto', { exact: true }).waitFor();
  if (await rows.count()) throw new Error('Previous account notifications leaked');
  await closeDialog();
  await page.getByRole('button', { name: 'Trocar conta' }).click();
  await page.evaluate(() => { window.notificationFixture.failList = true; });
  await bell().click();
  await page.getByText('Não foi possível carregar as notificações.', { exact: true }).waitFor();
  if (await rows.count()) throw new Error('Query error exposed stale items');
  await page.evaluate(() => { window.notificationFixture.failList = false; });
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await waitRows(20);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: 'output/playwright/notification-center-desktop.png' });
  await closeDialog();
  for (const width of [1365, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await assertBellOnRight();
  }
  await page.goto(base + '?header=legacy');
  await bell().waitFor();
  for (const width of [1365, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await assertBellOnRight();
  }
  await bell().click();
  await page.getByRole('dialog', { name: 'Central de notificações' }).waitFor();
  await closeDialog();
  return 'Passed: right-side bell in both headers at 1365/390/320px, pagination and retry, individual/all reads, failed writes, persistence, Escape/focus, account isolation and fetch retry.';
}
