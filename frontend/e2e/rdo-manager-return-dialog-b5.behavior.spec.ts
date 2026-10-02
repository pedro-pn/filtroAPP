import { expect, test, type Locator, type Page } from '@playwright/test';

import { demoCredentials, expectManagerRdoShell, loginAs } from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';
const REPORT_LIST_TIMEOUT = 20_000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type DialogAppearance = 'legacy' | 'design-system';

const expectedAppearance: DialogAppearance = (() => {
  const value = process.env.RDO_B5_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(
    `RDO_B5_EXPECT_APPEARANCE inválido: ${value}. Use legacy ou design-system.`
  );
})();

type ListingState = {
  url: string;
  reportLabels: string[];
  checkedReportIndexes: number[];
};

async function visibleReturnLauncher(page: Page) {
  const launchers = page
    .getByRole('button', { name: 'Devolver', exact: true })
    .filter({ visible: true });

  await expect
    .poll(() => launchers.count(), {
      message:
        'a listagem real de Pendentes deve conter um relatório elegível para devolução',
      timeout: REPORT_LIST_TIMEOUT
    })
    .toBeGreaterThan(0);

  const launcher = launchers.first();
  await expect(launcher).toBeVisible();
  await expect(launcher).toBeEnabled();
  return launcher;
}

async function currentListingState(page: Page): Promise<ListingState> {
  const checkedReportIndexes = await page
    .locator('.rel-item .report-select-checkbox input[type="checkbox"]')
    .evaluateAll((elements) =>
      elements.flatMap((element, index) =>
        element instanceof HTMLInputElement && element.checked ? [index] : []
      )
    );

  return {
    url: page.url(),
    reportLabels: (
      await page.locator('.rel-item .rel-name').allTextContents()
    ).map((label) => label.trim()),
    checkedReportIndexes
  };
}

async function expectListingState(page: Page, expected: ListingState) {
  await expect(page).toHaveURL(expected.url);
  await expect(
    page.locator('.fv-sidebar').getByRole('link', { name: /^Pendentes/ })
  ).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => currentListingState(page)).toEqual(expected);
}

async function expectDialogAppearance(dialog: Locator) {
  const classes = await dialog.evaluate((element) => ({
    designSystem: element.classList.contains('fv-modal'),
    legacy: element.classList.contains('modal-card')
  }));

  expect(classes).toEqual(
    expectedAppearance === 'design-system'
      ? { designSystem: true, legacy: false }
      : { designSystem: false, legacy: true }
  );

  const closeButton = dialog.getByRole('button', {
    name: 'Fechar',
    exact: true
  });
  await expect(closeButton).toHaveCount(
    expectedAppearance === 'design-system' ? 1 : 0
  );
}

async function expectFocusTrap(dialog: Locator, textarea: Locator) {
  const focusable = dialog.locator(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable.first();
  const last = focusable.last();

  await last.focus();
  await pageFor(dialog).keyboard.press('Tab');
  await expect(first).toBeFocused();

  await first.focus();
  await pageFor(dialog).keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();

  await textarea.focus();
  await expect(textarea).toBeFocused();
}

function pageFor(locator: Locator) {
  return locator.page();
}

test('B.5 caracteriza o diálogo de devolução sem executar mutações', async ({
  page
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_HOME);
  await expect(page).toHaveURL(/\/rdo\/gestor(?:\?.*)?$/);
  await expectManagerRdoShell(page);
  await expect(
    page.locator('.fv-sidebar').getByRole('link', { name: /^Pendentes/ })
  ).toHaveAttribute('aria-current', 'page');

  const launcher = await visibleReturnLauncher(page);
  const listingState = await currentListingState(page);
  const mutationAttempts: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (MUTATING_METHODS.has(method)) {
      mutationAttempts.push(`${method} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const originalBodyOverflow = await page.evaluate(
    () => document.body.style.overflow
  );
  const dialog = page.getByRole('dialog', { name: 'Devolver relatório' });

  async function expectNoMutation() {
    expect(mutationAttempts, 'nenhuma mutation deve ser tentada').toEqual([]);
  }

  async function expectClosedAndPreserved() {
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(originalBodyOverflow);
    await expectListingState(page, listingState);
    await expectNoMutation();
  }

  async function openAndCharacterize() {
    await launcher.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expectDialogAppearance(dialog);

    await expect(
      dialog.getByText('Informe o motivo da devolução do relatório.', {
        exact: true
      })
    ).toBeVisible();

    const textarea = dialog.getByRole('textbox', { name: 'Motivo' });
    await expect(textarea).toHaveValue('');
    await expect(textarea).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe('hidden');

    const backdrop =
      expectedAppearance === 'design-system'
        ? page.locator('.fv-modal-backdrop[data-fv-ds]')
        : page.locator('.modal-backdrop');
    await expect(backdrop).toBeVisible();
    await expectFocusTrap(dialog, textarea);
    await expectListingState(page, listingState);
    await expectNoMutation();
    return textarea;
  }

  await test.step('validação vazia, whitespace e fechamento por Cancelar', async () => {
    const textarea = await openAndCharacterize();
    const confirm = dialog.getByRole('button', {
      name: 'Devolver',
      exact: true
    });
    const requiredMessage = dialog.getByText(
      'Informe um motivo para devolver o relatório.',
      { exact: true }
    );

    await confirm.click();
    await expect(requiredMessage).toBeVisible();
    await expectNoMutation();

    await textarea.fill('   ');
    await expect(requiredMessage).toHaveCount(0);
    await confirm.click();
    await expect(requiredMessage).toBeVisible();
    await expectNoMutation();

    await textarea.fill('Motivo usado somente para testar Cancelar');
    await expect(requiredMessage).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expectClosedAndPreserved();
  });

  await test.step('reset e fechamento por Escape', async () => {
    const textarea = await openAndCharacterize();
    await expect(textarea).toHaveValue('');
    await expect(
      dialog.getByText('Informe um motivo para devolver o relatório.', {
        exact: true
      })
    ).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expectClosedAndPreserved();
  });

  await test.step('contrato estrito do botão Fechar por aparência', async () => {
    await openAndCharacterize();

    if (expectedAppearance === 'design-system') {
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    } else {
      await expect(
        dialog.getByRole('button', { name: 'Fechar', exact: true })
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
    }

    await expectClosedAndPreserved();
  });

  await expectNoMutation();
});
