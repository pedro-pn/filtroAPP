import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { Client } = require('../../backend/node_modules/pg');
const fixture = JSON.parse(readFileSync(new URL('../../output/validation/redesign-fixture.json', import.meta.url), 'utf8'));
if (!fixture.database.startsWith('filtrovali_redesign_validation_')) throw new Error('Refusing non-validation database.');
const suffix = Date.now().toString(36);
async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: fixture.databaseUrl });
  await client.connect();
  try { return (await client.query(text, values)).rows; } finally { await client.end(); }
}
async function authenticate(page: Page) {
  const token = fixture.tokens.admin;
  await page.addInitScript(token => {
    localStorage.setItem('filtrovali-react-token', token);
    localStorage.setItem('filtrovali:qualidade-tutorial:v1:manager:redesign_admin', '1');
  }, token);
}
test.beforeEach(async ({ page }) => authenticate(page));

test('Contas: criação, edição e leitura após recarregar persistem no PostgreSQL', async ({ page }) => {
  await page.goto('/admin/accounts');
  await page.getByRole('button', { name: 'Nova conta', exact: true }).first().click();
  await page.locator('#account-username-control').fill(`closure_${suffix}`);
  await page.locator('#account-name-control').fill(`Conta ${suffix}`);
  await page.getByRole('checkbox', { name: /Qualidade.*Consulta|Qualidade.*Leitura|Qualidade.*Visualizador/i }).check();
  const created = page.waitForResponse(r => r.url().endsWith('/admin/accounts') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  expect((await created).ok()).toBeTruthy();
  const rows = await sql('SELECT id,name FROM "User" WHERE username=$1', [`closure_${suffix}`]);
  expect(rows).toHaveLength(1);
  await page.getByRole('row').filter({hasText:`Conta ${suffix}`}).getByRole('button', { name: 'Editar', exact:true }).click();
  await page.locator('#account-name-control').fill(`Conta revisada ${suffix}`);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(async () => (await sql('SELECT name FROM "User" WHERE id=$1', [rows[0].id]))[0]?.name).toBe(`Conta revisada ${suffix}`);
  await page.reload(); await expect(page.getByText(`Conta revisada ${suffix}`, { exact: true })).toBeVisible();
});

test('Qualidade: natureza e registro enviados pelo formulário persistem', async ({ page }) => {
  await page.goto('/qualidade?tab=naturezas');
  await page.getByLabel(/Nome.*natureza|Nova natureza/i).fill(`Natureza ${suffix}`);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect.poll(async () => (await sql('SELECT id FROM "QualityNature" WHERE name=$1',[`Natureza ${suffix}`])).length).toBe(1);
  await page.goto('/qualidade'); await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo', { exact: false }).selectOption('DESVIO');
  await dialog.getByLabel('Obra/Projeto').selectOption(fixture.project.id);
  await dialog.getByLabel('Origem', { exact: false }).fill('Validação isolada');
  const nature = (await sql('SELECT id FROM "QualityNature" WHERE name=$1',[`Natureza ${suffix}`]))[0];
  await dialog.getByLabel('Natureza', { exact: false }).selectOption(nature.id);
  await dialog.getByLabel('Impacto', { exact: false }).selectOption('BAIXO');
  await dialog.getByLabel('Status', { exact: false }).selectOption('ABERTO');
  await dialog.getByLabel('Disposição', { exact: false }).selectOption('MONITORAR');
  await dialog.getByLabel('Descrição do evento', { exact: false }).fill(`Descrição ${suffix}`);
  await dialog.getByRole('button', { name: /Salvar|Registrar/, exact: false }).click();
  await expect.poll(async () => (await sql('SELECT id FROM "QualityRecord" WHERE description=$1',[`Descrição ${suffix}`])).length).toBe(1);
  const record = (await sql('SELECT number,"projectId","natureId" FROM "QualityRecord" WHERE description=$1',[`Descrição ${suffix}`]))[0];
  expect(record.projectId).toBe(fixture.project.id);expect(record.natureId).toBe(nature.id);
  await page.reload();await expect(page.getByText(record.number, { exact: true })).toBeVisible();
});

test('EPI: catálogo e entrega gravam a quantidade e o colaborador correto', async ({ page }) => {
  await page.goto('/epi?tab=catalog');
  await page.getByLabel('Nome do EPI', { exact: true }).fill(`Capacete ${suffix}`);
  await page.getByLabel('C.A', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect.poll(async () => (await sql('SELECT id FROM "EpiCatalogItem" WHERE name=$1',[`Capacete ${suffix}`])).length).toBe(1);
  const item = (await sql('SELECT id FROM "EpiCatalogItem" WHERE name=$1',[`Capacete ${suffix}`]))[0];
  await page.goto('/epi'); await page.getByRole('button', { name: /Colaborador Validação/ }).click();
  await page.getByLabel('EPI cadastrado').selectOption(item.id);
  await page.getByLabel('Quantidade', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
  await expect.poll(async () => (await sql('SELECT quantity FROM "EpiRecord" WHERE "catalogItemId"=$1 AND "collaboratorId"=$2',[item.id,fixture.collaborator.id]))[0]?.quantity).toBe(2);
  await page.reload(); await page.getByRole('button', { name: /Colaborador Validação/ }).click();
  await expect(page.getByText(`Capacete ${suffix}`,{exact:true})).toBeVisible();
});

test('Privacidade: pedido público, verificação e conclusão preservam evidências', async ({ page }) => {
  await page.goto('/privacidade/direitos');
  await page.getByLabel(/^Tipo de solicitação/).selectOption('ACCESS');
  await page.getByLabel(/^Nome completo/).fill(`Titular ${suffix}`);
  await page.getByLabel(/^E-mail de contato/).fill(`closure-${suffix}@example.invalid`);
  await page.getByLabel(/Detalhes|Descreva/i).fill(`Solicitação ${suffix}`);
  await page.getByRole('button', { name: 'Registrar solicitação' }).click();
  await expect.poll(async () => (await sql('SELECT id FROM "DataSubjectRequest" WHERE email=$1',[`closure-${suffix}@example.invalid`])).length).toBe(1);
  const request = (await sql('SELECT id,protocol FROM "DataSubjectRequest" WHERE email=$1',[`closure-${suffix}@example.invalid`]))[0];
  await page.goto('/privacidade/solicitacoes');
  const card = page.locator('.privacy-request-card').filter({hasText:request.protocol});
  await card.locator('summary').click();
  await card.getByRole('button',{name:'Registrar verificação',exact:true}).click();
  await page.getByRole('dialog').getByLabel(/^Evidência/).fill('Identidade conferida presencialmente na base de validação.');
  await page.getByRole('dialog').getByRole('button',{name:'Salvar evidência'}).click();
  await expect.poll(async () => (await sql('SELECT "identityVerifiedAt" FROM "DataSubjectRequest" WHERE id=$1',[request.id]))[0]?.identityVerifiedAt != null).toBeTruthy();
  await page.getByRole('button',{name:'Em análise',exact:true}).click();
  await card.locator('summary').click();
  await card.getByRole('button',{name:'Marcar como resolvida'}).click();
  await page.getByRole('dialog').getByLabel(/^Evidência/).fill('Resposta entregue presencialmente ao titular de teste.');
  await page.getByRole('dialog').getByRole('button',{name:'Salvar evidência'}).click();
  await expect.poll(async () => (await sql('SELECT status FROM "DataSubjectRequest" WHERE id=$1',[request.id]))[0]?.status).toBe('COMPLETED');
});

test('Romaneio: emissão e edição persistem cabeçalho, itens e quantidade', async ({ page }) => {
  await page.goto('/romaneio/novo');
  await page.getByRole('combobox',{name:'Projeto',exact:true}).click();
  await page.getByRole('option',{name:/VAL-2026/}).click();
  await page.getByLabel('Motorista',{exact:true}).fill(`Motorista ${suffix}`);
  await page.getByLabel('Placa do veículo').fill('ABC1D23');
  const custom = page.locator('section').filter({has:page.getByText('Item não listado',{exact:true})}).last();
  await custom.getByLabel('Item',{exact:true}).fill(`Item ${suffix}`);
  await custom.getByLabel('Categoria',{exact:true}).fill('Validação');
  await custom.getByLabel('Quantidade',{exact:true}).fill('3');
  await page.getByRole('button',{name:'Adicionar item livre',exact:true}).click();
  await page.getByRole('button',{name:'Enviar saída',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:/Confirmar|Enviar/,exact:false}).click();
  await expect.poll(async () => (await sql('SELECT id FROM "Romaneio" WHERE "driverName"=$1',[`Motorista ${suffix}`])).length).toBe(1);
  const romaneio=(await sql('SELECT id,"vehiclePlate" FROM "Romaneio" WHERE "driverName"=$1',[`Motorista ${suffix}`]))[0];
  expect(romaneio.vehiclePlate).toBe('ABC1D23');
  const items=await sql('SELECT "itemName",quantity FROM "RomaneioItem" WHERE "romaneioId"=$1',[romaneio.id]);
  expect(items[0].itemName).toBe(`Item ${suffix}`);expect(Number(items[0].quantity)).toBe(3);
  await page.goto(`/romaneio/novo?edit=${romaneio.id}`);
  await expect(page.getByLabel('Motorista',{exact:true})).toHaveValue(`Motorista ${suffix}`);
  await page.getByLabel('Motorista',{exact:true}).fill(`Motorista revisado ${suffix}`);
  await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await dialog.getByRole('button',{name:/Confirmar|Enviar|Salvar/,exact:false}).click();
  await expect.poll(async () => (await sql('SELECT "driverName" FROM "Romaneio" WHERE id=$1',[romaneio.id]))[0]?.driverName).toBe(`Motorista revisado ${suffix}`);
});
