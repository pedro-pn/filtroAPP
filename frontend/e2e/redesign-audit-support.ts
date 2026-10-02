import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const validationFixture = JSON.parse(readFileSync(new URL('../../output/validation/redesign-fixture.json', import.meta.url), 'utf8'));
if (!validationFixture.database.startsWith('filtrovali_redesign_validation_')) throw new Error('Disposable validation database required.');
export async function useValidationAccount(page: Page, role: string = 'admin', theme: 'light' | 'dark' = 'light', tutorials = false) {
  const f = validationFixture;
  const account = role === 'admin' ? f.user : role === 'collaborator' ? f.collaboratorUser : f[role];
  await page.addInitScript(({token,theme,account,tutorials}) => {
    localStorage.setItem('filtrovali-react-token',token);localStorage.setItem('filtrovali-theme',theme);
    if (!tutorials) {
      for (const prefix of ['filtrovali:hub-first-login-tutorial:','filtrovali:efetivo-hub-novelty:v1:','filtrovali:operational-module-tutorial:v1:','filtrovali:assinaturas-tutorial:v1:']) localStorage.setItem(prefix+account.id,'1');
      for (const identity of [account.id,account.username,account.email].filter(Boolean)) {
        for(const prefix of ['filtrovali-acompanhamento-tutorial-done:','filtrovali:efetivo-tutorial-done:v2:','filtrovali-tutorial-done:']) localStorage.setItem(prefix+identity,'1');
        localStorage.setItem('filtrovali:qualidade-tutorial:v1:manager:'+identity,'1');localStorage.setItem('filtrovali:qualidade-tutorial:v1:viewer:'+identity,'1');
      }
    }
  }, {token:f.tokens[role],theme,account,tutorials});
}
export async function inspectPage(page: Page) {
  await expect(page.locator('main').first()).toBeVisible();
  await page.waitForTimeout(180);
  return page.evaluate(() => {
    const visible = (e: Element) => { const box=e.getBoundingClientRect(); const css=getComputedStyle(e);return box.width>0&&box.height>0&&css.visibility!=='hidden'&&css.display!=='none'&&!e.closest('[aria-hidden="true"], [inert]'); };
    const name = (e: Element) => (e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')?.split(' ').map(id=>document.getElementById(id)?.textContent||'').join(' ')||(e as HTMLInputElement).labels?.[0]?.textContent||e.getAttribute('title')||e.textContent||'').trim();
    const unnamed = [...document.querySelectorAll('input:not([type=hidden]),select,textarea,button,[role=button]')].filter(visible).filter(e=>!name(e)).map(e=>e.outerHTML.slice(0,220));
    const badImages = [...document.images].filter(visible).filter(e=>e.complete&&e.naturalWidth===0).map(e=>e.getAttribute('src'));
    const rgb = (value: string) => {
      const n=value.match(/[\d.]+/g)?.map(Number);
      if(value.startsWith('color(srgb ')&&n&&n.length>=3) return [n[0]*255,n[1]*255,n[2]*255,n[3]??1];
      if(!value.startsWith('rgb')) return null;
      return n && n.length>=3 ? [n[0],n[1],n[2],n[3]??1] : null;
    };
    const lum = (color:number[]) => color.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const contrast: {text:string;ratio:number;color:string;background:string;className:string}[]=[];
    const seen=new Set<string>();
    for(const e of document.querySelectorAll('main *, [role=dialog] *')) {
      if(!visible(e)||e.closest('svg,button:disabled,[aria-disabled=true]')||!(e.textContent?.trim())||![...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim())) continue;
      const css=getComputedStyle(e),fg=rgb(css.color);if(!fg||fg[3]<1) continue;
      const chain:Element[]=[];let parent:Element|null=e;while(parent){chain.unshift(parent);parent=parent.parentElement;}
      let bg=[255,255,255,1],skip=false;
      for(const ancestor of chain){const c=getComputedStyle(ancestor);if(Number(c.opacity)<1||c.backgroundImage!=='none'){skip=true;break;}const b=rgb(c.backgroundColor);if(b) bg=b.slice(0,3).map((v,i)=>v*b[3]+bg[i]*(1-b[3])).concat(1);}
      if(skip) continue;
      const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const size=parseFloat(css.fontSize),large=size>=24||(size>=18.66&&Number(css.fontWeight)>=700);
      // A named icon-only control uses non-text contrast, even when its glyph is a text node.
      const iconControl = e.closest('button[aria-label], [role=button][aria-label]') && /^[×✕✖]$/.test(e.textContent!.trim());
      const minimum = large || iconControl ? 3 : 4.5;
      const key=`${css.color}:${bg.join(',')}:${minimum}`;
      if(ratio<minimum-.05&&!seen.has(key)){seen.add(key);contrast.push({text:e.textContent!.trim().slice(0,90),ratio:Number(ratio.toFixed(2)),color:css.color,background:bg.slice(0,3).map(Math.round).join(','),className:typeof e.className==='string'?e.className:''});}
    }
    return { overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth, unnamed, badImages, contrast, theme: document.documentElement.dataset.theme, headings: [...document.querySelectorAll('h1')].map(e=>e.textContent), height: document.documentElement.scrollHeight };
  });
}
