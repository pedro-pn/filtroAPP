import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let motor;
let FaseCard;
let CircuitosBloco;
let MaoDeObraSection;
let ProdutosBloco;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
  ({ FaseCard } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/FaseCard.tsx'
  ));
  ({ CircuitosBloco } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/CircuitosBloco.tsx'
  ));
  ({ MaoDeObraSection } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/MaoDeObraSection.tsx'
  ));
  ({ ProdutosBloco } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/ProdutosBloco.tsx'
  ));
});

test.after(async () => {
  await server?.close();
});

function levantamento() {
  const draft = motor.createDefaultCostEstimatePayload();
  const result = motor.calculateEstimate(draft);
  return {
    draft,
    result,
    assumptions: draft.assumptions,
    setDraft: () => {},
    updateCollection: () => {},
    removeCollection: () => {},
    updateNested: () => {},
    removeNested: () => {},
    addNested: () => {},
    erroSe: () => undefined,
    resultadoDaFase: (id) =>
      result.contextResults.find((item) => item.id === id) || {}
  };
}

function encontrarElemento(no, predicado) {
  if (Array.isArray(no)) {
    for (const filho of no) {
      const encontrado = encontrarElemento(filho, predicado);
      if (encontrado) return encontrado;
    }
    return undefined;
  }
  if (!no || typeof no !== 'object') return undefined;
  if (predicado(no)) return no;
  return encontrarElemento(no.props?.children, predicado);
}

test('Adicionar fase cria uma fase completa e com identificadores próprios', () => {
  const estado = levantamento();
  estado.draft.scopeConfirmations.mobilizationCrewAlreadyOnSite = true;
  estado.draft.scopeConfirmations.demobilizationCrewAlreadyOnSite = true;
  estado.setDraft = atualizador => {
    estado.draft = atualizador(estado.draft);
  };
  const faseOriginal = estado.draft.laborContexts[0];
  const arvore = MaoDeObraSection({ levantamento: estado });
  const botao = encontrarElemento(
    arvore,
    no => no.type === 'button' && no.props?.children === '+ Adicionar fase'
  );

  assert.equal(typeof botao?.props?.onClick, 'function');
  botao.props.onClick();

  assert.equal(estado.draft.laborContexts.length, 2);
  assert.equal(estado.draft.scopeConfirmations.noLabor, false);
  assert.equal(estado.draft.scopeConfirmations.mobilizationCrewAlreadyOnSite, false);
  assert.equal(estado.draft.scopeConfirmations.demobilizationCrewAlreadyOnSite, false);
  const adicionada = estado.draft.laborContexts[1];
  assert.equal(adicionada.name, 'Etapa 1');
  assert.equal(adicionada.startOffsetDays, 30);
  assert.equal(adicionada.assignments[0].role, 'OPERADOR');
  assert.notEqual(adicionada.id, faseOriginal.id);
  assert.notEqual(adicionada.assignments[0].id, faseOriginal.assignments[0].id);
  assert.notEqual(adicionada.expenses[0].id, faseOriginal.expenses[0].id);
});

test('Incluir mão de obra reativa as fases preservadas sem duplicá-las', () => {
  const estado = levantamento();
  estado.draft.scopeConfirmations.noLabor = true;
  estado.setDraft = atualizador => {
    estado.draft = atualizador(estado.draft);
  };
  const arvore = MaoDeObraSection({ levantamento: estado });
  const botao = encontrarElemento(
    arvore,
    no => no.type === 'button' && no.props?.children === 'Incluir mão de obra'
  );

  botao.props.onClick();

  assert.equal(estado.draft.scopeConfirmations.noLabor, false);
  assert.equal(estado.draft.laborContexts.length, 1);
});

test('produto oferece dimensionamento único para todos os circuitos', () => {
  const html = renderToStaticMarkup(
    createElement(ProdutosBloco, { levantamento: levantamento() })
  );

  assert.match(html, /<option value="\*">Todos os circuitos<\/option>/);
});

