# Phase 0 — Research: Aba Colaboradores

Consolidação das decisões técnicas. As clarificações de negócio foram resolvidas com o usuário e estão em `spec.md` (FR-015/016/017 e Assumptions).

## D1. Fonte das HH produtivas

- **Decisão**: Usar `PontoPeriodSummary` (Prisma) como fonte das HH produtivas, sem novo importador.
- **Rationale**: O modelo já persiste, por colaborador e por importação: `workedMinutes` (horas normais = produtivas), `he70Minutes`/`he100Minutes` (horas extras), `nightMinutes`, `workedDates[]` e um JSON `monthly` no formato `{ "YYYY-MM": { normalMinutes, extrasMinutes, nightMinutes, workedDates[] } }`. Isso cobre total anual, desdobramento mensal e contagem de meses ativos diretamente.
- **HH produtivas = horas normais** (`workedMinutes` / `monthly[].normalMinutes`), convertidas de minutos para horas (÷ 60). As horas extras (`he70/he100`) são explicitamente ignoradas (FR-003).
- **Alternativas consideradas**: (a) novo importador de planilha de ponto — rejeitado por duplicar ingestão já existente e contrariar decisão do usuário; (b) reprocessar o `.xlsx` a cada leitura via `ponto-parser.js` — rejeitado por custo e por já haver sumarização persistida.

## D2. Agregação anual entre múltiplas importações

- **Decisão**: Agregar todos os `PontoPeriodSummary` de um colaborador que intersectam o ano analisado, reutilizando/estendendo a lógica de `mergePontoPeriods()` de `labor-cost.js`.
- **Rationale**: Um ano pode ser coberto por várias importações (períodos distintos). `mergePontoPeriods` já resolve sobreposição/mesclagem de períodos por colaborador; o cálculo anual soma os minutos normais por mês (`monthly`) restritos aos meses `YYYY-MM` do ano.
- **Meses ativos** = quantidade de chaves `YYYY-MM` do ano com `normalMinutes > 0` (ou com qualquer registro de ponto do colaborador, conforme FR-017). Mês parcial conta como 1 mês inteiro.
- **Alternativas**: contar meses corridos do ano ou meses-calendário completos — rejeitadas pela decisão do usuário (FR-017: meses ativos, mês parcial = 1).

## D3. Fórmulas dos indicadores

- **Decisão**: Implementar em `collaborator-productivity.js` funções puras e testáveis:
  - `mediaMensal = totalHHprodutivas / mesesAtivos`
  - `taxaIndividual = mesesAtivos > 0 ? max(0, (161 - mediaMensal) / 161) : indefinido` (piso 0% quando média ≥ 161).
  - `taxaGeral = Σ taxaIndividual / N`, onde N = quantidade de colaboradores operacionais analisados.
- **Rationale**: Espelha exatamente as fórmulas do spec (FR-005/007/008/009). Funções puras permitem testes unitários determinísticos (Princípio V).
- **Arredondamento**: manter precisão interna; arredondar só na apresentação (HH com 1 casa; taxa em %). Ver SC-002/SC-004 (tolerância ≤ 0,1).
- **Referência 161**: constante nomeada (ex.: `HH_PRODUTIVAS_REF = 161`) com comentário da derivação `176 × 11 ÷ 12`. Fixa nesta v1 (FR-006).
- **Colaborador sem meses ativos**: não entra no denominador da Taxa Geral (evita divisão por zero e não infla a taxa). Documentado como edge case.

## D4. Classificação operacional × administrativo

