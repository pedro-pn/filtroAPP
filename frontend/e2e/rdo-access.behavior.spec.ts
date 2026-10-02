import { expect, test } from '@playwright/test';

import {
  demoCredentials,
  expectLegacyRdoShell,
  loginAs,
  logoutFromRdo
} from './support/rdo';

test.describe('RDO A.1 — acesso do colaborador', () => {
  test('exibe o tutorial real do Hub no primeiro acesso sem avançar ou concluir', async ({
    page
  }) => {
    await loginAs(page, demoCredentials.collaborator);

    await expect(page).toHaveURL(/\/modulos(?:[?#].*)?$/);
    await expect(page.locator('[data-testid="fv-app-shell"]')).toBeVisible();

    const tutorial = page.locator('.driver-popover');
    await expect(tutorial).toBeVisible({ timeout: 10_000 });
    await expect(tutorial).toContainText('Seus módulos');
    const nextStep = tutorial.getByRole('button', { name: /Próximo/i });
    await expect(nextStep).toBeVisible();
    await nextStep.click();
    await expect(tutorial).not.toContainText('Seus módulos');
    await expect(
      tutorial.locator('.driver-popover-progress-text')
    ).toContainText(/^2 de /);

    // O contexto termina no segundo passo: o teste não conclui o tutorial.
  });

  test('percorre Home, relatórios, arquivados e serviços em andamento sem mutar dados', async ({
    page
  }) => {
    await loginAs(page, demoCredentials.collaborator);
    await page.goto('/rdo/home');

    await expectLegacyRdoShell(page);
    await expect(page.locator('.home-greeting')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Meus relatórios/i })
    ).toBeEnabled();

    const ongoingAction = page.getByRole('button', {
      name: /Em andamento/i
    });
    await expect(ongoingAction).toBeDisabled();

    await page.getByRole('button', { name: /Meus relatórios/i }).click();
    await expect(page).toHaveURL(/\/rdo\/meus-relatorios(?:[?#].*)?$/);
    await expectLegacyRdoShell(page);
    await expect(page.locator('.topbar-title')).toHaveText('Meus relatórios');
    await expect(
      page.getByText('Nenhum relatório pendente encontrado.', { exact: true })
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Aprovados' }).click();
    await expect(page).toHaveURL(/\/rdo\/meus-relatorios\?tab=approved$/);
    await expect(page.getByRole('tab', { name: 'Aprovados' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(
      page.getByText('Nenhum relatório aprovado encontrado.', { exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Início', exact: true }).click();
    await expect(page).toHaveURL('/rdo/home');

    await page.getByRole('button', { name: /Arquivados/ }).click();
    await expect(page).toHaveURL('/rdo/meus-relatorios/arquivados');
    await expectLegacyRdoShell(page);
    await expect(page.locator('.topbar-title')).toHaveText('Arquivados');
    await expect(
      page.getByText('Nenhum relatório arquivado.', { exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(page).toHaveURL('/rdo/home');

    // Sem serviços reais, a ação da Home permanece desabilitada. A rota ainda
    // é exercitada diretamente para caracterizar seu estado vazio read-only.
    await page.goto('/rdo/andamento');
    await expectLegacyRdoShell(page);
    await expect(page.locator('.topbar-title')).toHaveText(
      'Serviços em andamento'
    );
    await expect(
      page.getByText('Nenhum serviço em andamento.', { exact: true })
    ).toBeVisible();
  });

  test('abre o formulário inicial sem preenchê-lo e encerra a sessão pela Home', async ({
    page
  }) => {
    await loginAs(page, demoCredentials.collaborator);
    await page.goto('/rdo/home');

    await page.getByRole('button', { name: /Novo relatório/i }).click();
    await expect(page).toHaveURL('/rdo/relatorio/novo');
    await expect(page.locator('[data-testid="fv-app-shell"]')).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveCount(0);
    await expect(page.locator('.fv-topbar')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Novo relatório', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Etapa 1 de 3 · Cabeçalho')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Cabeçalho' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(
      page.getByText('Identificação', { exact: true })
    ).toBeVisible();

    // Não usa Cancelar/Voltar: esse caminho pode disparar o salvamento de
    // rascunho. Retornar por navegação não executa nenhuma operação mutável.
    await page.goto('/rdo/home');
    await expectLegacyRdoShell(page);
    await logoutFromRdo(page);
    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });
});

test.describe('RDO A.1 — barreira de consentimento do cliente', () => {
  test('redireciona ao RDO, impede continuar sem aceite e permite logout', async ({
    page
  }) => {
    await loginAs(page, demoCredentials.client);

    await expect(page).toHaveURL(/\/rdo\/cliente(?:[?#].*)?$/);
    await expect(
      page.getByRole('heading', { name: 'Antes de continuar' })
    ).toBeVisible();

    const consent = page.getByRole('checkbox', {
      name: /Li e aceito o termo de privacidade/i
    });
    const acceptButton = page.getByRole('button', {
      name: 'Aceitar e continuar'
    });

    await expect(consent).not.toBeChecked();
    await expect(acceptButton).toBeDisabled();

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Antes de continuar' })
    ).toBeVisible();
    await expect(consent).not.toBeChecked();
    await expect(acceptButton).toBeDisabled();

    await page.goto('/modulos');
    await expect(page).toHaveURL('/modulos');
    await expect(
      page.getByRole('heading', { name: 'Antes de continuar' })
    ).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveCount(0);

    // Não marca o checkbox e não chama o endpoint de aceite.
    await logoutFromRdo(page);
    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });
});
