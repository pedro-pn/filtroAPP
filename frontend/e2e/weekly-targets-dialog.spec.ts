import { expect, test, type Page } from '@playwright/test';

const panelFor = (page: Page) => page.getByRole('region', { name: 'Metas semanais de avanço', exact: true });
const dialogFor = (page: Page) => page.getByRole('dialog', { name: 'Meta semanal', exact: true });
const spotlightFor = (page: Page) => page.locator('[data-acp-weekly-spotlight]');
// Sem semana fechada com meta, o card já mostra a semana atual e não exibe a alternância.
async function showCurrent(page: Page) {
  const button = spotlightFor(page).getByRole('button', { name: /^Atual/ });
  if (await button.count()) await button.click();
}

// Quinta-feira, 01/10/2026: a contagem padrão (sexta a quinta) vai de 25/09 a 01/10.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await page.goto('/test/browser/weekly-progress.html');
});

async function openDialog(page: Page) {
  await panelFor(page).getByRole('button', { name: 'Definir meta', exact: true }).click();
  const dialog = dialogFor(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillGoal(page: Page, index: number, kind: string, value: string, basis?: string) {
  const dialog = dialogFor(page);
  await dialog.getByLabel(`Meta ${index}: o que medir`).selectOption(kind);
  await dialog.getByLabel(`Meta ${index}: quantidade`).fill(value);
  if (basis) await dialog.getByLabel(`Meta ${index}: forma de contar`).selectOption(basis);
}

test('meta por colaborador/dia usa a equipe do RDO; E/OU decide a semana', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog.getByLabel('Vale a partir da semana')).toHaveValue('2026-09-21');
  await expect(dialog.getByLabel('Vale a partir da semana').locator('option:checked')).toHaveText('25/09 a 01/10 (atual)');
  await expect(dialog).toContainText('Contagem de sexta a quinta');
  await expect(dialog.getByLabel('Meta 1: o que medir')).toHaveValue('ANY_SERVICE');
  await fillGoal(page, 1, 'LIMPEZA_QUIMICA', '30');
  await expect(dialog).toContainText('Cada colaborador deve fazer 30 m de limpeza química por dia trabalhado.');
  await expect(dialog).toContainText('cada pessoa da equipe do RDO conta 1');
  await dialog.page().getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Equipe de 9 no RDO com limpeza → 9 × 30 = 270 m; foram feitos 150 m.
  const spotlight = spotlightFor(page);
  await showCurrent(page);
  await expect(spotlight).toContainText('de 270 m');
  await expect(spotlight).toContainText('9 colaboradores-dia');
  await expect(spotlight).toContainText('Abaixo da meta até agora');

  await spotlight.getByRole('button', { name: 'Editar meta', exact: true }).click();
  await expect(dialog.getByLabel('Meta 1: quantidade')).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Adicionar outra meta', exact: true }).click();
  await fillGoal(page, 2, 'TESTE_PRESSAO', '50', 'WEEK_TOTAL');
  await expect(dialog.locator('.wtd-join')).toHaveText('E');
  await dialog.getByLabel('Pelo menos uma for cumprida').check();
  await expect(dialog.locator('.wtd-join')).toHaveText('OU');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();
  await showCurrent(page);
  await expect(spotlight).toContainText('1 de 2');
  await expect(spotlight).toContainText('Dentro da meta até agora');
  await expect(spotlight).toContainText('Basta uma ser cumprida (OU).');

  await spotlight.getByRole('button', { name: 'Editar meta', exact: true }).click();
  await dialog.getByLabel('Todas forem cumpridas').check();
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await showCurrent(page);
  await expect(spotlight).toContainText('Meta parcial até agora');
  await expect(panelFor(page).locator('.mission-weekly-progress-current .mission-weekly-status').first()).toHaveText('Meta parcial');

  // A mesma meta aparece no Efetivo.
  await page.getByRole('button', { name: 'Trocar área', exact: true }).click();
  await showCurrent(page);
  await expect(spotlightFor(page)).toContainText('Meta parcial até agora');
});

