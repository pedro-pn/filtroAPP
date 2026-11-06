import { expect, test, type Page } from '@playwright/test';

async function mockCloseout(page: Page, { email = 'cliente@example.com', surveyFails = false, closeFails = false } = {}) {
  const project = {
    id: 'project-1', code: 'P-001', name: 'Projeto de teste', clientName: 'Cliente',
    clientEmailPrimary: email, location: 'Santos', workflow: null, permissions: { canInitialize: true }
  };
  const mission = {
    id: 'mission-1', projectId: project.id, project, version: 1, stage: 'FINAL_MEASUREMENT', kanbanOrder: 0,
    scheduleStatus: 'CONFIRMED', headquartersResponsibleUserId: 'manager',
    headquartersResponsibleName: 'Gestora', headquartersResponsibleRole: 'Líder',
    mobilizationDate: '2026-09-01', executionStartDate: '2026-09-02', executionEndDate: '2026-09-10',
    returnDate: null, participantCount: 1, demands: [{ jobRoleId: 'role-1', requiredCount: 1 }],
    allocations: [{ id: 'allocation-1', collaboratorId: 'collaborator-1', jobRoleId: 'role-1',
      collaborator: { id: 'collaborator-1', name: 'Ana', isActive: true }, jobRole: { name: 'Técnica' } }]
  };
  const state = { archived: false, sends: 0, closes: 0 };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('filtrovali-react-token', 'closeout-test');
    localStorage.setItem('filtrovali:efetivo-tutorial-done:v2:manager', '1');
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body: unknown = [];
    let status = 200;
    if (path === '/api/auth/me') body = { user: {
      id: 'manager', username: 'manager', name: 'Gestora', accountType: 'INTERNAL', role: 'COLLABORATOR',
      moduleRoles: ['efetivo:manager'], isActive: true
    } };
    else if (path === '/api/notifications') body = { items: [], criticalItems: [], unreadCount: 0, nextCursor: null };
    else if (path === '/api/efetivo/project-workflow') body = {
      items: [{ ...project, operationalMission: mission }], total: 1, page: 1, pageSize: 100
    };
    else if (path === '/api/efetivo/planning/missions') body = [mission];
    else if (path === '/api/efetivo/planning/missions/mission-1/stage') {
      state.closes += 1;
      expect(request.postDataJSON().stage).toBe('FINISHED');
      if (closeFails) { status = 409; body = { error: 'Encerramento bloqueado.' }; }
      else { mission.stage = 'FINISHED'; state.archived = true; body = mission; }
    } else if (path === '/api/rdo/surveys/project-1/send') {
      expect(state.archived).toBe(true);
      state.sends += 1;
      status = surveyFails ? 503 : 201;
      body = surveyFails ? { error: 'Falha ao enviar a pesquisa.' } : { survey: { id: 'survey-1' }, reused: false };
    }
    await route.fulfill({ status, json: body });
  });
  await page.goto('/efetivo?section=evolucao&faseProjeto=FINAL_MEASUREMENT');
  await page.locator('#project-stage-project-1').selectOption('FINISHED');
  await page.getByRole('button', { name: 'Encerrar projeto', exact: true }).click();
  return state;
}

test('encerramento oferece pesquisa e permite continuar sem enviar', async ({ page }) => {
  const state = await mockCloseout(page);
  await expect(page.getByText('Enviar pesquisa de satisfação?', { exact: true })).toBeVisible();
  await expect(page.getByText(/O projeto foi encerrado e arquivado em Relatórios/)).toBeVisible();
  await page.getByRole('button', { name: 'Continuar sem enviar' }).click();
  expect(state.archived).toBe(true);
  expect(state.sends).toBe(0);
  await expect(page.locator('[data-project-kanban-stage="FINISHED"] [data-project-id="project-1"]')).toBeVisible();
});

test('envia pesquisa somente após a escolha e mantém o encerramento após falha de envio', async ({ page }) => {
  const state = await mockCloseout(page, { surveyFails: true });
  await page.getByRole('button', { name: 'Enviar pesquisa', exact: true }).click();
  await expect(page.getByText('Falha ao enviar a pesquisa.', { exact: true })).toBeVisible();
  expect(state.archived).toBe(true);
  expect(state.closes).toBe(1);
  expect(state.sends).toBe(1);
  await expect(page.getByRole('button', { name: 'Enviar pesquisa', exact: true })).toBeEnabled();
});

test('pesquisa é enviada com sucesso sem repetir o encerramento', async ({ page }) => {
  const state = await mockCloseout(page);
  await page.getByRole('button', { name: 'Enviar pesquisa', exact: true }).click();
  await expect(page.getByText('Pesquisa de satisfação enviada ao cliente.', { exact: true })).toBeVisible();
  await expect(page.getByText('Enviar pesquisa de satisfação?', { exact: true })).toBeHidden();
  expect(state.sends).toBe(1);
  expect(state.closes).toBe(1);
});

test('sem e-mail do cliente, encerra e explica por que o envio está indisponível', async ({ page }) => {
  const state = await mockCloseout(page, { email: '' });
  await expect(page.getByText(/Cadastre o e-mail principal do cliente/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar pesquisa', exact: true })).toBeDisabled();
  expect(state.archived).toBe(true);
  expect(state.sends).toBe(0);
});

test('falha no encerramento não oferece nem envia pesquisa', async ({ page }) => {
  const state = await mockCloseout(page, { closeFails: true });
  await expect(page.getByText('Encerramento bloqueado.', { exact: true })).toBeVisible();
  await expect(page.getByText('Enviar pesquisa de satisfação?', { exact: true })).toBeHidden();
  expect(state.archived).toBe(false);
  expect(state.sends).toBe(0);
});
