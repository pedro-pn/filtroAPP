import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const token = 'project-signature-test';
const project = { code: '5800', name: 'Projeto de teste', clientName: 'Cliente Teste' };

async function installPublicApi(page: Page, { partialFailure = false, single = false, lostResponse = false } = {}) {
  const pdf = await readFile(new URL('../src/assets/previews/rdo-assinatura-exemplo.pdf', import.meta.url));
  const reports = [42, 43, 44].slice(0, single ? 1 : 3).map(number => ({
    signatureId: `signature-${number}`, status: 'ACTIVE', expiresAt: '2030-12-31T23:59:59Z',
    signer: { name: 'Marina Costa', email: 'marina@example.com', prefillName: true, status: 'PENDING' },
    report: { id: `report-${number}`, reportType: 'RDO', sequenceNumber: number, reportDate: '2026-10-20', status: 'APPROVED', sourceDocumentHash: 'a'.repeat(64), project }
  }));
  const requests: Array<{ path: string; payload: Record<string, unknown> }> = [];
  await page.route(`**/api/reports/public-sign/${token}**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/pdf')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
    if (route.request().method() === 'GET') {
      const anchor = reports[0];
      const items = reports.filter(item => item === anchor || item.status === 'ACTIVE');
      return route.fulfill({ json: {
        status: anchor.status, expiresAt: anchor.expiresAt,
        signer: { ...anchor.signer, signatureId: anchor.signatureId }, report: anchor.report,
        ...(items.length > 1 ? { batch: { project, pendingCount: items.filter(item => item.status === 'ACTIVE').length, reports: items } } : {})
      } });
    }
    const payload = route.request().postDataJSON();
    requests.push({ path: url.pathname, payload });
    if (url.pathname.endsWith('/confirm-batch')) {
      const results = (payload.signatureIds as string[]).map(signatureId => {
        const item = reports.find(report => report.signatureId === signatureId)!;
        const success = !(partialFailure && signatureId === 'signature-43');
        if (success) item.status = 'SIGNED';
        return { signatureId, success, completed: success, ...(success ? {} : { error: 'Documento atualizado. Confira novamente.' }) };
      });
      if (lostResponse) return route.abort('failed');
      return route.fulfill({ json: { results } });
    }
    if (url.pathname.endsWith('/confirm')) {
      const item = reports.find(report => report.signatureId === payload.signatureId)!;
      item.status = 'SIGNED';
      return route.fulfill({ json: { success: true, completed: true, report: item.report } });
    }
    if (url.pathname.endsWith('/reject')) {
      reports.find(report => report.signatureId === payload.signatureId)!.status = 'REJECTED';
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected test route' } });
  });
  return { requests, reports };
}

async function confirmDrawing(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome e sobrenome do signatário').fill('Marina Costa');
  const canvas = dialog.getByLabel('Área para desenhar assinatura');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 35, { steps: 6 });
  await page.mouse.move(box.x + 140, box.y + 85, { steps: 6 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Confirmar assinatura', exact: true }).click();
}
const acceptPrivacy = (page: Page) => page.getByRole('checkbox', { name: 'Li e estou ciente do tratamento dos meus dados para assinatura eletrônica.' }).check();

test('public link switches previews and signs only the viewed RDO', async ({ page }) => {
  const { requests, reports } = await installPublicApi(page);
  await page.goto(`/assinar/${token}`);
  await expect(page.getByText('3 pendentes para você assinar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assinar todos (3)' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Relatórios do projeto' }).getByRole('button', { name: /RDO 43/ }).click();
  await expect(page.getByRole('region', { name: 'Documento RDO 43', exact: true })).toBeVisible();
  await expect(page.locator('.public-report-document__paper img').first()).toBeVisible();
  await acceptPrivacy(page);
  await page.getByRole('button', { name: 'Assinar RDO 43', exact: true }).click();
  await confirmDrawing(page);
  await expect(page.getByText('1 RDO com assinatura registrada')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].path).toMatch(/\/confirm$/);
  expect(requests[0].payload.signatureId).toBe('signature-43');
  expect(reports.map(item => item.status)).toEqual(['ACTIVE', 'SIGNED', 'ACTIVE']);
});

test('public batch confirms the exact listed documents in one request', async ({ page }) => {
  const { requests, reports } = await installPublicApi(page);
  await page.goto(`/assinar/${token}`);
  await acceptPrivacy(page);
  await page.getByRole('button', { name: 'Assinar todos (3)' }).click();
  await expect(page.getByRole('dialog').getByText('Assinar 3 RDOs juntos', { exact: true })).toBeVisible();
  await expect(page.locator('.public-signature-batch-confirmation li')).toHaveCount(3);
  await confirmDrawing(page);
  await expect(page.getByText('3 RDOs com assinatura registrada')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].path).toMatch(/\/confirm-batch$/);
  expect(requests[0].payload.signatureIds).toEqual(['signature-42', 'signature-43', 'signature-44']);
  expect(requests[0].payload.privacyNoticeAccepted).toBe(true);
  expect(requests[0].payload.signatureImageDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(reports.every(item => item.status === 'SIGNED')).toBe(true);
});

test('public batch explains partial failure and retries only the remaining RDO', async ({ page }) => {
  const { requests } = await installPublicApi(page, { partialFailure: true });
  await page.goto(`/assinar/${token}`);
  await acceptPrivacy(page);
  await page.getByRole('button', { name: 'Assinar todos (3)' }).click();
  await confirmDrawing(page);
  await expect(page.getByText('2 RDOs com assinatura registrada')).toBeVisible();
  await expect(page.getByText('RDO 43: Documento atualizado. Confira novamente.')).toBeVisible();
  await page.getByRole('button', { name: 'Assinar RDO 43', exact: true }).click();
  await confirmDrawing(page);
  await expect(page.getByText('1 RDO com assinatura registrada')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].payload.signatureId).toBe('signature-43');
});

test('single-report public link retains individual signature', async ({ page }) => {
  await installPublicApi(page, { single: true });
  await page.goto(`/assinar/${token}`);
  await expect(page.locator('.public-signature-pending')).toHaveCount(0);
  await acceptPrivacy(page);
  await page.getByRole('button', { name: 'Assinar RDO 42', exact: true }).click();
  await confirmDrawing(page);
  await expect(page.getByText('1 RDO com assinatura registrada')).toBeVisible();
});

test('lost batch response refreshes recorded signatures before allowing another attempt', async ({ page }) => {
  const { requests, reports } = await installPublicApi(page, { lostResponse: true });
  await page.goto(`/assinar/${token}`);
  await acceptPrivacy(page);
  await page.getByRole('button', { name: 'Assinar todos (3)' }).click();
  await confirmDrawing(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Não foi possível confirmar todas as assinaturas')).toBeVisible();
  await expect(page.locator('.rdo-public-status')).toHaveText('Assinatura já registrada');
  await expect(page.getByRole('button', { name: /Assinar todos/ })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(reports.every(item => item.status === 'SIGNED')).toBe(true);
});

test('example link previews distinct RDOs and simulates signing on mobile without API writes', async ({ page }) => {
  const publicRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/reports/public-sign/')) publicRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/assinar/exemplo?visualizar=1');
  await page.getByRole('navigation', { name: 'Relatórios do projeto' }).getByRole('button', { name: /RDO 43/ }).click();
  await expect(page.getByRole('link', { name: 'Abrir PDF', exact: true })).toHaveAttribute('href', /-43\.pdf/);
  await acceptPrivacy(page);
  await page.getByRole('button', { name: 'Assinar todos (4)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByText('4 pendentes para você assinar')).toBeVisible();
  await page.getByRole('button', { name: 'Assinar todos (4)' }).click();
  await confirmDrawing(page);
  await expect(page.getByText('4 RDOs com assinatura registrada')).toBeVisible();
  expect(publicRequests).toEqual([]);
});

test('public signature fits mobile and desktop in both themes', async ({ page }) => {
  await installPublicApi(page);
  for (const theme of ['light', 'dark']) {
    await page.addInitScript(value => localStorage.setItem('filtrovali-theme', value), theme);
    await page.goto(`/assinar/${token}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByText('3 pendentes para você assinar')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const button = page.getByRole('button', { name: 'Assinar todos (3)' });
      expect(await button.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
});