test('conflito mantém o diálogo aberto e a meta pode valer a partir de uma semana futura', async ({ page }) => {
  let dialog = await openDialog(page);
  await fillGoal(page, 1, 'PROGRESS', '10');
  await expect(dialog.getByLabel('Meta 1: forma de contar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();
  const current = panelFor(page).locator('.mission-weekly-progress-current');
  await expect(current.locator('.mission-weekly-status').first()).toHaveText('Dentro da meta');

  await page.getByRole('button', { name: 'Simular conflito na próxima gravação', exact: true }).click();
  dialog = await openDialog(page);
  await dialog.getByLabel('Meta 1: quantidade').fill('20');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('alterada por outra pessoa');
  await expect(dialog).toBeVisible();
  await expect(current.locator('dd').nth(0)).toHaveText('10 p.p.');

  await dialog.getByLabel('Vale a partir da semana').selectOption({ label: '02/10 a 08/10' });
  await dialog.getByLabel('Meta 1: quantidade').fill('15');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(current.locator('dd').nth(0)).toHaveText('10 p.p.');
  await expect(panelFor(page).getByText('Período futuro', { exact: true }).first()).toBeVisible();
});

test('qualquer serviço soma todos os serviços com a equipe do dia contada uma vez', async ({ page }) => {
  const dialog = await openDialog(page);
  await fillGoal(page, 1, 'ANY_SERVICE', '10');
  await expect(dialog).toContainText('Cada colaborador deve fazer 10 m somando todos os serviços por dia trabalhado.');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();
  // Limpeza (9) e teste (6) no mesmo dia: a equipe do dia é 9 → 90 m; realizado 150 + 50 = 200 m.
  await showCurrent(page);
  await expect(spotlightFor(page)).toContainText('de 90 m');
  await expect(spotlightFor(page)).toContainText('Qualquer serviço');
  await expect(spotlightFor(page)).toContainText('9 colaboradores');
});

test('alterar os dias da contagem escolhe o período que contém hoje e valida cada linha', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Alterar dias', exact: true }).click();
  await dialog.getByLabel('Primeiro dia da contagem').selectOption('1');
  await dialog.getByLabel('Último dia da contagem').selectOption('0');
  await expect(dialog.getByLabel('Vale a partir da semana').locator('option:checked')).toHaveText('28/09 a 04/10 (atual)');
  await fillGoal(page, 1, 'FILTRAGEM', '0', 'WEEK_TOTAL');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('maior que zero');
  await dialog.getByLabel('Meta 1: quantidade').fill('10000');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(panelFor(page).locator('.mission-weekly-progress-current')).toContainText('28/09/2026 a 04/10/2026');
});

test('excluir pelo histórico pede confirmação e visualizador não edita', async ({ page }) => {
  const dialog = await openDialog(page);
  await fillGoal(page, 1, 'PROGRESS', '10');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(dialog).toBeHidden();
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Excluir meta da semana de 21/09/2026', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Excluir meta semanal' });
  await confirmation.getByRole('button', { name: 'Excluir meta', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(panel.locator('.mission-weekly-progress-current .mission-weekly-status').first()).toHaveText('Sem meta definida');
  await page.getByRole('button', { name: 'Alternar permissão', exact: true }).click();
  await expect(panel.getByRole('button', { name: /Definir|Editar|Excluir/ })).toHaveCount(0);
  await expect(spotlightFor(page)).toHaveCount(0);
});

test('diálogo e card cabem no celular sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openDialog(page);
  await fillGoal(page, 1, 'LIMPEZA_QUIMICA', '30');
  await dialog.getByRole('button', { name: 'Adicionar outra meta', exact: true }).click();
  await expect(dialog.getByLabel('Pelo menos uma for cumprida')).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await openDialog(page);
  await fillGoal(page, 1, 'LIMPEZA_QUIMICA', '30');
  await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await expect(spotlightFor(page)).toContainText('Meta da semana');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

for (const viewport of [
  { name: 'mobile-light', width: 390, height: 844, dark: false },
  { name: 'desktop-dark', width: 1280, height: 900, dark: true }
] as const) {
  test(`card e diálogo de meta · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    if (viewport.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    const dialog = await openDialog(page);
    await fillGoal(page, 1, 'LIMPEZA_QUIMICA', '30');
    await dialog.getByRole('button', { name: 'Adicionar outra meta', exact: true }).click();
    await fillGoal(page, 2, 'TESTE_PRESSAO', '50', 'WEEK_TOTAL');
    await expect(dialog).toHaveScreenshot(`weekly-target-dialog-${viewport.name}.png`);
    await page.getByRole('button', { name: 'Salvar meta', exact: true }).click();
    await expect(dialog).toBeHidden();
    await showCurrent(page);
    await expect(spotlightFor(page)).toHaveScreenshot(`weekly-target-spotlight-${viewport.name}.png`);
  });
}
