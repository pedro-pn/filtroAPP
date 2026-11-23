import fs from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { loginThroughUi, skipOnboarding } from './support/login';
import { clearMailbox } from './support/mailbox';
import { e2eSeed } from './support/seed';

async function pdfSummary(buffer: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ');
  return { pages: document.numPages, text };
}

// Jornada 2 (spec 040): gestor cria um RDO pela tela, a API real grava no
// PostgreSQL e o PDF gerado pelo backend é baixado e conferido.
test('gestor cria RDO do rascunho ao envio e baixa um PDF válido do relatório', async ({ page }) => {
  const seed = e2eSeed();
  const { admin } = seed.accounts;
  await clearMailbox();
  await skipOnboarding(page, admin.username);
  await loginThroughUi(page, admin);

  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await page.locator('#rdo-project').selectOption(seed.projects.a.id);
  await page.locator('#rdo-date').fill('2026-11-17');
  await page.locator('#rdo-arrival').fill('08:00');
  await page.locator('#rdo-departure').fill('17:00');
  await page.locator('#rdo-lunch').fill('01:00:00');
  await page.getByRole('combobox', { name: 'Adicionar colaborador', exact: true }).selectOption({ label: seed.collaborators.ana.name });

  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  // A etapa Serviços abre o seletor sozinha; RDO sem serviço segue direto para a Finalização.
  await page.getByRole('dialog').getByRole('button', { name: 'Não houve serviço hoje', exact: true }).click();
  await expect(page.getByText('Etapa 3 de 3 · Finalização')).toBeVisible();

  const created = page.waitForResponse(response =>
    response.request().method() === 'POST' && /\/api\/(rdo\/)?reports$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBeLessThan(300);
  const report = await response.json();
  expect(report).toMatchObject({ projectId: seed.projects.a.id, reportType: 'RDO', status: 'APPROVED' });
  expect(report.sequenceNumber).toBeGreaterThan(0);
  await expect(page).not.toHaveURL(/\/relatorio\/novo/);

  await page.goto(`/rdo/gestor/relatorio/${report.id}`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  const download = await downloadPromise;
  const buffer = await fs.readFile(await download.path());
  expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const pdf = await pdfSummary(buffer);
  expect(pdf.pages).toBeGreaterThanOrEqual(1);
  expect(pdf.text).toContain(seed.projects.a.name);
});
