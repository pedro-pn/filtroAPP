import { expect, test } from '@playwright/test';

const fixture = '/test/browser/report-recipients.html';

test('exige e-mail principal válido antes de salvar destinatários', async ({ page }) => {
  await page.goto(`${fixture}?empty=1`);
  const primary = page.getByRole('textbox', { name: 'E-mail principal do cliente' });
  const save = page.getByRole('button', { name: 'Salvar destinatários' });
  await expect(primary).toHaveAttribute('required', '');
  await save.click();
  await expect(page.locator('[data-test-writes]')).toHaveText('[]');
  await primary.fill('email-invalido');
  await save.click();
  await expect(page.locator('[data-test-writes]')).toHaveText('[]');
  await primary.fill('cliente@example.com');
  await save.click();
  await expect.poll(async () => JSON.parse(await page.locator('[data-test-writes]').innerText()).length).toBe(1);
});

test('salva cópias e exige nome e sobrenome de quem vai assinar', async ({ page }) => {
  await page.goto(`${fixture}?empty=1`);
  await page.getByRole('textbox', { name: 'E-mail principal do cliente' }).fill('Principal@Example.com');
  const copies = page.getByRole('textbox', { name: 'E-mails em cópia' });
  await copies.fill('ana@example.com; leitor@example.com; ANA@example.com');
  await copies.press('Enter');
  const signerRow = page.locator('.cc-row').filter({ hasText: 'ana@example.com' });
  await signerRow.locator('label.tog').click();
  await page.getByRole('button', { name: 'Salvar destinatários' }).click();
  await expect(page.locator('[data-test-writes]')).toHaveText('[]');
  await signerRow.getByRole('textbox', { name: 'Nome', exact: true }).fill('Ana');
  await page.getByRole('button', { name: 'Salvar destinatários' }).click();
  await expect(page.locator('[data-test-writes]')).toHaveText('[]');
  await signerRow.getByRole('textbox', { name: 'Sobrenome', exact: true }).fill('Silva');
  await page.getByRole('button', { name: 'Salvar destinatários' }).click();
  await expect.poll(async () => JSON.parse(await page.locator('[data-test-writes]').innerText())).toMatchObject([{
    action: 'report_recipients',
    clientEmailPrimary: 'principal@example.com',
    clientEmailCc: ['ana@example.com', 'leitor@example.com'],
    clientSigners: [{ email: 'ana@example.com', firstName: 'Ana', lastName: 'Silva' }]
  }]);
  await expect(page.locator('summary')).toContainText('Cadastrados');
  await page.locator('summary').click();
  await expect(page.getByRole('textbox', { name: 'E-mail principal do cliente' })).toHaveValue('principal@example.com');
  await expect(page.getByRole('checkbox', { name: 'Assinante: ana@example.com' })).toBeChecked();
});

test('preserva a seleção dos relatórios de serviço e desmarca assinante mantendo a cópia', async ({ page }) => {
  await page.goto(fixture);
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Salvar destinatários' }).click();
  await expect.poll(async () => JSON.parse(await page.locator('[data-test-writes]').innerText())[0]?.clientSigners[0]?.signsServiceReports).toBe(false);
  await page.locator('summary').click();
  await page.locator('.cc-row').filter({ hasText: 'ana@example.com' }).locator('label.tog').click();
  await page.getByRole('button', { name: 'Salvar destinatários' }).click();
  await expect.poll(async () => JSON.parse(await page.locator('[data-test-writes]').innerText())[1]).toMatchObject({
    clientEmailCc: ['ana@example.com', 'leitor@example.com'], clientSigners: []
  });
});

test('consulta somente leitura mantém o cadastro visível no celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixture}?readOnly=1`);
  await page.locator('summary').click();
  await expect(page.getByRole('textbox', { name: 'E-mail principal do cliente' })).toHaveValue('cliente@example.com');
  await expect(page.getByRole('textbox', { name: 'E-mail principal do cliente' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Assinante: ana@example.com' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Salvar destinatários' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
