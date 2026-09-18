# Horas previstas no acompanhamento

O cronograma, os cards e os detalhes (inclusive agrupamentos) usam a mesma previsão efetiva. A fonte comercial é o `rawRow` de `CommercialProposal`, importado do Access; a revisão usada é a selecionada em `ProjectBudget.version = 1`, acrescida das propostas de `ProjectAdditionalProposal`. Revisões mais novas não selecionadas não substituem a vigente.

- Horas normais: `hh_util_diurno + hh_util_noturno`.
- Horas extras: `hh_util_extra_diurno + hh_util_extra_noturno + hh_sab_diurno + hh_sab_noturno + hh_dom_diurno + hh_dom_noturno`.
- `hh_total` valida a soma, com tolerância de 0,01 h. As horas já são totais da equipe, sem multiplicação por colaborador.

Quando todas as propostas selecionadas têm total positivo e detalhamento válido, as horas comerciais são usadas automaticamente. Total ausente ou zerado não representa uma previsão útil e mantém o cadastro manual disponível. Dados negativos, componentes ausentes, total inconsistente ou adicionais incompletos não substituem a previsão manual; o cronograma informa o problema. Não se soma uma previsão comercial parcial ao total manual, evitando duplicidade e subestimação.

## Divergências

Quando há horas manuais cadastradas, compara-se cada categoria (normais, extras e total) com o comercial. Diferença absoluta **acima de 10% do valor comercial** gera pendência. Exatamente 10% não gera pendência. Se uma categoria comercial é zero, diferença manual superior a 0,01 h também exige conferência. Comparar as categorias evita esconder divergências que se compensam no total.

A pendência aparece no card/detalhe do projeto e no topo do cronograma, com atalho para a tabela de comparação. Enquanto estiver pendente, continuam valendo as horas manuais. O gestor pode:

1. **Usar horas do comercial**: passa a usar a previsão comercial sem apagar os lançamentos manuais.
2. **Confirmar horas manuais**: mantém os lançamentos manuais para os valores conferidos.
3. Editar as horas manuais e salvar antes de confirmar a decisão.

A decisão é salva imediatamente, identificando usuário, data, valores e assinatura dos dados conferidos em `Project.plannedHoursResolution`. Ela vale somente para aquele conjunto de propostas e horas. Uma mudança nesses dados volta a ser comparada e pode reabrir a pendência. Alterações irrelevantes em outros campos comerciais e novas importações idênticas não a reabrem.

O cronograma verifica atualizações ao retornar à aba, ao reconectar e após mutações relacionadas. Alterações locais ainda não salvas são preservadas. Tentativas de salvar ou resolver usando uma versão antiga das horas recebem HTTP 409 e pedem atualização. O endpoint de resolução exige a mesma permissão de gestor que a edição do cronograma.

## Publicação e verificação

Aplicar a migration `20260917180000_commercial_planned_hours` e regenerar o Prisma Client antes de iniciar o backend atualizado. Não há backfill destrutivo: projetos existentes passam pela seleção de fonte durante a consulta e os registros manuais permanecem guardados.

Testes de regras em `backend/test/acompanhamento-planned-hours.test.js`. Teste HTTP com PostgreSQL em `backend/test/acompanhamento-planned-hours.integration.test.js`, habilitado por `PLANNED_HOURS_TEST_DATABASE_URL` apontando explicitamente para um banco cujo nome termine em `_test`, com migrations aplicadas. Esse teste cobre origem automática, fallback, permissões, preservação manual, decisão, revisão/adicionais, reabertura, concorrência por versão e totais/alertas em cards, detalhe e agrupamento.