- **Decisão**: Introduzir a classificação **por cargo (`JobRole`)**, adicionando `isOperational Boolean @default(true)` ao modelo `JobRole`, gerenciável no `JobRoleManager.tsx`. Colaborador é operacional se seu cargo estiver marcado como operacional.
- **Rationale**: Hoje `Collaborator.role` é texto livre e existe a lista gerenciável `JobRole` (cargos). Classificar por cargo evita marcar colaborador a colaborador e centraliza a regra onde os cargos já são gerenciados. `default(true)` preserva o comportamento atual (todos operacionais) até o gestor ajustar; um backfill idempotente opcional pode marcar cargos administrativos conhecidos.
- **Alternativas consideradas**: (a) flag por `Collaborator` — rejeitada por exigir manutenção individual e não aproveitar a lista de cargos; (b) lista fixa de nomes de cargos administrativos hardcoded — rejeitada por não ser gerenciável e frágil a novos cargos; (c) inferir por quem teve dias em projeto (RDO) — rejeitada porque a decisão do usuário foi "função operacional/campo", não "quem foi alocado".
- **Ponto de atenção**: o vínculo colaborador→cargo precisa ser resolvível. `Collaborator.role` é texto; a associação a `JobRole` será verificada na Phase 1/data-model (mapear `role` → `JobRole.name`, ou usar `CostProfile`/`jobRoleId` quando existir). Se o vínculo não for confiável, fallback documentado: tratar como operacional (default) e permitir ao gestor reclassificar.

## D5. Visão de alocação (onde estava / onde está / disponível)

- **Decisão**: Derivar a alocação do cruzamento **ponto × RDO** já existente, reutilizando `rdoDataByCollaboratorFromReports()` e a lógica de classificação diária de `labor-cost.js` (dia com projeto = alocado; dia com ponto sem projeto = SEDE/disponível; dia útil sem ponto = folga).
- **Rationale**: Evita nova fonte de verdade. A "situação atual" = classificação do dia/registro mais recente do colaborador; "disponível" = situação atual do tipo SEDE (ponto sem projeto). Períodos por projeto = agrupamento contíguo dos `workedDates` por projeto do RDO.
- **Alternativas**: criar uma entidade explícita de alocação/escala — rejeitada como sobre-engenharia para v1, sem fonte de dados nova disponível.
- **NEEDS CLARIFICATION residual (não bloqueante para o plano)**: granularidade da linha do tempo (diária vs. por período de projeto) e janela histórica exibida — decidir no design da UI (Phase 1/quickstart), com default: linha por projeto/obra no ano + destaque da situação atual.

## D6. Rota, permissão e validação

- **Decisão**: Nova rota `GET /api/acompanhamento/colaboradores` protegida por `requireAuth` + `requireAcompanhamentoManager` (manager-only, FR-015), com query `year` (default: ano corrente) e filtros opcionais, validados por Zod. Registrada em `backend/src/routes/index.js` ao lado de `acompanhamento-custo`/`acompanhamento-ponto`.
- **Rationale**: `requireAcompanhamentoManager` já é o guard usado pela seção Custo; reaproveita o padrão de rota do módulo. Contrato detalhado em `contracts/colaboradores-api.md`.
- **Escrita** (classificação de cargo): reutilizar/estender o endpoint existente de gestão de `JobRole` (usado pelo `JobRoleManager`) para incluir `isOperational` — evita rota nova só para o toggle.

## D7. Frontend — board e navegação

- **Decisão**: Adicionar `section = 'colaboradores'` em `AcompanhamentoPage.tsx` (nav desktop `equip-nav` + `equip-mobile-nav` + switch de conteúdo), visível só para manager. Novo `CollaboratorsBoard.tsx` no padrão de `SedeCostsBoard`, consumindo um hook react-query novo. Detalhe do colaborador via `?colaborador=...`.
- **Rationale**: Segue o Princípio VI (tela análoga, componentes do kit, navegação por query param). Manager-only espelha o tratamento já feito para a seção `custo` na página.
- **Novidade**: `CollaboratorsNovelty.tsx` no padrão dos `*Novelty.tsx` (driver.js), 10 dias a partir da data de implementação, "visto" em localStorage por usuário/navegador.

## Itens sem NEEDS CLARIFICATION pendente

Todas as clarificações de negócio (FR-015/016/017) foram resolvidas. Os pontos residuais (D4 vínculo cargo, D5 granularidade da linha do tempo) são decisões de design de baixo risco, tratadas na Phase 1 com defaults documentados — não bloqueiam o plano.
