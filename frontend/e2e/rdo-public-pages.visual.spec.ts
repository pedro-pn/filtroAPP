import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 900 }
] as const;

const themes = ['light', 'dark'] as const;

const validationPayload = {
  status: 'VALID',
  validationCode: 'FV-RDO-VISUAL',
  sourceDocumentHash: 'a'.repeat(64),
  finalDocumentHash: 'b'.repeat(64),
  finalPdfCreatedAt: '2026-09-04T12:00:00.000Z',
  report: {
    id: 'visual-report',
    reportType: 'RDO',
    sequenceNumber: 42,
    reportDate: '2026-09-04',
    status: 'SIGNED',
    project: {
      code: 'FV-2026',
      name: 'Projeto de validação visual',
      clientName: 'Cliente demonstração'
    }
  },
  completedAt: '2026-09-04T12:00:00.000Z',
  signers: [{
    name: 'Cliente demonstração',
    email: 'cliente@example.com',
    role: 'CLIENT',
    status: 'SIGNED',
    signedAt: '2026-09-04T12:00:00.000Z'
  }]
};

const publicSignaturePayload = {
  status: 'ACTIVE',
  expiresAt: '2026-09-11T12:00:00.000Z',
  signer: {
    signatureId: 'visual-signature',
    name: 'Cliente demonstração',
    prefillName: true,
    email: 'cliente@example.com',
    status: 'PENDING'
  },
  report: {
    id: 'visual-report',
    reportType: 'RDO',
    sequenceNumber: 42,
    reportDate: '2026-09-04',
    status: 'APPROVED',
    sourceDocumentHash: 'a'.repeat(64),
    project: {
      code: 'FV-2026',
      name: 'Projeto de validação visual',
      clientName: 'Cliente demonstração'
    }
  }
};

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'a página não deve criar rolagem horizontal').toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  for (const theme of themes) {
    test(`validação pública · ${viewport.name} · ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem('filtrovali-theme', selectedTheme);
      }, theme);
      await page.route('**/api/reports/validate-signature/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(validationPayload)
      }));

      await page.goto('/validar-assinatura/FV-RDO-VISUAL');
      await expect(page.getByText('Documento válido', { exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.rdo-public-shell')).toBeVisible();

      await expectNoHorizontalOverflow(page);

      await expect(page).toHaveScreenshot(`${viewport.name}-${theme}.png`, {
        fullPage: true
      });

      await page.route('**/api/reports/public-sign/**', route => {
        if (route.request().method() === 'GET' && !route.request().url().includes('/pdf')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(publicSignaturePayload)
          });
        }
        return route.abort();
      });
      await page.goto('/assinar/FV-RDO-VISUAL');
      await expect(page.getByText('Disponível para assinatura', { exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.public-signature-page')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await expect(page).toHaveScreenshot(`${viewport.name}-${theme}-signature.png`, {
        fullPage: true
      });
    });
  }
}
