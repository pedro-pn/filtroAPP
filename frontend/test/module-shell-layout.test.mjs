import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const frontendRoot = new URL('..', import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, frontendRoot), 'utf8');
}

test('cabeçalho compartilhado exibe a marca Filtrovali por padrão', async () => {
  const topBar = await source('src/layout/TopBar.tsx');

  assert.match(topBar, /showLogo = true/);
  assert.match(topBar, /LOGO_HEADER\.png/);
  assert.match(topBar, /alt="Filtrovali"/);
});

test('módulos operacionais usam toda a largura disponível', async () => {
  const [css, acompanhamento, equipamentos, estoque, qualidade, assinaturas] = await Promise.all([
    source('src/styles/base.css'),
    source('src/pages/acompanhamento/AcompanhamentoPage.tsx'),
    source('src/pages/equipamentos/EquipamentosPage.tsx'),
    source('src/pages/estoque/EstoquePage.tsx'),
    source('src/pages/qualidade/QualidadePage.tsx'),
    source('src/pages/assinaturas/AssinaturasPage.tsx')
  ]);

  assert.match(css, /\.app-shell:has\(\.equip-page\),[\s\S]*?\.app-shell:has\(\.stock-page\)\s*\{\s*max-width:\s*none;/);
  for (const page of [acompanhamento, equipamentos, qualidade, assinaturas]) {
    assert.match(page, /<main className="[^"]*\bequip-page\b[^"]*">/);
  }
  assert.match(estoque, /<main className="[^"]*\bstock-page\b[^"]*">/);
});
