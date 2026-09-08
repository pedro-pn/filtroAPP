import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { cardMatchesView, parseCardsView } from '../src/components/projects/projectCardViews.ts';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('filtro de Projetos separa missões conferidas das arquivadas', () => {
  const archived = { category: 'ARQUIVADO', archived: true, reviewed: false };
  const reviewed = { category: 'ARQUIVADO', archived: true, reviewed: true };

  assert.equal(cardMatchesView(archived, 'arquivados'), true);
  assert.equal(cardMatchesView(archived, 'conferidas'), false);
  assert.equal(cardMatchesView(reviewed, 'arquivados'), false);
  assert.equal(cardMatchesView(reviewed, 'conferidas'), true);
});

test('subaba Conferidas pode ser restaurada pela URL', () => {
  assert.equal(parseCardsView('conferidas'), 'conferidas');
  assert.equal(parseCardsView('desconhecida'), 'andamento');
});

test('Projetos exibe a subaba e seu contador', async () => {
  const source = await readSource('src/components/projects/ProjectCardsBoard.tsx');

  assert.match(source, /onClick=\{\(\) => setView\('conferidas'\)\}/);
  assert.match(source, /Conferidas <span className="acp-seg-count">\{counts\.conferidas\}<\/span>/);
  assert.match(source, /Nenhuma missão conferida\./);
});

test('ajuda da conferência informa o destino da missão', async () => {
  const source = await readSource('src/components/projects/ProjectTrackingNovelties.tsx');

  assert.match(source, /O card irá para a aba Conferidas/);
});
