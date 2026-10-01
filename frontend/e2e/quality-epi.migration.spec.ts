import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'admin-1', username: 'admin', name: 'Administrador', email: 'admin@example.com',
  role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['qualidade:manager', 'epi:technician'],
  reportEmissionPermissions: [], isActive: true
};

const nature = {
  id: 'nature-1', name: 'Documentação', isActive: true, position: 0,
  inUse: true, recordCount: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01'
};

const qualityRecord = {
  id: 'record-1', number: 'Q-001', type: 'DESVIO', seq: 1, year: 2026,
  registeredAt: '2026-09-01', origin: 'Inspeção', projectId: 'project-1',
  project: { id: 'project-1', code: '5917', name: 'Ilha Solteira' },
  eventDate: '2026-09-01', natureId: 'nature-1', nature: { id: 'nature-1', name: 'Documentação' },
  description: 'Documento pendente', impact: 'MEDIO', occurrences12m: 2, recurrent: true,
  linkedRnc: null, disposition: 'TRATAR', definedAction: null, actionOwner: null,
  actionDeadline: null, evidence: null, evidenceAttachment: null, evidences: [],
  resultVerification: null, status: 'ABERTO', createdAt: '2026-09-01', updatedAt: '2026-09-01'
};

const collaborator = {
  id: 'collaborator-1', code: 'C-001', name: 'Marina Operações', cpf: '',
  registrationNumber: '', admissionDate: null,
  currentJobRole: { id: 'role-1', name: 'Técnica', order: 1, isActive: true },
  roleOverrideJobRole: null,
  effectiveRole: { jobRoleId: 'role-1', name: 'Técnica', source: 'CANONICAL' },
  epiRecords: [{ id: 'epi-record-1', collaboratorId: 'collaborator-1', epiName: 'Capacete',
    ca: '123', quantity: 1, lendDate: '2026-09-01', devolutionDate: null,
    signedAt: null, archivedAt: null, createdAt: '2026-09-01', updatedAt: '2026-09-01' }]
};

