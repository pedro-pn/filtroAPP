import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server,
  motor,
  FaseCard,
  MaoDeObraSection,
  PendenciasDaSecao,
  faltaMaoDeObra;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  });
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
  ({ FaseCard } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/FaseCard.tsx'
  ));
  ({ MaoDeObraSection } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/MaoDeObraSection.tsx'
  ));
  ({ PendenciasDaSecao } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/PendenciasDaSecao.tsx'
  ));
  ({ faltaMaoDeObra } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/pendencias.ts'
  ));
});
test.after(async () => {
  await server?.close();
});

function estado(editar, visivel = true) {
  const draft = motor.createDefaultCostEstimatePayload();
  draft.laborContexts = [draft.laborContexts[0]];
  const fase = draft.laborContexts[0];
  Object.assign(fase, {
    name: 'Execução',
    workCondition: 'headquarters',
    workConditionConfirmed: true,
    vehicleType: 'none'
  });
  editar?.(fase, draft);
  const result = motor.calculateEstimate(draft);
  const erros = new Map(
    motor
      .validateCostEstimate(draft)
      .errors.map((item) => [item.path, item.message])
  );
  return {
    draft,
    result,
    errosPorCampo: erros,
    errosVisiveis: visivel,
    erroDe: (caminho) => (visivel ? erros.get(caminho) : undefined),
    erroSe: (condicao, mensagem) =>
      visivel && condicao ? mensagem : undefined,
    resultadoDaFase: (id) =>
      result.contextResults.find((item) => item.contextId === id) || {},
    setDraft: () => {},
    updateCollection: () => {},
    removeCollection: () => {},
    updateNested: () => {},
    addNested: () => {},
    removeNested: () => {}
  };
}

function renderizarFase(levantamento) {
  return renderToStaticMarkup(
    createElement(FaseCard, {
      fase: levantamento.draft.laborContexts[0],
      indice: 0,
      total: 1,
      levantamento
    })
  );
}

test('pendência de jornada offshore aparece no campo Dias corridos e na lista com o nome da fase', () => {
  const levantamento = estado((fase) => {
    fase.workCondition = 'offshore';
    fase.durationDays = 22;
  });
  assert.equal(faltaMaoDeObra(levantamento.draft), true);
  const html = renderizarFase(levantamento);
  assert.match(html, /Dias corridos<\/label><input[^>]*aria-invalid="true"/);
  assert.match(
    html,
    /A escala offshore pode ter no máximo 21 dias consecutivos/
  );
  const resumo = renderToStaticMarkup(
    createElement(PendenciasDaSecao, { levantamento, secao: 'labor' })
  );
  assert.match(resumo, /Fase 1 — Execução/);
  assert.match(resumo, /máximo 21 dias/);
});

test('quantidade nominal e nome do colaborador têm erros vinculados aos seus controles', () => {
  const levantamento = estado((fase) => {
    const alocacao = fase.assignments[0];
    alocacao.quantity = 2;
    alocacao.workSchedule = {
      targetType: 'collaborator',
      collaboratorName: '',
      days: [
        {
          dayType: 'weekday',
          days: 5,
          normalHoursPerDay: 8,
          extraHoursPerDay: 0,
          overtimePercent: 70
        }
      ]
    };
  });
  const html = renderizarFase(levantamento);
  assert.match(
    html,
    /aria-label="Quantidade de pessoas"[^>]*aria-invalid="true"/
  );
  assert.match(
    html,
    /Uma jornada nominal deve representar exatamente um colaborador/
  );
  assert.match(html, /Informe o colaborador ao qual esta jornada se aplica/);
  assert.match(
    html,
    /<details class="com-jornada-card">[\s\S]*?aria-invalid="true"/
  );
});

test('horas extras inválidas aparecem no dia correto mesmo se a jornada foi salva fora de ordem', () => {
  const levantamento = estado((fase) => {
    fase.assignments[0].workSchedule = {
      targetType: 'role',
      days: [
        {
          dayType: 'saturday',
          days: 1,
          normalHoursPerDay: 0,
          extraHoursPerDay: 4,
          overtimePercent: 0
        },
        {
          dayType: 'weekday',
          days: 5,
          normalHoursPerDay: 8,
          extraHoursPerDay: 20,
          overtimePercent: 70
        }
      ]
    };
  });
  const html = renderizarFase(levantamento);
  assert.match(
    html,
    /Dias úteis[\s\S]*?A soma das horas normais e extras não pode ultrapassar 24 horas por dia/
  );
  assert.match(
    html,
    /Sábados[\s\S]*?Informe o percentual aplicado à hora extra/
  );
});

test('valor do combustível obrigatório zerado recebe erro no campo editável', () => {
  const levantamento = estado((fase) => {
    fase.workCondition = 'travel';
    fase.vehicleType = 'sedan';
    fase.expenses.find(
      (item) => item.code === motor.HOTEL_SITE_COMMUTE_EXPENSE_CODE
    ).unitValue = 0;
  });
  assert.match(
    renderizarFase(levantamento),
    /aria-label="Valor unitário"[^>]*aria-describedby="[^"]+-despesas-erro"[^>]*aria-invalid="true"/
  );
});

test('ausência de equipe indica adicionar colaboradores ou confirmar sem mão de obra', () => {
  const levantamento = estado((fase) => {
    fase.assignments = [];
  });
  const html = renderToStaticMarkup(
    createElement(MaoDeObraSection, { levantamento })
  );
  assert.match(
    html,
    /Adicione colaboradores ou confirme que este levantamento não terá mão de obra/
  );
  assert.match(html, /type="checkbox"[^>]*aria-invalid="true"/);
});

test('normalização da despesa obrigatória não cria bloqueio sem campo pendente', () => {
  const levantamento = estado((fase) => {
    fase.workCondition = 'travel';
    fase.vehicleType = 'sedan';
    fase.expenses.find(
      (item) => item.code === motor.HOTEL_SITE_COMMUTE_EXPENSE_CODE
    ).included = false;
  });
  assert.equal(faltaMaoDeObra(levantamento.draft), false);
});

test('abrir Mão de obra sem tentar salvar mantém a validação visual oculta', () => {
  const levantamento = estado((fase) => {
    fase.workConditionConfirmed = false;
  }, false);
  assert.doesNotMatch(renderizarFase(levantamento), /aria-invalid="true"/);
  assert.equal(
    renderToStaticMarkup(
      createElement(PendenciasDaSecao, { levantamento, secao: 'labor' })
    ),
    ''
  );
});