test('produto excluído pode ser restaurado com todos os seus dados', () => {
  const estado = levantamento();
  estado.setDraft = atualizador => {
    estado.draft = atualizador(estado.draft);
  };
  const produtoOriginal = { ...estado.draft.products[0] };
  let arvore = ProdutosBloco({ levantamento: estado });
  const remover = encontrarElemento(
    arvore,
    no => no.type === 'button' && no.props?.['aria-label'] === `Remover ${produtoOriginal.productName}`
  );

  remover.props.onClick();

  assert.equal(estado.draft.products.some(item => item.id === produtoOriginal.id), false);
  assert.deepEqual(estado.draft.deletedProducts, [produtoOriginal]);
  assert.deepEqual(
    motor.normalizeCostEstimatePayload(estado.draft).deletedProducts,
    [produtoOriginal],
    'a lixeira deve sobreviver ao salvamento automático do rascunho'
  );

  arvore = ProdutosBloco({ levantamento: estado });
  const restaurar = encontrarElemento(
    arvore,
    no => no.type === 'button' && no.props?.['aria-label'] === 'Restaurar linhas excluídas'
  );
  restaurar.props.onClick();

  assert.deepEqual(
    estado.draft.products.find(item => item.id === produtoOriginal.id),
    produtoOriginal
  );
  assert.deepEqual(estado.draft.deletedProducts, []);
  assert.equal(estado.draft.scopeConfirmations.noInputs, false);
});

test('fases de mão de obra oferecem controle para minimizar sem remover dados', () => {
  const estado = levantamento();
  const html = renderToStaticMarkup(
    createElement(FaseCard, {
      fase: estado.draft.laborContexts[0],
      indice: 0,
      total: 1,
      levantamento: estado
    })
  );

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, />Minimizar<\/button>/);
  assert.match(html, /id="pre-engenharia-conteudo"/);
});

test('pedágio da frota inicia preenchido com R$ 0,20 por km', () => {
  const draft = motor.createDefaultCostEstimatePayload();
  assert.ok(draft.logistics.length > 0);
  assert.ok(draft.logistics.every(item => item.tollPerVehicleKm === 0.2));

  const caminhao = motor.normalizeCostEstimatePayload({
    ...draft,
    logistics: [{
      ...draft.logistics[0],
      calculationMode: 'company_truck_driver',
      tollPerVehicleKm: undefined
    }]
  });
  assert.equal(caminhao.logistics[0].tollPerVehicleKm, 0.2);
});

test('veículo continua obrigatório, mas oferece a decisão explícita "Sem veículo"', () => {
  const estado = levantamento();
  const html = renderToStaticMarkup(
    createElement(FaseCard, {
      fase: estado.draft.laborContexts[0],
      indice: 0,
      total: 1,
      levantamento: estado
    })
  );

  assert.match(html, /Veículo da equipe/);
  assert.match(html, /value="none">Sem veículo/);
  assert.match(html, /Cenários de jornada/);
  assert.match(html, /Aplicar este horário para toda a equipe/);
  assert.match(html, /Percentual da HE/);
});

test('os circuitos existentes nascem minimizados e mantêm nome e volume no resumo', () => {
  const estado = levantamento();
  const html = renderToStaticMarkup(
    createElement(CircuitosBloco, { levantamento: estado })
  );

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aço carbono/i);
  assert.match(html, /Abrir para preencher/);
  assert.doesNotMatch(html, /Trechos de tubo/);
});

test('o chrome comercial mantém as barras compactas em custos e proposta', () => {
  const base = readFileSync(
    new URL('../src/styles/base.css', import.meta.url),
    'utf8'
  );
  const css = readFileSync(
    new URL('../src/styles/comercial.css', import.meta.url),
    'utf8'
  );
  const chrome = readFileSync(
    new URL(
      '../src/pages/comercial/components/ComercialChrome.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(chrome, /com-app-\$\{variante\}/);
  assert.match(
    css,
    /\.com-root\.com-app\s*\{[\s\S]*?--com-topbar-height:\s*50px/
  );
  assert.match(css, /\.com-root \.com-topbar\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.com-root \.com-hero\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(
    base,
    /html,\s*body,\s*#root\s*\{[^}]*overflow-x:\s*clip/,
    'ancestral com overflow hidden impede o sticky de acompanhar a janela'
  );
  assert.doesNotMatch(
    base,
    /body\s*\{[^}]*overflow-x:\s*hidden/,
    'body não pode recriar um contêiner de rolagem fora do sticky'
  );
  assert.match(
    css,
    /\.com-root \.com-hero-custos\s*\{\s*padding:\s*6px 3vw 8px/
  );
  assert.match(
    css,
    /\.com-root \.com-hero-proposta\s*\{[\s\S]*?padding:\s*12px 4vw/
  );
});
