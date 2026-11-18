# Feature Specification: Aba Colaboradores no Acompanhamento

**Feature Branch**: `009-colaboradores`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Nova aba 'Colaboradores' no módulo de Acompanhamento para acompanhar produtividade e calendário de alocação da equipe operacional, além do cálculo da Taxa de Improdutividade individual e geral (referência de 161 HH produtivas/mês, horas extras excluídas)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Taxa de Improdutividade da equipe operacional (Priority: P1)

Um gestor abre a aba **Colaboradores** e vê, para o ano analisado, a **Taxa Geral de Improdutividade** da equipe operacional e, por colaborador, a média mensal de HH produtivas, o total/acumulado anual de HH produtivas e a Taxa de Improdutividade individual. Isso permite ao gerente enxergar objetivamente o quanto a equipe está aquém (ou não) da referência de 161 HH produtivas por mês.

**Why this priority**: É o indicador explicitamente pedido pelo gerente e a principal justificativa da feature. Entrega valor mesmo sem o calendário de alocação, pois responde "quão produtiva está a equipe?" de forma numérica e auditável.

**Independent Test**: Com dados de ponto já existentes no sistema, abrir a aba e conferir que cada colaborador tem sua média mensal, acumulado anual e taxa individual calculados pelas fórmulas definidas, e que a Taxa Geral corresponde à média das taxas individuais dos colaboradores analisados.

**Acceptance Scenarios**:

1. **Given** um colaborador com HH produtivas registradas em vários meses do ano, **When** o gestor abre a aba Colaboradores, **Then** o sistema mostra a soma total de HH produtivas, a média mensal (total ÷ meses analisados) e a média/acumulado anual desse colaborador.
2. **Given** um colaborador cuja média mensal realizada é menor que 161 HH, **When** a taxa é calculada, **Then** a Taxa de Improdutividade individual = (161 − média mensal realizada) ÷ 161, apresentada em percentual.
3. **Given** um colaborador cuja média mensal realizada é igual ou maior que 161 HH, **When** a taxa é calculada, **Then** a Taxa de Improdutividade individual é exibida como 0%.
4. **Given** N colaboradores analisados com suas taxas individuais, **When** a Taxa Geral é calculada, **Then** ela é igual à soma das taxas individuais ÷ N (quantidade de colaboradores analisados).
5. **Given** colaboradores com horas extras registradas no ponto, **When** as HH produtivas são somadas, **Then** as horas extras NÃO entram no total de HH produtivas.

---

### User Story 2 - Calendário/visão de alocação dos colaboradores (Priority: P2)

Um gestor precisa saber, de forma rápida, **onde cada colaborador esteve, onde está atualmente e quais estão disponíveis**. Na aba Colaboradores há uma visão de alocação por colaborador ao longo do tempo (por projeto/obra, sede ou folga), com destaque para a situação atual e para quem está disponível para nova alocação.

**Why this priority**: É o segundo objetivo central da feature ("acompanhar o calendário de alocação"). Depende do mesmo cruzamento ponto × RDO que já sustenta o custo de mão de obra, mas é independente dos indicadores da US1 — pode ser entregue e testado separadamente.

**Independent Test**: Escolher um colaborador com dias em projeto e dias sem projeto e verificar que a visão de alocação mostra corretamente, por período, em qual projeto/obra ele esteve, quando esteve na sede e quando esteve disponível/folga, além de destacar a alocação mais recente.

**Acceptance Scenarios**:

1. **Given** um colaborador com dias trabalhados vinculados a um projeto (via RDO), **When** o gestor abre sua visão de alocação, **Then** o sistema mostra os períodos em que ele esteve alocado a cada projeto/obra.
2. **Given** um colaborador com ponto batido em dias sem projeto, **When** o gestor consulta a alocação, **Then** esses dias aparecem como "sede/disponível" (não alocado a projeto).
3. **Given** o conjunto de colaboradores, **When** o gestor filtra por "disponíveis", **Then** o sistema lista os colaboradores cuja situação atual não é alocação a um projeto.

---

### User Story 3 - Consulta individual de produtividade do colaborador (Priority: P3)

Um gestor abre o detalhe de um colaborador específico e vê o desdobramento mensal das suas HH produtivas ao longo do ano, para entender em quais meses ele ficou acima ou abaixo da referência de 161 HH.

**Why this priority**: Aprofunda a US1, mas não é essencial para o número principal. Ajuda a interpretar a taxa individual sem ser bloqueante.

**Independent Test**: Abrir o detalhe de um colaborador e conferir que os valores mensais somados batem com o total anual e que a média mensal exibida corresponde ao total ÷ meses analisados.

**Acceptance Scenarios**:

1. **Given** um colaborador com HH produtivas distribuídas em vários meses, **When** o gestor abre seu detalhe, **Then** vê o valor de HH produtivas de cada mês e a comparação com a referência de 161 HH.

---

### Edge Cases

