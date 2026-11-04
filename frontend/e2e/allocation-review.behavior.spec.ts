import { expect, test } from '@playwright/test';

import { WEEK, expectNoHorizontalOverflow, mockApi } from './support/allocationReview';

// Conferência semanal de alocação (feature 037). API simulada: nenhuma chamada sai do navegador.

test('quem só confere alocação abre direto a Conferência e não chama APIs do resto do Efetivo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { unexpected } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto('/efetivo');
  await expect(page.getByRole('heading', { name: 'Conferência', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Alocação da semana por colaborador' })).toBeVisible();
  await expect(page.locator('.allocation-review-week__label')).toContainText('26/10 a 01/11/2026');
  await expect(page.getByRole('button', { name: 'Ver tutorial' })).toHaveCount(0);
  expect(unexpected.filter(item => item.includes('/efetivo') || item.includes('/workforce'))).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/desktop-grid.png', fullPage: true });
});

test('corrigir um dia divergente envia a versão atual e a escolha', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { writes } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('button', { name: /Bruno Cavalcanti, 28\/10: .*pendente/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Bruno Cavalcanti' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('As fontes não batem')).toBeVisible();
  await expect(dialog.getByText('etiqueta “5484”')).toBeVisible();
  await page.screenshot({ path: '../output/playwright/allocation-review/desktop-panel.png' });
  await dialog.getByRole('radio', { name: /5484 · Missão 5484/ }).check();
  await dialog.getByText('Qui 29/10').click();
  await dialog.getByRole('button', { name: 'Confirmar escolha' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ method: 'PUT', path: `/api/efetivo/conferencia-alocacao/semanas/${WEEK}/dias`, version: '2' });
  expect((writes[0].body as { items: unknown[] }).items).toEqual([
    { collaboratorId: 'c-bruno', date: '2026-10-28', kind: 'PROJECT', projectIds: ['p5484'], note: null },
    { collaboratorId: 'c-bruno', date: '2026-10-29', kind: 'PROJECT', projectIds: ['p5484'], note: null }
  ]);
});

test('"Outro projeto" sem projeto marca o campo em vermelho', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { writes } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('button', { name: /Caio Menezes, 29\/10: Sem informação/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Caio Menezes' });
  await dialog.getByRole('radio', { name: 'Outro projeto…', exact: true }).check();
  await dialog.getByRole('button', { name: 'Confirmar escolha' }).click();
  await expect(dialog.locator('.field-invalid')).toBeVisible();
  await expect(dialog.getByText('Escolha o projeto.')).toBeVisible();
  expect(writes).toEqual([]);
});

test('seleção múltipla e conferir linhas sem pendência', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { writes } = await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('button', { name: /Ana Teixeira, 26\/10/ }).first().click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: /Ana Teixeira, 27\/10/ }).first().click({ modifiers: ['Shift'] });
  await expect(page.getByRole('region', { name: 'Ações para os dias selecionados' })).toContainText('2 dias selecionados');
  await page.getByRole('region', { name: 'Ações para os dias selecionados' }).getByRole('button', { name: 'Sede' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0].body as { items: Array<{ kind: string }> }).items.map(item => item.kind)).toEqual(['SEDE', 'SEDE']);
  await page.getByRole('button', { name: 'Conferir linhas sem pendência (1)' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ path: `/api/efetivo/conferencia-alocacao/semanas/${WEEK}/linhas/conferir`, body: { allReady: true } });
});

