import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('o manual do módulo referencia só capturas que existem nos assets', async () => {
  const html = await readFile(new URL('src/pages/equipamentos/manual/manual.html', root), 'utf8');
  const assets = new Set((await readdir(new URL('src/assets/manual-equipamentos/', root))).map(file => file.replace(/\.[^.]+$/, '')));
  const used = new Set([...html.matchAll(/\{\{img:([a-z0-9-]+)\}\}/g)].map(match => match[1]));

  assert.ok(used.size > 20, 'o manual tem imagens');
  assert.deepEqual([...used].filter(name => !assets.has(name)), [], 'toda imagem citada existe');
  assert.doesNotMatch(html, /src="img\//, 'nenhum caminho relativo solto');
});

test('o manual tem índice navegável e a página fica na rota do módulo', async () => {
  const html = await readFile(new URL('src/pages/equipamentos/manual/manual.html', root), 'utf8');
  const anchors = [...html.matchAll(/href="#(h[\d_]+)"/g)].map(match => match[1]);
  assert.ok(anchors.length > 30);
  for (const id of anchors) assert.match(html, new RegExp(`id="${id}"`), `âncora ${id} existe`);

  const routes = await readFile(new URL('src/modules/moduleRoutes.tsx', root), 'utf8');
  assert.match(routes, /EquipmentManualPage/);
  assert.match(routes, /\/manual`/);
});

test('o CSS do manual fica escopado ao contêiner da página', async () => {
  const css = await readFile(new URL('src/pages/equipamentos/manual/manual.css', root), 'utf8');
  assert.doesNotMatch(css, /(^|\})\s*(body|html|\*)\s*\{/, 'sem regras globais soltas');
  assert.match(css, /\.equip-manual/);
});
