import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { inspectPage, useValidationAccount } from './redesign-audit-support';
import { pageInventory } from './redesign-page-inventory';

test.describe.configure({mode:'parallel'});
const views=process.env.REDESIGN_AUDIT_LABELS ? pageInventory.filter(v=>new RegExp(process.env.REDESIGN_AUDIT_LABELS!).test(v.label)) : pageInventory;
for(const device of [{name:'mobile',width:390,height:844},{name:'tablet',width:768,height:1024},{name:'desktop',width:1280,height:900}]) for(const theme of ['light','dark'] as const){
  test(`conferência página a página · ${device.name} · ${theme}`,async({browser},info)=>{
    test.setTimeout(600_000);
    const results=[];
    for(const role of ['admin','collaborator','viewer','client','public']){
      const context=await browser.newContext({viewport:device,isMobile:device.name!=='desktop',hasTouch:device.name!=='desktop',locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
      const page=await context.newPage();
      if(role==='public') await page.addInitScript(theme=>localStorage.setItem('filtrovali-theme',theme),theme);
      else await useValidationAccount(page,role,theme);
      let errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
      try{
        for(const view of views.filter(v=>(v.role||'admin')===role)){
          errors=[];await page.goto(view.path);await expect(page.locator('main').first()).toBeVisible({timeout:20_000});await page.waitForTimeout(160);
          if(!view.loading) await expect(page.locator('.fv-brand-loading:visible')).toHaveCount(0,{timeout:30_000});
          if(view.open){await page.getByRole('button',{name:view.open,exact:view.openExact!==false}).first().click();}
          const state=await inspectPage(page);
          const failureCopy=await page.locator('main').getByText(/Não foi possível carregar|Erro ao carregar/).allTextContents();
          const result={label:view.label,path:view.path,role,preview:Boolean(view.preview),...state,errors:[...errors],failureCopy};results.push(result);
          const stem=String(results.length).padStart(3,'0');await page.screenshot({path:info.outputPath(`${stem}.png`),fullPage:state.height<8500});
          // Always save the accumulated record, even if a later navigation fails.
          await writeFile(info.outputPath('audit.json'),JSON.stringify({browser:info.project.name,device:device.name,theme,results},null,2));
          expect.soft(state.overflow,view.label).toBeLessThanOrEqual(1);expect.soft(state.unnamed,view.label).toEqual([]);
          expect.soft(state.badImages,view.label).toEqual([]);expect.soft(errors,view.label).toEqual([]);expect.soft(state.theme,view.label).toBe(theme);
          if (!view.expectedLoadError) expect.soft(failureCopy,view.label).toEqual([]);
          if (process.env.REDESIGN_ASSERT_CONTRAST === '1') expect.soft(state.contrast,view.label).toEqual([]);
        }
      }finally{await context.close();}
    }
    await info.attach('page-inventory-audit',{body:JSON.stringify(results,null,2),contentType:'application/json'});
  });
}