- **Colaborador sem nenhuma HH produtiva no período analisado**: como ele entra (ou não) na média mensal, na taxa individual e na contagem de colaboradores da Taxa Geral? Ver [NEEDS CLARIFICATION] sobre escopo e denominador.
- **Colaborador ativo por poucos meses (entrada/saída no meio do ano)**: o denominador "meses analisados" deve refletir só os meses ativos — ver [NEEDS CLARIFICATION] sobre contagem de meses.
- **Mês parcial** (o período de dados cobre só parte de um mês): esse mês conta como mês inteiro no denominador? (Alinha com o tratamento de mês parcial já existente no custo de mão de obra.)
- **Média mensal exatamente igual a 161 HH**: taxa = 0% (limite inferior tratado como "sem improdutividade").
- **Colaborador não operacional (administrativo/sede)**: entra ou não na "equipe operacional" da Taxa Geral? Ver [NEEDS CLARIFICATION] sobre escopo.
- **Ausência de dados de ponto para o ano selecionado**: a aba deve exibir estado vazio claro, sem erro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O módulo de Acompanhamento MUST oferecer uma nova seção/aba **Colaboradores**, acessível pela navegação interna do módulo, preservando o estado ao atualizar a página.
- **FR-002**: O sistema MUST reutilizar as HH produtivas já registradas no ponto existente (horas normais), sem exigir um novo importador de planilha para esta feature.
- **FR-003**: O sistema MUST tratar como **HH produtivas apenas as horas normais** do ponto; horas extras (e adicionais correlatos) NÃO são contabilizadas como HH produtivas.
- **FR-004**: Para cada colaborador analisado, o sistema MUST somar todas as HH produtivas do período analisado (o ano) e apresentar esse **total/acumulado anual**.
- **FR-005**: Para cada colaborador, o sistema MUST calcular a **média mensal de HH produtivas** = total de HH produtivas ÷ quantidade de meses analisados.
- **FR-006**: O sistema MUST usar **161 HH produtivas por mês** como referência de comparação (valor configurável não é exigido nesta v1; ver Assumptions).
- **FR-007**: Para cada colaborador, o sistema MUST calcular a **Taxa de Improdutividade individual** = (161 − média mensal realizada) ÷ 161, apresentada em percentual.
- **FR-008**: Quando a média mensal realizada for **≥ 161 HH**, o sistema MUST apresentar a Taxa de Improdutividade individual como **0%** (sem valores negativos).
- **FR-009**: O sistema MUST calcular a **Taxa Geral de Improdutividade da equipe operacional** = soma das taxas individuais ÷ quantidade de colaboradores analisados.
- **FR-010**: A aba MUST apresentar, de forma consolidada: média mensal de HH produtivas por colaborador, média/acumulado anual por colaborador, Taxa de Improdutividade por colaborador e a Taxa Geral da equipe.
- **FR-011**: O sistema MUST identificar o **período analisado** (ano) a que os indicadores se referem e deixar claro qual ano está sendo exibido.
- **FR-012**: A aba MUST apresentar uma **visão de alocação por colaborador** indicando, ao longo do tempo, em qual projeto/obra ele esteve, quando esteve na sede (não alocado) e a sua **situação atual**.
- **FR-013**: O sistema MUST permitir distinguir os colaboradores **disponíveis** (situação atual não alocada a um projeto) dos alocados.
- **FR-014**: A aba MUST tratar com clareza colaboradores sem dados de ponto no período (estado vazio), sem quebrar o cálculo da Taxa Geral.
- **FR-015**: O acesso à aba Colaboradores MUST ser **restrito ao perfil gestor (manager)** do Acompanhamento, no mesmo padrão da seção Custo; o perfil visualizador (viewer) NÃO acessa a aba nem seus indicadores de produtividade individual.
- **FR-016**: A **equipe operacional** considerada na Taxa Geral MUST incluir **apenas colaboradores de função operacional/campo**, excluindo administrativo/escritório. Como a base atual de colaboradores **não** possui hoje uma marcação operacional/administrativo (o cadastro tem `role`/cargo como texto e uma lista gerenciável de cargos, sem essa classificação), a feature MUST introduzir um critério gerenciável para distinguir operacional de administrativo (ex.: sinalização por cargo/JobRole ou por colaborador), e apenas os operacionais entram no cálculo da Taxa Geral.
- **FR-017**: A **quantidade de "meses analisados"** (denominador da média mensal) MUST ser o número de **meses-calendário do ano em que o colaborador tem registro de ponto** (meses ativos). Um mês com qualquer registro de ponto conta como **1 mês inteiro**, inclusive meses parciais (entrada/saída no meio do mês).

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Nova seção "Colaboradores" no módulo Acompanhamento | `frontend/src/pages/acompanhamento/AcompanhamentoPage.tsx` (nav `equip-nav` + `equip-mobile-nav`; seções dashboard/projetos/sede/custo) | Reusar `equip-nav-item`, `equip-mobile-nav` (`select`), shell `equip-page`/`equip-layout`/`equip-content`; componentes do kit em `frontend/src/components/ui/` | `select` de ano/filtros herdando estilo global de `base.css`; nenhum dropdown cru | N/A (sem reordenação por drag and drop) | Estado da aba via query param `?section=colaboradores` (padrão das outras seções); ano/filtro via query param quando compartilhável | Função nova em módulo existente → campanha temporária de novidade (card `driver.js`, 10 dias corridos a partir da data de implementação, "visto" em `localStorage` por usuário/navegador), no padrão do aviso de DDS/agrupamento já usado em Acompanhamento; **não** é tutorial permanente | Tabela de indicadores por colaborador DEVE virar cards empilhados em telas estreitas; valores de HH e percentuais quebram/truncam sem gerar scroll horizontal de página; barra de seções cabe na largura do módulo (já resolvido pelo `equip-mobile-nav`) |
| Board de indicadores (lista/tabela de colaboradores + Taxa Geral) | `frontend/src/components/projects/SedeCostsBoard.tsx` e `ProjectCardsBoard.tsx` (boards análogos da mesma seção) | Padrão de board existente do módulo (cabeçalho + cards/tabela); `Skeleton` do kit para carregamento; `Toast` para erros | Filtro de ano/colaborador com `select`/SearchBar do kit | N/A | Seleção de colaborador/detalhe refletida em query param (`?colaborador=...`) para sobreviver a refresh | Coberto pela campanha de novidade da linha acima | Cartão de colaborador com métricas (HH mês, acumulado, taxa) empilha em mobile; badge de "disponível/alocado" trunca sem estourar |

