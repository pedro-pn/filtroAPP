import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { useValidationAccount, validationFixture as f } from './redesign-audit-support';

const require = createRequire(import.meta.url);
const { Client } = require('../../backend/node_modules/pg');
const { PDFDocument } = require('../../backend/node_modules/pdf-lib');
async function sql(text: string, values: unknown[]) {
  const client = new Client({ connectionString: f.databaseUrl });
  await client.connect();
  try { return (await client.query(text, values)).rows; } finally { await client.end(); }
}
async function drop(page: Page, target: Locator, name: string, buffer: Buffer) {
  const transfer = await page.evaluateHandle(({ name, bytes }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    return transfer;
  }, { name, bytes: Array.from(buffer) });
  try { await target.dispatchEvent('drop', { dataTransfer: transfer }); } finally { await transfer.dispose(); }
}

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1280, height: 900 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`acabamentos: metadados, barras e preenchimento · ${viewport.name} · ${theme}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await useValidationAccount(page, 'admin', theme);
      await page.goto(`/efetivo?section=evolucao&projeto=${f.project.id}`);
      const metadata = page.locator('.project-workflow-meta');
      await expect(metadata).toBeVisible({ timeout: 30_000 });
      if (viewport.name === 'mobile') {
        const state = await metadata.evaluate(node => {
          const box = node.getBoundingClientRect();
          return { overflow: node.scrollWidth - node.clientWidth, outside: [...node.querySelectorAll('dt,dd')].filter(e => { const rect = e.getBoundingClientRect(); return rect.left < box.left - 1 || rect.right > box.right + 1; }).length };
        });
        expect(state).toEqual({ overflow: 0, outside: 0 });
        await expect(metadata.locator('dd')).toHaveCount(4);
      }
      await page.screenshot({ path: info.outputPath('planning.png') });
      await page.goto('/test/browser/redesign-chart.html');
      const bars = page.locator('.acp-detail-history-bar');
      await expect(bars).toHaveCount(6);
      await expect.poll(() => bars.first().evaluate(e => e.closest('svg')!.viewBox.baseVal.width)).not.toBe(280);
      const positions = await bars.evaluateAll(nodes => nodes.map(n => ({ x: Number(n.getAttribute('x')), width: Number(n.getAttribute('width')) })));
      for (let i = 0; i < positions.length - 1; i++) expect(positions[i].x + positions[i].width).toBeLessThan(positions[i + 1].x);
      await page.locator('.acp-detail-history-point').nth(2).focus();
      await expect(page.locator('.acp-detail-history-tip')).toContainText('02/09/2026');
      await expect(page.locator('.acp-detail-history-tip')).toContainText('20%');
      await page.screenshot({ path: info.outputPath('chart.png') });
      await page.goto('/visualizar/carregamento');
      const loader = page.getByRole('status', { name: 'Preenchimento rápido do carregamento' });
      const fill = loader.locator('.fv-brand-loading__progress-color');
      await page.getByRole('button', { name: 'Reproduzir preenchimento rápido' }).click();
      const duration = await fill.evaluate(e => getComputedStyle(e).animationDuration);
      expect(duration).toBe('0.36s');
      await expect.poll(() => fill.evaluate(e => getComputedStyle(e).getPropertyValue('--fv-brand-loading-fill').trim()), { timeout: 1000 }).toBe('100%');
      await page.waitForTimeout(500);
      await expect(fill).toHaveCSS('--fv-brand-loading-fill', '100%');
      await expect(loader).not.toHaveAttribute('aria-valuenow');
      await page.getByRole('slider', { name: /Progresso/ }).evaluate(element => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '33');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Reproduzir preenchimento rápido' }).click();
      await expect(fill).toHaveCSS('animation-name', 'none');
      await expect(fill).toHaveCSS('--fv-brand-loading-fill', '100%');
    });
  }
}

test('Planejamento: nomes longos cabem no cabeçalho em 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await useValidationAccount(page, 'admin', 'dark');
  await page.goto(`/efetivo?section=evolucao&projeto=${f.project.id}`);
  const metadata = page.locator('.project-workflow-meta');
  await expect(metadata).toBeVisible({ timeout: 30_000 });
  await metadata.locator('dd').evaluateAll(items => {
    for (const item of items.slice(0, 2)) {
      const text = [...item.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      if (text) text.textContent = 'Alexandre de Oliveira Albuquerque Fernandes';
    }
  });
  expect(await metadata.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  for (const value of await metadata.locator('dd').evaluateAll(items => items.map(item => item.scrollWidth - item.clientWidth))) expect(value).toBeLessThanOrEqual(1);
});

test('Efetivo: selecionar, arrastar, remover e gravar versões no banco isolado', async ({ page }, info) => {
  const title = `Documento acabamento ${info.project.name} ${Date.now()}`;
  const pdf = await PDFDocument.create(); pdf.addPage([200, 200]);
  const buffer = Buffer.from(await pdf.save());
  await useValidationAccount(page);
  await page.goto(`/efetivo?section=evolucao&projeto=${f.project.id}`);
  const category = page.locator('[data-project-documents]');
  await expect(category).toBeVisible({ timeout: 30_000 });
  if (await category.getAttribute('open') === null) await category.locator('summary').click();
  await category.getByRole('button', { name: 'Adicionar documento', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar documento', exact: true });
  await dialog.getByLabel(/^Título/).fill(title);
  await dialog.getByLabel('Tipo', { exact: false }).selectOption('OTHER');
  const fileInput = dialog.locator('input[type=file]');
  await expect(fileInput).toHaveAttribute('accept', '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.dwg,.dxf');
  await fileInput.setInputFiles({ name: 'inicial.pdf', mimeType: 'application/pdf', buffer });
  await expect(dialog.locator('.pdf-dropzone')).toContainText('inicial.pdf');
  await dialog.getByRole('button', { name: 'Remover arquivo selecionado' }).click();
  await expect(dialog.locator('.pdf-dropzone')).toContainText('Arraste o arquivo aqui');
  await fileInput.setInputFiles({ name: 'grande.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await dialog.getByRole('button', { name: 'Salvar documento', exact: true }).click();
  await expect(dialog.getByText('O arquivo deve ter no máximo 20 MB.')).toBeVisible();
  await drop(page, dialog.locator('.pdf-dropzone'), 'inicial.pdf', buffer);
  await dialog.getByLabel('Identificação da versão').fill('Rev. 01');
  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/documents'));
  await dialog.getByRole('button', { name: 'Salvar documento', exact: true }).click();
  const response = await created; expect(response.ok()).toBeTruthy();
  const document = (await response.json()).document;
  await expect(dialog).not.toBeVisible();
  expect(await sql('SELECT title FROM "ProjectDocument" WHERE id=$1', [document.id])).toEqual([{ title }]);
  const card = category.locator('.project-document-card').filter({ hasText: title });
  await card.getByRole('button', { name: 'Nova versão', exact: true }).click();
  const version = page.getByRole('dialog', { name: 'Nova versão', exact: true });
  await version.getByRole('button', { name: 'Adicionar versão', exact: true }).click();
  await expect(version.getByText('Selecione o arquivo da nova versão.')).toBeVisible();
  await drop(page, version.locator('.pdf-dropzone'), 'revisada.pdf', buffer);
  await version.getByLabel('Identificação da versão').fill('Rev. 02');
  const added = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`${document.id}/versions`));
  await version.getByRole('button', { name: 'Adicionar versão', exact: true }).click();
  expect((await added).ok()).toBeTruthy();
  await expect(version).not.toBeVisible();
  const rows = await sql('SELECT "originalFileName", "versionLabel", "fileSizeBytes" FROM "ProjectDocumentVersion" WHERE "documentId"=$1 ORDER BY sequence', [document.id]);
  expect(rows).toEqual([
    { originalFileName: 'inicial.pdf', versionLabel: 'Rev. 01', fileSizeBytes: buffer.length },
    { originalFileName: 'revisada.pdf', versionLabel: 'Rev. 02', fileSizeBytes: buffer.length }
  ]);
  await page.reload();
  const reloaded = page.locator('[data-project-documents]');
  await expect(reloaded).toBeVisible({ timeout: 30_000 });
  if (await reloaded.getAttribute('open') === null) await reloaded.locator('summary').click();
  await expect(reloaded.locator('.project-document-card').filter({ hasText: title })).toContainText('revisada.pdf');
});