async function useFixtures(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(selectedTheme => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-quality-epi-token');
    localStorage.setItem('filtrovali:qualidade-tutorial:v1:manager:admin@example.com', '1');
    localStorage.setItem('filtrovali:qualidade-tutorial:v1:viewer:viewer@example.com', '1');
    localStorage.setItem('filtrovali-theme', selectedTheme);
  }, theme);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body: unknown = {};
    if (path === '/api/auth/me') body = { user: account };
    else if (path === '/api/qualidade/registros') body = { items: [qualityRecord], total: 1, page: 1, pageSize: 50 };
    else if (path === '/api/qualidade/projetos') body = [{ id: 'project-1', code: '5917', name: 'Ilha Solteira', isActive: true }];
    else if (path === '/api/qualidade/naturezas') body = [nature];
    else if (path === '/api/epi/collaborators') body = [collaborator];
    else if (path === '/api/epi/catalog') body = [{ id: 'catalog-1', name: 'Capacete', ca: '123', isActive: true }];
    else if (path === '/api/epi/job-roles') body = [collaborator.currentJobRole];
    else if (path === '/api/epi/public-sign/test-token') body = {
      status: 'ACTIVE', expiresAt: '2026-10-15',
      collaborator: { id: collaborator.id, name: collaborator.name, role: 'Técnica' },
      records: collaborator.epiRecords
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

for (const viewport of [
  { name: 'mobile', width: 390, height: 844, theme: 'light' },
  { name: 'tablet', width: 768, height: 1024, theme: 'dark' },
  { name: 'desktop', width: 1280, height: 900, theme: 'light' }
] as const) {
  test(`Qualidade e EPI · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await useFixtures(page, viewport.theme);

    await page.goto('/qualidade');
    await expect(page.getByRole('heading', { name: 'Registros de qualidade' })).toBeVisible();
    await expect(page.getByText('Q-001')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`quality-${viewport.name}.png`, { fullPage: true });
    if (viewport.name === 'mobile') {
      const filterToggle = page.locator('.quality-filter-details > summary');
      await filterToggle.click();
      await expect(page.getByRole('combobox', { name: 'Filtrar tipo' })).toBeVisible();
      await filterToggle.click();
    }
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByRole('dialog')).toContainText('Novo registro');
    await expect(page.getByRole('dialog').getByLabel('Obra/Projeto')).toBeVisible();
    await expect.poll(() => page.locator('.quality-modal-v2').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    const selectSection = async (label: string) => {
      if (viewport.name === 'tablet') {
        await page.getByRole('button', { name: 'Abrir menu' }).click();
        await page.locator('.fv-navigation-drawer').getByRole('link', { name: label }).click();
      } else {
        await page.locator(viewport.name === 'desktop' ? '.fv-app-shell__sidebar' : '.fv-bottom-bar').getByRole('link', { name: label }).click();
      }
    };
    await selectSection('Naturezas');
    await expect(page.getByRole('heading', { name: 'Naturezas' })).toBeVisible();
    await expect(page.getByText('Documentação')).toBeVisible();
    if (viewport.name === 'mobile') await expect(page).toHaveScreenshot('quality-natures-mobile.png', { fullPage: true });
    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('dialog')).toContainText('Editar Natureza');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await page.goto('/epi');
    await expect(page.getByRole('heading', { name: 'Fichas por colaborador' })).toBeVisible();
    await page.getByRole('button', { name: /Marina Operações/ }).click();
    await expect(page.locator('.epi-record-row').getByText('Capacete', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`epi-collaborator-${viewport.name}.png`, { fullPage: true });
    await selectSection('Catálogo');
    await expect(page.getByRole('heading', { name: 'Catálogo de EPIs' })).toBeVisible();
    await expect(page.locator('.epi-catalog-row').getByText('Capacete', { exact: true })).toBeVisible();
    await page.locator('.epi-catalog-row').getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('textbox', { name: 'Nome de Capacete' })).toBeVisible();
    await page.locator('.epi-catalog-edit-form').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveScreenshot(`epi-catalog-${viewport.name}.png`, { fullPage: true });

    await page.goto('/epi/assinar/test-token');
    await expect(page.getByText('Assinatura de EPI', { exact: true })).toBeVisible();
    await expect(page.getByText('Marina Operações')).toBeVisible();
    await expect(page.locator('.epi-public-row').getByText('Capacete')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`epi-public-${viewport.name}.png`, { fullPage: true });
  });
}

test('Qualidade: validação, Interno/SGQ e links no envio do registro', async ({ page }) => {
  await useFixtures(page, 'light');
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/qualidade/registros', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(qualityRecord) });
  });

  await page.goto('/qualidade');
  await page.getByRole('button', { name: 'Registrar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText('Campo obrigatório.').first()).toBeVisible();
  await dialog.getByLabel('Origem').fill('Inspeção interna');
  await dialog.getByLabel('Natureza').selectOption('nature-1');
  await dialog.getByLabel('Descrição do evento').fill('Documento revisado');
  await dialog.getByRole('button', { name: 'Adicionar link' }).click();
  await dialog.getByRole('textbox', { name: 'Link de evidência 1' }).fill('link-inválido');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText('Informe links de evidência válidos começando com http:// ou https://.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Link de evidência 1' }).fill('https://example.com/evidencia');
  await dialog.locator('#quality-evidence-files').setInputFiles({
    name: 'evidencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF')
  });
  await expect(dialog.getByText('evidencia.pdf')).toBeVisible();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toMatchObject({
    projectId: null,
    origin: 'Inspeção interna',
    natureId: 'nature-1',
    description: 'Documento revisado',
    evidences: [
      { kind: 'LINK', url: 'https://example.com/evidencia' },
      { kind: 'ATTACHMENT', fileName: 'evidencia.pdf', mimeType: 'application/pdf' }
    ]
  });
});

test('Qualidade: reordenação pelo teclado envia a ordem completa', async ({ page }) => {
  await useFixtures(page, 'light');
  const secondNature = { ...nature, id: 'nature-2', name: 'Processo', position: 1, inUse: false, recordCount: 0 };
  let order = [nature, secondNature];
  let submittedIds: string[] = [];
  await page.route('**/api/qualidade/naturezas**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/ordem') && route.request().method() === 'PATCH') {
      submittedIds = (route.request().postDataJSON() as { ids: string[] }).ids;
      order = submittedIds.map(id => order.find(item => item.id === id)!);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) });
  });

  await page.goto('/qualidade?tab=naturezas');
  await page.getByRole('button', { name: 'Reordenar Documentação: arraste ou use as setas' }).press('ArrowDown');
  await expect.poll(() => submittedIds).toEqual(['nature-2', 'nature-1']);
  await expect(page.locator('.quality-nature-row .sec').first()).toHaveText('Processo');
});

test('Qualidade: confirmação de inativação usa o diálogo visual atualizado', async ({ page }) => {
  await useFixtures(page, 'light');
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/qualidade/naturezas/nature-1/ativo', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...nature, isActive: false }) });
  });

  await page.goto('/qualidade?tab=naturezas');
  await page.getByRole('button', { name: 'Inativar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveClass(/fv-modal/);
  await expect(dialog).toContainText('Inativar Natureza');
  await dialog.getByRole('button', { name: 'Inativar' }).click();
  await expect.poll(() => submitted).toEqual({ isActive: false });
});

test('EPI: formulários de entrega e catálogo preservam os contratos', async ({ page }) => {
  await useFixtures(page, 'light');
  let recordPayload: Record<string, unknown> | null = null;
  let catalogPayload: Record<string, unknown> | null = null;
  await page.route('**/api/epi/collaborators/collaborator-1/records', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    recordPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(collaborator.epiRecords[0]) });
  });
  await page.route('**/api/epi/catalog/catalog-1', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    catalogPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'catalog-1', ...catalogPayload }) });
  });

  await page.goto('/epi');
  await page.getByRole('button', { name: /Marina Operações/ }).click();
  await page.getByLabel('EPI cadastrado').selectOption('catalog-1');
  await page.getByLabel('Quantidade').fill('2');
  await page.getByRole('button', { name: 'Adicionar EPI' }).click();
  await expect.poll(() => recordPayload).toMatchObject({ catalogItemId: 'catalog-1', epiName: 'Capacete', ca: '123', quantity: 2 });

  await page.goto('/epi?tab=catalog');
  await page.locator('.epi-catalog-row').getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('textbox', { name: 'Nome de Capacete' }).fill('Capacete classe B');
  await page.locator('.epi-catalog-edit-form').getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => catalogPayload).toEqual({ name: 'Capacete classe B', ca: '123' });
});

test('Qualidade visualizador e EPI colaborador não exibem ações de edição', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFixtures(page, 'dark');
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: {
      ...account,
      id: 'viewer-1', username: 'viewer', name: 'Visualizador', email: 'viewer@example.com',
      accountType: 'INTERNAL', moduleRoles: ['qualidade:viewer', 'epi:collaborator']
    } })
  }));

  await page.goto('/qualidade');
  await expect(page.getByText('Q-001')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar' })).toHaveCount(0);
  await page.goto('/qualidade?tab=naturezas');
  await expect(page.getByText('Documentação')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);

  await page.goto('/epi');
  await page.getByRole('button', { name: /Marina Operações/ }).click();
  await expect(page.locator('.epi-record-row').getByText('Capacete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar EPI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await page.goto('/epi?tab=catalog');
  await expect(page.getByText('Capacete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('EPI: assinatura, arquivo e restauração usam confirmação e contratos existentes', async ({ page }) => {
  await useFixtures(page, 'light');
  let current = { ...collaborator, epiRecords: collaborator.epiRecords.map(record => ({ ...record, archivedAt: record.archivedAt as string | null })) };
  let signatureIds: string[] = [];
  const archiveRequests: Array<{ recordIds: string[]; archived: boolean }> = [];
  await page.route('**/api/epi/collaborators', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([current])
  }));
  await page.route('**/api/epi/collaborators/collaborator-1/signature-requests', async route => {
    signatureIds = (route.request().postDataJSON() as { recordIds: string[] }).recordIds;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ signUrl: 'https://example.com/assinar/teste', token: 'teste' }) });
  });
  await page.route('**/api/epi/collaborators/collaborator-1/records/archive', async route => {
    const request = route.request().postDataJSON() as { recordIds: string[]; archived: boolean };
    archiveRequests.push(request);
    current = {
      ...current,
      epiRecords: current.epiRecords.map(record => request.recordIds.includes(record.id)
        ? { ...record, archivedAt: request.archived ? '2026-10-01' : null }
        : record)
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
  });

  await page.goto('/epi');
  await page.getByRole('button', { name: /Marina Operações/ }).click();
  await page.getByRole('checkbox', { name: 'Selecionar Capacete' }).check();
  await page.getByRole('button', { name: 'Solicitar assinatura' }).click();
  await expect.poll(() => signatureIds).toEqual(['epi-record-1']);
  await expect(page.getByText('https://example.com/assinar/teste')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Selecionar Capacete' }).check();
  await page.getByRole('button', { name: 'Arquivar selecionados' }).click();
  await expect(page.getByRole('dialog')).toContainText('Arquivar EPIs selecionados?');
  await page.getByRole('dialog').getByRole('button', { name: 'Arquivar' }).click();
  await expect.poll(() => archiveRequests).toEqual([{ recordIds: ['epi-record-1'], archived: true }]);
  await page.getByRole('button', { name: 'Arquivados (1)' }).click();
  await expect(page.locator('.epi-record-row').getByText('Capacete', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Selecionar Capacete' }).check();
  await page.getByRole('button', { name: 'Restaurar selecionados' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect.poll(() => archiveRequests).toEqual([
    { recordIds: ['epi-record-1'], archived: true },
    { recordIds: ['epi-record-1'], archived: false }
  ]);
});

test('EPI: perfil, devolução e PDF permanecem operacionais', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFixtures(page, 'light');
  let current = { ...collaborator };
  let profilePayload: Record<string, unknown> | null = null;
  let returnPayload: Record<string, unknown> | null = null;
  await page.route('**/api/epi/collaborators', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([current])
  }));
  await page.route('**/api/epi/collaborators/collaborator-1/profile', async route => {
    profilePayload = route.request().postDataJSON() as Record<string, unknown>;
    current = { ...current, registrationNumber: String(profilePayload.registrationNumber || '') };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
  });
  await page.route('**/api/epi/records/epi-record-1', async route => {
    returnPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...collaborator.epiRecords[0], devolutionDate: returnPayload.devolutionDate }) });
  });
  await page.route('**/api/epi/collaborators/collaborator-1/signature-requests', route => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({ signUrl: 'https://example.com/assinar/devolucao', token: 'devolucao' })
  }));
  await page.route('**/api/epi/collaborators/collaborator-1/pdf', route => route.fulfill({
    status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF'
  }));

  await page.goto('/epi');
  await page.getByRole('button', { name: /Marina Operações/ }).click();
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByLabel('Matrícula').fill('MAT-041');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect.poll(() => profilePayload).toMatchObject({ registrationNumber: 'MAT-041' });
  await expect(page.getByText('MAT-041')).toBeVisible();

  await page.getByRole('button', { name: 'Devolver' }).click();
  await expect.poll(() => returnPayload).toHaveProperty('devolutionDate');
  await expect(page.getByText('https://example.com/assinar/devolucao')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('Marina Operações.pdf');
});

test('Qualidade: evidências e exportação permanecem disponíveis no celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFixtures(page, 'light');
  const recordWithEvidence = {
    ...qualityRecord,
    evidences: [
      { id: 'link-1', kind: 'LINK', url: 'https://example.com/foto', label: 'Foto' },
      { id: 'file-1', kind: 'ATTACHMENT', publicUrl: '/api/qualidade-anexos/file-1', fileName: 'checklist.pdf' }
    ]
  };
  await page.route('**/api/qualidade/registros**', route => {
    if (new URL(route.request().url()).pathname !== '/api/qualidade/registros') return route.fallback();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [recordWithEvidence], total: 1, page: 1, pageSize: 50 })
    });
  });
  await page.route('**/api/qualidade/registros/export', route => route.fulfill({
    status: 200,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: 'planilha'
  }));

  await page.goto('/qualidade');
  await page.getByRole('button', { name: /Evidências/ }).click();
  await expect(page.getByRole('link', { name: 'Foto' })).toHaveAttribute('href', 'https://example.com/foto');
  await expect(page.getByRole('link', { name: 'checklist.pdf' })).toHaveAttribute('href', '/api/qualidade-anexos/file-1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^registros-qualidade-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('Assinatura pública de EPI: consentimento, confirmação e ficha assinada', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFixtures(page, 'light');
  let signed = false;
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/epi/public-sign/test-token', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      status: signed ? 'SIGNED' : 'ACTIVE', expiresAt: '2026-10-15',
      collaborator: { id: collaborator.id, name: collaborator.name, role: 'Técnica' },
      records: collaborator.epiRecords
    })
  }));
  await page.route('**/api/epi/public-sign/test-token/confirm', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    signed = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.goto('/epi/assinar/test-token');
  await expect(page.getByRole('button', { name: 'Assinar' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Li e estou ciente do tratamento dos meus dados para assinatura de EPI/ }).check();
  await page.getByRole('button', { name: 'Assinar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Assinar EPIs');
  await expect.poll(() => dialog.evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
  await expect(dialog).toHaveScreenshot('epi-signature-dialog-mobile.png');
  await dialog.getByRole('button', { name: 'Enviar imagem' }).click();
  await dialog.locator('.signature-file-input').setInputFiles({
    name: 'assinatura.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5V8AAAAASUVORK5CYII=', 'base64')
  });
  await expect(dialog.getByAltText('Prévia da assinatura')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar assinatura' }).click();
  await expect.poll(() => submitted).toMatchObject({ signerName: 'Marina Operações', privacyNoticeAccepted: true });
  await expect(page.getByText('Link de assinatura encerrado')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Baixar PDF assinado' })).toBeVisible();
});

test('Acesso sem papéis de Qualidade ou EPI é redirecionado', async ({ page }) => {
  await useFixtures(page, 'light');
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { ...account, accountType: 'INTERNAL', moduleRoles: [] } })
  }));

  await page.goto('/qualidade');
  await expect.poll(() => new URL(page.url()).pathname).not.toBe('/qualidade');
  await page.goto('/epi');
  await expect.poll(() => new URL(page.url()).pathname).not.toBe('/epi');
});
