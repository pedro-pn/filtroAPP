async page => {
  const base = page.url().split('/test/')[0] + '/test/browser/notification-center.html?backup=1';
  await page.goto(base);
  await page.evaluate(() => { sessionStorage.removeItem('notification-fixture-reads'); sessionStorage.removeItem('notification-fixture-deleted'); });
  await page.reload();
  const popup = page.getByRole('dialog', { name: 'Falha no backup', exact: true });
  await popup.waitFor();
  if (await page.locator('.notification-center').count()) throw new Error('O popup exige abertura automática, sem o painel de notificações.');
  if (!await popup.getByRole('button', { name: 'Entendi', exact: true }).evaluate(node => node === document.activeElement)) throw new Error('O foco não foi colocado no popup.');
  if (!await popup.locator('.fv-alert.fv-tone--danger').count()) throw new Error('O popup não usa o alerta de perigo do design system.');
  for (const width of [1365, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await popup.evaluate(node => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth }));
    if (bounds.width > width || bounds.scroll > bounds.client) throw new Error(`Popup excede a tela de ${width}px`);
  }
  await page.screenshot({ path: 'output/playwright/backup-failure-mobile.png' });
  await page.locator('.notification-backup-backdrop').click({ position: { x: 2, y: 2 } });
  if (!await popup.isVisible()) throw new Error('Clique no fundo dispensou o alerta crítico.');
  await page.evaluate(() => { window.notificationFixture.failRead = true; });
  await popup.getByRole('button', { name: 'Entendi', exact: true }).click();
  await popup.getByRole('alert').filter({ hasText: 'Não foi possível confirmar' }).waitFor();
  await page.evaluate(() => { window.notificationFixture.failRead = false; });
  await popup.getByRole('button', { name: 'Entendi', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
  await page.reload();
  const bell = page.getByRole('button', { name: /^Notificações/ });
  await page.waitForFunction(() => document.querySelector('[aria-haspopup="dialog"]')?.getAttribute('aria-label') === 'Notificações, 24 não lidas');
  if (await popup.count()) throw new Error('O mesmo backup abriu novamente após confirmar e recarregar.');
  await bell.click();
  const sync = page.locator('.notification-center-item').filter({ hasText: 'Falha de sincronização · Omie · compras' });
  await sync.waitFor();
  await sync.locator('.notification-center-link').click();
  await page.waitForURL(url => url.pathname === '/operacoes');
  await page.evaluate(() => { window.notificationFixture.backupId = 'backup-2'; });
  await bell.click();
  await popup.waitFor();
  await popup.getByRole('button', { name: 'Ver diagnóstico', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
  await page.waitForURL(url => url.pathname === '/operacoes');
  await page.goto(base);
  await page.evaluate(() => { window.notificationFixture.backupId = 'backup-recovered'; window.notificationFixture.backupActive = false; });
  await bell.click();
  await page.getByRole('dialog', { name: 'Central de notificações' }).waitFor();
  if (await popup.count()) throw new Error('Backup recuperado ainda exige popup.');
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Trocar conta', exact: true }).click();
  await page.evaluate(() => {
    window.notificationFixture.backupId = 'backup-non-admin';
    window.notificationFixture.backupActive = true;
    window.notificationFixture.forceCriticalForNonAdmin = true;
  });
  await bell.click();
  await page.getByText('Tudo em dia', { exact: true }).waitFor();
  if (await popup.count()) throw new Error('Conta sem acesso de administrador exibiu o popup.');
  return 'PASS: popup automático fora da primeira página, design system, foco, 1365/390/320px, falha/retry de leitura, persistência, novo incidente, diagnóstico, recuperação e restrição a administradores inclusive com resposta indevida da API.';
}
