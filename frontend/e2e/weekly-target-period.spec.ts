import { expect, test } from '@playwright/test';

const panelFor = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Metas semanais de avanço', exact: true });

test('período fica no início, salva os dias e exclui medições fora do intervalo nas duas áreas', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await page.goto('/test/browser/weekly-progress.html');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await expect(panel.getByLabel('Início da contagem')).toHaveValue('1');
  await expect(panel.getByLabel('Fim da contagem')).toHaveValue('0');
  const position = await panel.evaluate(element => {
    const form = element.querySelector('form')!;
    return { first: form.firstElementChild?.className, start: form.querySelector('select')?.getBoundingClientRect().top,
      week: form.querySelector('input[type="date"]')?.getBoundingClientRect().top };
  });
  expect(position.first).toBe('mission-weekly-counting-period');
  expect(position.start!).toBeLessThan(position.week!);
  await panel.getByLabel('Fim da contagem').selectOption('5');
  await panel.getByLabel('Medida da meta').selectOption('M');
  await panel.getByLabel('Total geral (m)').fill('100');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  const current = panel.locator('.mission-weekly-progress-current');
  await expect(current.locator('dd').nth(1)).toHaveText('200 m');
  await expect(current).toContainText('28/09/2026 a 02/10/2026');
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await expect(panel.getByLabel('Fim da contagem')).toHaveValue('5');
  await panel.getByLabel('Início da contagem').selectOption('2');
  await panel.getByLabel('Fim da contagem').selectOption('2');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(current).toContainText('29/09/2026 a 29/09/2026');
  await expect(current).toContainText('Período encerrado');
  await expect(current.locator('dd').nth(1)).toHaveText('0 m');
  await page.getByRole('button', { name: 'Trocar área', exact: true }).click();
  await expect(current.locator('dd').nth(1)).toHaveText('0 m');
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await expect(panel.getByLabel('Início da contagem')).toHaveValue('2');
  await expect(panel.getByLabel('Fim da contagem')).toHaveValue('2');
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(panel.getByLabel('Início da contagem')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await panel.locator('.mission-weekly-counting-period').screenshot({ path: testInfo.outputPath('periodo-contagem-mobile.png') });
});

test('quarta a terça mantém a meta em andamento depois da virada da semana', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
  await page.goto('/test/browser/weekly-progress.html');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await panel.getByLabel('Início da contagem').selectOption('3');
  await panel.getByLabel('Fim da contagem').selectOption('2');
  await panel.locator('form input[type="date"]').fill('2026-09-28');
  await panel.getByRole('button', { name: 'Reutilizar meta toda semana', exact: true }).click();
  await panel.getByLabel('Medida da meta').selectOption('M');
  await panel.getByLabel('Total geral (m)').fill('100');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  const current = panel.locator('.mission-weekly-progress-current');
  await expect(current).toContainText('30/09/2026 a 06/10/2026 · Em andamento');
  await expect(current.locator('dd').nth(1)).toHaveText('200 m');
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await expect(panel.locator('form input[type="date"]')).toHaveValue('2026-09-28');
  await expect(panel.getByLabel('Início da contagem')).toHaveValue('3');
  await expect(panel.getByLabel('Fim da contagem')).toHaveValue('2');
});

test('período que ainda não começou fica aguardando início, inclusive na meta por dia produtivo', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
  await page.goto('/test/browser/weekly-progress.html');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await panel.getByLabel('Início da contagem').selectOption('3');
  await panel.getByLabel('Fim da contagem').selectOption('5');
  await panel.getByLabel('Medida da meta').selectOption('M');
  await panel.getByLabel('Base de cálculo').selectOption('PER_PRODUCTIVE_DAY');
  await panel.getByLabel('Total geral (m/colaborador produtivo/dia)').fill('27');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(panel.locator('.mission-weekly-progress-current')).toContainText('07/10/2026 a 09/10/2026 · Aguardando início');
  await expect(page.locator('[data-acp-weekly-current]')).toContainText('Aguardando início');
  await expect(panel.locator('.mission-weekly-progress-current .mission-weekly-status')).toHaveText('Período futuro');
});
