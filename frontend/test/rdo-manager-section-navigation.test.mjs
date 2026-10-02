import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadModule(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

test('RDO manager navigation exposes the eight real sections in product order', async () => {
  const { RDO_MANAGER_SECTIONS } = await loadModule(
    '/src/pages/gestor/rdoSectionNavigationModel.ts'
  );

  assert.deepEqual(
    RDO_MANAGER_SECTIONS.map((section) => section.id),
    [
      'pendentes',
      'aprovados',
      'projetos',
      'arquivados',
      'equipe',
      'usuarios',
      'nps',
      'estatisticas'
    ]
  );
});

test('RDO manager navigation preserves unrelated query params and canonical pending URL', async () => {
  const { rdoManagerSectionHref } = await loadModule(
    '/src/pages/gestor/rdoSectionNavigationModel.ts'
  );

  assert.equal(
    rdoManagerSectionHref('projetos', '?project=42&tab=aprovados'),
    '/rdo/gestor?project=42&tab=projetos'
  );
  assert.equal(
    rdoManagerSectionHref('pendentes', '?project=42&tab=projetos'),
    '/rdo/gestor?project=42'
  );
});

test('RDO manager keeps the section navigation for tablet and hides it on mobile', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const navigation = source('src/pages/gestor/RdoSectionNavigation.tsx');
  const css = source('src/pages/gestor/GestorPage.ds.css');

  assert.doesNotMatch(
    page,
    /rdo-manager-tabs-wrap|aria-label="Seções do gestor"/
  );
  assert.match(page, /<RdoSectionNavigation/);
  assert.match(
    navigation,
    /ariaLabel = 'Navegar nas áreas de Relatórios e Projetos'/
  );
  assert.match(navigation, /aria-label=\{ariaLabel\}/);
  assert.match(navigation, /'--rdo-section-count': navigationSections\.length/);
  assert.match(navigation, /role="group"/);
  assert.match(navigation, /aria-pressed=\{active\}/);
  assert.match(navigation, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(
    navigation,
    /'ArrowDown',[\s\S]*?'ArrowUp',[\s\S]*?'ArrowLeft',[\s\S]*?'ArrowRight'/
  );
  assert.match(navigation, /'Home',[\s\S]*?'End'/);
  assert.doesNotMatch(navigation, /aria-haspopup|role="menu"|role="menuitem"/);
  assert.doesNotMatch(navigation, /<Select\b|<option\b/);
  assert.doesNotMatch(
    navigation,
    /Relatórios e Projetos ·|<Badge|MODULE_NAVIGATION_ICONS/
  );
  assert.match(css, /\.rdo-section-navigation\s*\{/);
  assert.match(
    css,
    /\.rdo-section-navigation\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent/
  );
  assert.match(css, /\.rdo-section-navigation__items\s*\{[\s\S]*repeat\(4,/);
  assert.match(
    css,
    /\.rdo-section-navigation__item\.is-active\s*\{[\s\S]*background:\s*var\(--surface\)[\s\S]*color:\s*var\(--brand-text\)/
  );
  assert.match(
    css,
    /\.rdo-section-navigation__item\.is-active::after\s*\{[\s\S]*background:\s*var\(--brand\)/
  );
  assert.match(
    css,
    /@media \(min-width: 768px\) and \(max-width: 1024px\)[\s\S]*?\.rdo-section-navigation__items\s*\{[\s\S]*?repeat\(var\(--rdo-section-count, 8\),/
  );
  assert.match(
    css,
    /@media \(max-width: 768px\)[\s\S]*?\.rdo-section-navigation\s*\{[\s\S]*?display:\s*none/
  );
  assert.match(
    css,
    /@media \(min-width:\s*1024px\)[\s\S]*\.rdo-section-navigation\s*\{[\s\S]*display:\s*none/
  );
});

test('RDO manager derives the current section only from the URL', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');

  assert.match(
    page,
    /const tab = parseGestorTab\(searchParams\.get\('tab'\)\)/
  );
  assert.doesNotMatch(page, /\[tab, setTab\]/);
  assert.doesNotMatch(page, /setSearchParams\(/);
});
