import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { inspectPage, useValidationAccount, validationFixture as f } from './redesign-audit-support';

const pages = ['/modulos','/conta','/admin/accounts','/admin/tokens','/qualidade','/epi?tab=catalog','/privacidade/solicitacoes','/romaneio/novo','/equipamentos?tab=categories','/estoque?tab=itens','/efetivo?section=calendario',`/acompanhamento?section=projetos&project=${f.project.id}`,'/rdo/relatorio/novo','/manutencao-producao/relatorio/novo?tipo=manutencao'];
for (const device of [{name:'mobile',width:390,height:844},{name:'tablet',width:768,height:1024},{name:'desktop',width:1280,height:900}]) {
  for (const theme of ['light','dark'] as const) {
    test(`fluxos autenticados · ${device.name} · ${theme}`,async({page},testInfo)=>{
      test.setTimeout(240_000);await page.setViewportSize(device);await useValidationAccount(page,'admin',theme);
      const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const results=[];
      for(const path of pages){
        await page.goto(path);await expect(page.locator('main').first()).toBeVisible();
        await expect(page.locator('.fv-brand-loading:visible')).toHaveCount(0,{timeout:30_000});
        const state=await inspectPage(page);results.push({path,...state});
        if(path.startsWith('/acompanhamento?')) await expect(page.getByText('Não foi possível carregar o projeto.',{exact:true})).toHaveCount(0);
        await page.screenshot({path:testInfo.outputPath(`${results.length}.png`),fullPage:state.height<8500});
      }
      await testInfo.attach('page-audit',{body:JSON.stringify({errors,results},null,2),contentType:'application/json'});
      await writeFile(testInfo.outputPath('audit.json'),JSON.stringify({errors,results},null,2));
      expect.soft(errors).toEqual([]);
      for(const result of results){expect.soft(result.overflow,result.path).toBeLessThanOrEqual(1);expect.soft(result.unnamed,result.path).toEqual([]);expect.soft(result.badImages,result.path).toEqual([]);expect.soft(result.theme,result.path).toBe(theme);expect.soft(result.contrast,result.path).toEqual([]);}
    });
  }
}

test('permissões de leitura e sem acesso são aplicadas pela API e pela interface',async({page})=>{
  await useValidationAccount(page,'viewer');
  const headers={Authorization:`Bearer ${f.tokens.viewer}`};
  for(const [path,data] of [['/api/qualidade/naturezas',{name:'Negado'}],['/api/estoque/itens',{name:'Negado'}],['/api/equipamentos/categories',{name:'Negado'}]]){
    const response=await page.request.post(path as string,{headers,data});expect(response.status(),path as string).toBe(403);
  }
  for(const path of ['/api/admin/accounts','/api/privacy/requests']) expect((await page.request.get(path,{headers})).status(),path).toBe(403);
  await page.goto('/qualidade');await expect(page.getByRole('heading',{name:'Registros de qualidade'})).toBeVisible();await expect(page.getByRole('button',{name:'Registrar',exact:true})).toHaveCount(0);
  await page.goto('/epi');await expect(page.getByRole('button',{name:'Adicionar EPI',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Catálogo',exact:true})).toHaveCount(0);
  const restricted={Authorization:`Bearer ${f.tokens.restricted}`};
  for(const path of ['/api/qualidade/registros','/api/estoque/itens','/api/equipamentos/','/api/romaneio/','/api/epi/collaborators','/api/efetivo/planning/overview','/api/acompanhamento/comercial/dashboard']){
    const response=await page.request.get(path,{headers:restricted});expect([401,403],path).toContain(response.status());
  }
});

test('diálogo mantém foco, teclado e retorno ao acionador',async({page})=>{
  await page.setViewportSize({width:390,height:844});await useValidationAccount(page,'admin','dark');await page.goto('/qualidade');
  const opener=page.getByRole('button',{name:'Registrar',exact:true});await opener.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  for(let i=0;i<25;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBeTruthy();}
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
});

test('onboarding do Hub e consentimento do cliente funcionam no mobile',async({page,browser})=>{
  await page.setViewportSize({width:390,height:844});await useValidationAccount(page,'admin','dark',true);await page.goto('/modulos');
  await expect(page.locator('.driver-popover')).toBeVisible();
  const rect=await page.locator('.driver-popover').boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button',{name:/Próximo/}).click();await expect(page.locator('.driver-popover')).toBeVisible();
  await page.locator('.driver-popover-close-btn').click();await expect(page.locator('.driver-popover')).toHaveCount(0);
  const {Client}=createRequire(import.meta.url)('../../backend/node_modules/pg');
  const db=new Client({connectionString:f.databaseUrl});await db.connect();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try {
    await db.query('UPDATE "User" SET "privacyPolicyVersion"=NULL WHERE id=$1',[f.client.id]);
    const clientPage=await context.newPage();await useValidationAccount(clientPage,'client','dark');await clientPage.goto('/cliente');
    await expect(clientPage.getByRole('heading',{name:'Antes de continuar',exact:true})).toBeVisible();
    const accept=clientPage.getByRole('button',{name:'Aceitar e continuar'});await expect(accept).toBeDisabled();
    await clientPage.getByRole('checkbox',{name:/Li e aceito o termo/}).check();await accept.click();
    await expect(clientPage.getByRole('heading',{name:'Antes de continuar',exact:true})).toHaveCount(0);
    await expect.poll(async()=> (await db.query('SELECT "privacyPolicyVersion" FROM "User" WHERE id=$1',[f.client.id])).rows[0]?.privacyPolicyVersion).toBeTruthy();
    await expect(clientPage.locator('.fv-bottom-bar')).toBeVisible();
  } finally {await context.close();await db.end();}
});
