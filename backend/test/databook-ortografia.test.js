import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import env from '../src/config/env.js';
import { aplicarEdicoes } from '../src/lib/databook/service.js';
import { aplicarCorrecoes, interpretarHunspell, palavraVerificavel, verificarOrtografia } from '../src/lib/databook/ortografia.js';

const dados = {
  dias: [
    { data: '05/10/2026', atividades: [{ hora: '08:00', texto: 'Montagem dos equipamnetos e boroscopia no 12-YD-0642.' }],
      servicos: [{ tags: '12-YD-0642', obs: 'Vazamento nos equipamnetos; Sr. Matheus acompanhou.' }],
      stand_by: { tempo: '01:00', motivo: 'aguardando liberasão' } },
    { data: '06/10/2026', atividades: [{ hora: null, texto: 'Sem ocorrências.' }], servicos: [] }
  ]
};

// Saída real do `hunspell -d pt_BR -a` para as três linhas com texto acima (cabeçalho + bloco por linha).
const saidaHunspell = [
  '@(#) International Ispell Version 3.2.06 (but really Hunspell 1.7.2)',
  '*', '*', '& equipamnetos 2 13: equipam netos, equipamentos', '*', '& boroscopia 5 29: boro scopia, horoscopia', '*', '',
  '*', '*', '& equipamnetos 2 13: equipam netos, equipamentos', '*', '*', '',
  '*', '& liberasão 1 11: liberação', '',
  '*', '*', ''
].join('\n');

test('interpreta o modo pipe do Hunspell por linha de entrada', () => {
  const linhas = interpretarHunspell(saidaHunspell, 4);
  assert.deepEqual(linhas[0].map(e => e.palavra), ['equipamnetos', 'boroscopia']);
  assert.deepEqual(linhas[0][0].sugestoes, ['equipamentos']); // sugestões com espaço são descartadas
  assert.deepEqual(linhas[2], [{ palavra: 'liberasão', sugestoes: ['liberação'] }]);
  assert.deepEqual(linhas[3], []);
});

test('só palavras comuns em minúscula entram: nomes, siglas, tags e termos do ramo ficam de fora', () => {
  assert.equal(palavraVerificavel('equipamnetos'), true);
  for (const p of ['Matheus', 'APVs', '12-YD-0642', 'boroscopia', 'flushing', 'ok', 'L101']) assert.equal(palavraVerificavel(p), false, p);
});

test('agrupa por palavra com o trecho e o campo de cada ocorrência', async () => {
  const r = await verificarOrtografia(dados, { executar: async () => saidaHunspell });
  assert.equal(r.disponivel, true);
  assert.deepEqual(r.palavras.map(p => [p.palavra, p.sugestoes, p.ocorrencias.length]), [
    ['equipamnetos', ['equipamentos'], 2],
    ['liberasão', ['liberação'], 1]
  ]);
  assert.equal(r.palavras[0].ocorrencias[1].campo, 'OBS do serviço');
  assert.match(r.palavras[1].ocorrencias[0].trecho, /aguardando liberasão/);
});

test('sem Hunspell a revisão segue, marcada como indisponível', async () => {
  const r = await verificarOrtografia(dados, { executar: async () => { throw new Error('ENOENT'); } });
  assert.deepEqual(r, { disponivel: false, palavras: [] });
});

test('correção escolhida troca só a palavra inteira nos textos livres; tags e demais campos intactos', () => {
  const corrigido = aplicarCorrecoes(dados, [
    { palavra: 'equipamnetos', por: 'equipamentos' },
    { palavra: 'liberasão', por: 'liberação' },
    { palavra: 'YD', por: 'XX' },          // não verificável: ignorada
    { palavra: 'equipamnetos', por: '12; DROP' } // texto inválido: ignorada
  ]);
  assert.equal(corrigido.dias[0].atividades[0].texto, 'Montagem dos equipamentos e boroscopia no 12-YD-0642.');
  assert.equal(corrigido.dias[0].servicos[0].obs, 'Vazamento nos equipamentos; Sr. Matheus acompanhou.');
  assert.equal(corrigido.dias[0].servicos[0].tags, '12-YD-0642');
  assert.equal(corrigido.dias[0].stand_by.motivo, 'aguardando liberação');
  assert.equal(dados.dias[0].atividades[0].texto.includes('equipamnetos'), true); // original preservado
  const viaEdicoes = aplicarEdicoes({ projeto: { emissao: '10/10/2026' }, textos: {}, fds: [], certificados: [], ...dados },
    { correcoes: [{ palavra: 'liberasão', por: 'liberação' }] });
  assert.equal(viaEdicoes.dias[0].stand_by.motivo, 'aguardando liberação');
});

const hunspellPronto = spawnSync(env.databookHunspell, ['-d', env.databookHunspellDict, '-a'], { input: '^teste\n', encoding: 'utf8' }).status === 0;

test('Hunspell real (pt_BR) encontra o erro e sugere a correção', { skip: !hunspellPronto && 'hunspell pt_BR não instalado' }, async () => {
  const r = await verificarOrtografia(dados);
  assert.equal(r.disponivel, true);
  const erro = r.palavras.find(p => p.palavra === 'equipamnetos');
  assert.ok(erro?.sugestoes.includes('equipamentos'));
  assert.ok(!r.palavras.some(p => p.palavra === 'boroscopia'));
});