test('no celular a grade vira cards, sem rolagem horizontal da página', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await expect(page.locator('.allocation-review-card').first()).toBeVisible();
  await expect(page.locator('.allocation-review-table-wrap')).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/mobile-cards.png', fullPage: true });
  await page.getByRole('button', { name: 'Selecionar dias' }).click();
  await page.locator('.allocation-review-card').first().getByRole('button', { name: /26\/10/ }).click();
  await expect(page.getByRole('region', { name: 'Ações para os dias selecionados' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Concluir seleção' }).click();
  await page.locator('.allocation-review-card').nth(1).getByRole('button', { name: /28\/10/ }).click();
  await expect(page.getByRole('dialog', { name: 'Bruno Cavalcanti' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/mobile-panel.png' });
});

test('"Por nome" é o padrão e vem antes de "Por projeto"', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  const group = page.getByRole('group', { name: 'Agrupar' }).getByRole('button');
  await expect(group.nth(0)).toHaveText('Por nome');
  await expect(group.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(group.nth(1)).toHaveText('Por projeto');
  await expect(page.locator('.allocation-review-table__group')).toHaveCount(0);
  await group.nth(1).click();
  await expect(page).toHaveURL(/agrupar=proj/);
  await expect(page.locator('.allocation-review-table__group').first()).toBeVisible();
});

test('o cabeçalho dos dias fica fixo ao rolar a tabela para baixo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 700 });
  await mockApi(page, ['efetivo:allocation-review'], { weekCopies: 6 });
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  const wrap = page.locator('.allocation-review-table-wrap');
  await wrap.scrollIntoViewIfNeeded();
  const scrolled = await wrap.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
  expect(scrolled).toBeGreaterThan(0);
  const offset = await page.evaluate(() => {
    const container = document.querySelector('.allocation-review-table-wrap')!.getBoundingClientRect();
    const header = document.querySelector('.allocation-review-table thead th:nth-child(2)')!.getBoundingClientRect();
    return Math.round(header.top - container.top);
  });
  expect(Math.abs(offset)).toBeLessThanOrEqual(2);
  await expect(page.locator('.allocation-review-table thead th').nth(1)).toBeInViewport();
});

test('visão do mês mostra o mês inteiro e abre a semana ao clicar num dia', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.getByRole('group', { name: 'Visão' }).getByRole('button', { name: 'Mês' }).click();
  await expect(page).toHaveURL(/visao=mes/);
  const table = page.getByRole('table', { name: 'Alocação do mês por colaborador' });
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(33);
  await expect(page.getByRole('list', { name: 'Semanas do mês' }).getByRole('button')).toHaveCount(5);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/desktop-month.png', fullPage: true });
  await table.getByRole('button', { name: /Bruno Cavalcanti, 28\/10/ }).click();
  await expect(page).toHaveURL(/semana=2026-10-26/);
  await expect(page).not.toHaveURL(/visao=mes/);
  await expect(page.getByRole('table', { name: 'Alocação da semana por colaborador' })).toBeVisible();
});

test('visão do mês no celular vira calendário por colaborador', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&visao=mes&mes=2026-10`);
  await expect(page.locator('.allocation-review-month-calendar').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: '../output/playwright/allocation-review/mobile-month.png', fullPage: true });
});

test('a grade é uma parada de Tab só e as setas andam entre os dias', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  const table = page.getByRole('table', { name: 'Alocação da semana por colaborador' });
  await expect(table.locator('[data-grid-cell][tabindex="0"]')).toHaveCount(1);
  await table.getByRole('button', { name: /Ana Teixeira, 26\/10/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(table.getByRole('button', { name: /Ana Teixeira, 27\/10/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(table.getByRole('button', { name: /Bruno Cavalcanti, 27\/10/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(table.getByRole('button', { name: /Bruno Cavalcanti, 01\/11/ })).toBeFocused();
  await expect(table.locator('[data-grid-cell][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Bruno Cavalcanti' })).toBeVisible();
});

test('clicar nas pendências do resumo filtra a grade', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockApi(page, ['efetivo:allocation-review']);
  await page.goto(`/efetivo?section=conferencia&semana=${WEEK}`);
  await page.locator('[data-allocation-review-summary]').getByRole('button', { name: /1 divergência/ }).click();
  await expect(page).toHaveURL(/mostrar=pend/);
  await expect(page.getByRole('table', { name: 'Alocação da semana por colaborador' }).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText('Para fechar: Faltam 3 colaboradores para conferir.')).toBeVisible();
});