### Key Entities *(include if feature involves data)*

- **Colaborador**: pessoa da equipe cuja produtividade e alocação são acompanhadas. Atributos relevantes: identificação/nome, vínculo com registros de ponto, marcação de operacional/administrativo (se existir) e período de atividade no ano.
- **Registro de HH produtivas (ponto)**: horas normais registradas por colaborador por dia/mês; base para os totais e médias. Exclui horas extras.
- **Indicador de Improdutividade (individual)**: derivado — média mensal realizada, acumulado anual, taxa individual, comparação com 161 HH.
- **Taxa Geral de Improdutividade (equipe)**: derivado — média das taxas individuais dos colaboradores analisados no período.
- **Alocação do colaborador**: associação, ao longo do tempo, entre colaborador e projeto/obra (via RDO), sede (ponto sem projeto) ou folga; inclui a situação atual e a noção de "disponível".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um gestor consegue, em menos de 1 minuto após abrir a aba, identificar a Taxa Geral de Improdutividade da equipe e os colaboradores com maior taxa individual no ano.
- **SC-002**: Para qualquer colaborador, a média mensal exibida é reproduzível manualmente: total de HH produtivas ÷ meses analisados, com diferença de arredondamento ≤ 0,1 HH.
- **SC-003**: 100% dos colaboradores com média mensal ≥ 161 HH aparecem com Taxa de Improdutividade 0% (nunca negativa).
- **SC-004**: A Taxa Geral exibida é igual à média aritmética das taxas individuais dos colaboradores analisados (diferença de arredondamento ≤ 0,1 ponto percentual).
- **SC-005**: Horas extras não alteram nenhum total de HH produtivas — ignorar as horas extras de um colaborador não muda sua média mensal nem sua taxa.
- **SC-006**: Um gestor consegue identificar, para um colaborador escolhido, onde ele esteve alocado ao longo do ano e se está disponível atualmente, sem sair da aba.

## Assumptions

- As HH produtivas correspondem às **horas normais** do ponto já existente no sistema (não às horas extras). Reutiliza-se a base atual de ponto/mão de obra do módulo Acompanhamento; **não** haverá novo importador de planilha nesta feature. Os dados já estão persistidos por colaborador com desdobramento mensal (`workedMinutes` = produtivas; `he70/he100Minutes` = extras excluídas; `monthly` por `YYYY-MM`), viabilizando total anual, média mensal e contagem de meses ativos sem nova ingestão.
- A base de colaboradores **não** possui hoje classificação operacional/administrativo; a feature introduzirá esse critério gerenciável (por cargo ou por colaborador) para delimitar a equipe operacional da Taxa Geral.
- Acesso à aba é **restrito ao gestor (manager)** do Acompanhamento, como a seção Custo.
- "Meses analisados" = meses do ano com registro de ponto do colaborador (meses ativos); mês parcial conta como 1 mês inteiro.
- O **período de férias já está embutido** na referência de 161 HH/mês; o app **não** precisa identificar férias.
- O período analisado padrão é o **ano corrente**, com possibilidade de escolher o ano exibido (informado, não bloqueante).
- A alocação por projeto/obra vem do mesmo cruzamento **ponto × RDO** já usado no custo de mão de obra (`backend/src/lib/acompanhamento/labor-cost.js`): dia com projeto (RDO) = alocado; dia com ponto sem projeto = sede/disponível; dia útil sem ponto = folga.
- A referência de 161 HH é fixa nesta v1 (não é exigido torná-la configurável), embora a derivação (176 × 11 ÷ 12) fique documentada.
- A aba segue o padrão visual e de navegação das seções existentes do Acompanhamento (shell `equip-page`, nav por `?section=`).
- A feature respeita o Princípio I (nenhum comando de servidor executado automaticamente) e a stack fixa (React/Express/Prisma/Zod).
