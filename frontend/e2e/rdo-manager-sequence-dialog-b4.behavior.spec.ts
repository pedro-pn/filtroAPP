import { expect, test, type Locator, type Page } from '@playwright/test';

import { demoCredentials, expectManagerRdoShell, loginAs } from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';
const REPORT_LIST_TIMEOUT = 20_000;

type DialogAppearance = 'legacy' | 'design-system';

async function openManagerRdo(page: Page) {
  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_HOME);

  await expect(page).toHaveURL(/\/rdo\/gestor(?:\?.*)?$/);
  await expectManagerRdoShell(page);
  await expect
    .poll(() => page.locator('.rel-item').count(), {
      message: 'a listagem real deve conter um relatório elegível',
      timeout: REPORT_LIST_TIMEOUT
    })
    .toBeGreaterThan(0);
}

async function eligibleSequenceLauncher(page: Page) {
  const launcher = page
    .getByRole('button', { name: 'Nº', exact: true })
    .filter({ visible: true })
    .first();

  await expect(launcher).toBeVisible({ timeout: REPORT_LIST_TIMEOUT });
  await expect(launcher).toBeEnabled();
  return launcher;
}

async function reportLabelFor(launcher: Locator) {
  const report = launcher.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " rel-item ")][1]'
  );
  await expect(report).toBeVisible();

  return (await report.locator('.rel-name').first().innerText())
    .split('·')[0]
    .trim();
}

function expectedSequenceValue(reportLabel: string) {
  return reportLabel.match(/(?:^|\s)(\d+)$/)?.[1] ?? '';
}

async function activeManagerTab(page: Page) {
  const selected = page.locator(
    '.fv-sidebar .fv-navigation-subitem[aria-current="page"]'
  );
  await expect(selected).toHaveCount(1);
  return selected;
}

async function activeManagerTabIndex(page: Page) {
  const tabs = page.locator('.fv-sidebar .fv-navigation-subitem');
  const selectedIndexes = await tabs.evaluateAll((elements) =>
    elements.flatMap((element, index) =>
      element.getAttribute('aria-current') === 'page' ? [index] : []
    )
  );
  expect(selectedIndexes).toHaveLength(1);
  return selectedIndexes[0];
}

async function expectDialogAppearance(
  dialog: Locator
): Promise<DialogAppearance> {
  const state = await dialog.evaluate((element) => ({
    designSystem: element.classList.contains('fv-modal'),
    legacy: element.classList.contains('modal-card')
  }));

  expect(state, 'o diálogo deve ter exatamente uma aparência').toEqual(
    state.designSystem
      ? { designSystem: true, legacy: false }
      : { designSystem: false, legacy: true }
  );

  const closeButton = dialog.getByRole('button', {
    name: 'Fechar',
    exact: true
  });

  if (state.designSystem) {
    await expect(closeButton).toHaveCount(1);
    return 'design-system';
  }

  await expect(closeButton).toHaveCount(0);
  return 'legacy';
}

test('B.4 caracteriza o diálogo de numeração sem executar mutações', async ({
  page
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openManagerRdo(page);

  const launcher = await eligibleSequenceLauncher(page);
  const reportLabel = await reportLabelFor(launcher);
  const initialValue = expectedSequenceValue(reportLabel);
  const initialUrl = page.url();
  const initialTabIndex = await activeManagerTabIndex(page);
  const mutationAttempts: string[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (method !== 'GET') {
      mutationAttempts.push(`${method} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const dialog = page.getByRole('dialog', { name: 'Alterar numeração' });

  async function expectListingStatePreserved() {
    await expect(page).toHaveURL(initialUrl);
    await activeManagerTab(page);
    await expect(
      page.locator('.fv-sidebar .fv-navigation-subitem').nth(initialTabIndex)
    ).toHaveAttribute('aria-current', 'page');
    expect(mutationAttempts).toEqual([]);
  }

  async function openAndCharacterizeDialog() {
    await launcher.click();
    await expect(dialog).toBeVisible();

    const appearance = await expectDialogAppearance(dialog);
    const description = `Informe o novo número para ${reportLabel}.`;
    await expect(dialog.getByText(description, { exact: true })).toBeVisible();

    const input = dialog.getByRole('spinbutton', { name: 'Novo número' });
    await expect(input).toHaveValue(initialValue);
    await expect(input).toHaveAttribute('min', '1');
    await expect(input).toHaveAttribute('step', '1');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('required', '');
    await expect(input).toBeFocused();
    await expectListingStatePreserved();
    return appearance;
  }

  await test.step('contrato visual e fechamento por Cancelar', async () => {
    await openAndCharacterizeDialog();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await expectListingStatePreserved();
  });

  await test.step('fechamento por Escape', async () => {
    await openAndCharacterizeDialog();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await expectListingStatePreserved();
  });

  await test.step('contrato estrito do botão Fechar por aparência', async () => {
    const appearance = await openAndCharacterizeDialog();

    if (appearance === 'legacy') {
      await expect(
        dialog.getByRole('button', { name: 'Fechar', exact: true })
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
    } else {
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    }

    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await expectListingStatePreserved();
  });

  await test.step('diálogo compacto no mobile', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openAndCharacterizeDialog();
    await expect(dialog).not.toHaveClass(/fv-modal--mobile-fullscreen/);

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThan(0);
    expect(box?.y).toBeGreaterThan(0);
    expect(box?.width).toBeLessThan(375);
    expect(box?.height).toBeLessThan(812);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await expectListingStatePreserved();
  });

  expect(mutationAttempts).toEqual([]);
});
