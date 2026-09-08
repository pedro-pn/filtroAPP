# Feature Specification: Unificar Missões no Acompanhamento

**Feature Branch**: `006-unificar-missoes-acompanhamento`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Alguns projetos pertencem ao mesmo cliente. Nesses casos, apesar de serem propostas diferentes, pode haver a necessidade de unificar os dados como custos, faturamento, colaboradores, impostos, progresso, tudo. Ou seja, várias missões são tratadas como uma só. Para não perder a independência de calculo, a ideia é que tenha um botão que permita unificar no dashboard algumas missões selecionadas no acompanhamento. Ao fazer isso, os cards selecionados viram um só (mostrando quais missões estão unificadas nesse card). O card separado delas fica ocultado. A operação deve ser reversível, ou seja, clicar para desmesclar essas missões. Isso só afeta o acompanhamento, os demais dados, como relatórios etc ficam de fora."

## Contexto

O módulo de Acompanhamento mostra missões por proposta/projeto, com indicadores de custo, faturamento, colaboradores, impostos, prazos, horas e progresso. Em alguns clientes, propostas diferentes representam uma operação única para fins de acompanhamento gerencial. A necessidade é permitir que o acompanhamento trate missões selecionadas como um único agrupamento visual, sem alterar a independência dos cálculos, cadastros, relatórios, RDOs, Omie ou demais dados operacionais de cada missão.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unificar missões selecionadas (Priority: P1)

O gestor do acompanhamento seleciona duas ou mais missões do mesmo acompanhamento e aciona "Unificar". As missões selecionadas deixam de aparecer como cards separados na visualização do acompanhamento e passam a aparecer como um único card consolidado, identificando claramente quais missões fazem parte do agrupamento.

**Why this priority**: É a capacidade principal da feature; sem ela as propostas continuam separadas e o gestor não consegue enxergar a operação do cliente como uma só.

**Independent Test**: Com três missões visíveis de um cliente, selecionar duas, acionar "Unificar" e confirmar que aparece um card consolidado contendo os dois códigos, enquanto os cards individuais dessas duas missões ficam ocultos e a terceira missão permanece separada.

**Acceptance Scenarios**:

1. **Given** duas ou mais missões visíveis no acompanhamento, **When** o gestor seleciona essas missões e confirma a unificação, **Then** o acompanhamento exibe um único card consolidado para o grupo e oculta os cards individuais selecionados.
2. **Given** um card consolidado, **When** o gestor observa o cabeçalho do card, **Then** ele vê o nome do agrupamento e a lista de missões/propostas incluídas.
3. **Given** um card consolidado, **When** os indicadores são exibidos, **Then** custos, faturamento, impostos, colaboradores, dias, horas e progresso refletem a soma ou consolidação das missões agrupadas conforme as regras de agregação.
4. **Given** uma missão não selecionada, **When** outra seleção é unificada, **Then** a missão não selecionada continua aparecendo e mantendo seus indicadores individuais.

---

### User Story 2 - Desmesclar missões agrupadas (Priority: P1)

O gestor desfaz uma unificação existente diretamente no card consolidado. O agrupamento desaparece e as missões voltam a aparecer como cards independentes, com os mesmos indicadores individuais de antes.

**Why this priority**: A operação precisa ser reversível para que o acompanhamento não fique preso a uma decisão incorreta ou temporária.

**Independent Test**: Com um agrupamento existente, acionar "Desmesclar" e confirmar que o card consolidado some, os cards individuais retornam e os números de cada missão batem com o estado anterior à unificação.

**Acceptance Scenarios**:

1. **Given** um card consolidado, **When** o gestor aciona "Desmesclar", **Then** o sistema remove o agrupamento e restaura os cards individuais das missões agrupadas.
2. **Given** uma desmesclagem concluída, **When** o acompanhamento é recarregado, **Then** o agrupamento não volta a aparecer.
3. **Given** missões desmescladas, **When** o gestor seleciona novamente duas ou mais missões, **Then** ele pode criar um novo agrupamento.

---

### User Story 3 - Preservar independência dos cálculos e demais módulos (Priority: P2)

O acompanhamento consolida os indicadores apenas na visualização. Cada missão continua existindo e calculando seus próprios dados separadamente, e os demais módulos não são alterados pela unificação.

**Why this priority**: O valor do agrupamento depende de não comprometer relatórios, RDOs, dados financeiros, cronograma individual ou rastreabilidade por proposta.

**Independent Test**: Unificar missões e depois abrir relatórios/RDOs/detalhes de uma missão individual fora do card consolidado; confirmar que os dados individuais continuam iguais e que nenhum relatório passa a pertencer ao agrupamento.

**Acceptance Scenarios**:

1. **Given** missões unificadas no acompanhamento, **When** relatórios, RDOs ou outros módulos são consultados, **Then** eles continuam exibindo as missões individualmente, sem referência obrigatória ao agrupamento.
2. **Given** um agrupamento no acompanhamento, **When** uma missão integrante recebe novos dados de custo, faturamento, RDO ou avanço, **Then** o cálculo individual da missão permanece independente e o card consolidado reflete a atualização ao somar/consolidar novamente os dados atuais.
3. **Given** um agrupamento existente, **When** o usuário abre a visualização de detalhes de uma missão integrante, **Then** o detalhe individual da missão permanece acessível.

### Edge Cases

- Seleção com menos de duas missões: a ação de unificar fica indisponível e informa que é necessário selecionar pelo menos duas missões.
- Missão já pertencente a um agrupamento ativo: não pode ser selecionada para outro agrupamento sem antes desmesclar o agrupamento atual.
- Missões em situações diferentes (em andamento, futuras, arquivadas): o card consolidado aparece na situação mais ativa do conjunto (em andamento prevalece sobre futuro; futuro prevalece sobre arquivado; arquivado somente quando todas estiverem arquivadas).
- Missões com clientes diferentes: o sistema deve alertar antes de permitir a unificação, pois o caso padrão esperado é agrupar propostas do mesmo cliente.
- Agrupamento sem nome informado: o sistema usa um nome gerado a partir do cliente e dos códigos das missões.
- Uma missão agrupada é arquivada, reativada ou deixa de existir no acompanhamento: o agrupamento permanece válido para as missões restantes e deixa claro quando uma integrante não está mais visível no acompanhamento.
- Busca e filtros ativos: cards individuais ocultos por agrupamento não reaparecem nos resultados filtrados; o card consolidado aparece quando o termo/filtro combina com o nome do grupo, cliente ou alguma missão integrante.
- Mobile: seleção, botão de unificar, lista de missões agrupadas e ação de desmesclar cabem na largura da tela sem scroll horizontal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O acompanhamento DEVE permitir selecionar duas ou mais missões visíveis para criar um agrupamento.
- **FR-002**: O sistema DEVE oferecer uma ação explícita para unificar as missões selecionadas.
- **FR-003**: O agrupamento criado DEVE aparecer como um único card consolidado no acompanhamento.
- **FR-004**: Cards individuais de missões pertencentes a um agrupamento ativo DEVEM ficar ocultos nas visualizações afetadas do acompanhamento.
- **FR-005**: O card consolidado DEVE mostrar quais missões/propostas fazem parte do agrupamento.
- **FR-006**: O card consolidado DEVE consolidar custos, faturamento, impostos, dias, horas, colaboradores, equipamentos, alertas e progresso das missões integrantes.
- **FR-007**: Valores monetários e contagens DEVEM ser somados; percentuais DEVEM ser recalculados a partir dos totais consolidados quando houver numerador e denominador disponíveis.
- **FR-008**: Progresso físico consolidado DEVE preservar o cálculo individual de cada missão e apresentar uma consolidação ponderada, mantendo também a visibilidade dos progressos individuais das missões integrantes.
- **FR-009**: Colaboradores repetidos em mais de uma missão do grupo DEVEM ser contados uma única vez no indicador consolidado quando a identidade do colaborador estiver disponível.
- **FR-010**: O sistema DEVE permitir desmesclar um agrupamento ativo e restaurar os cards individuais.
- **FR-011**: Criar, editar nome e desmesclar agrupamentos DEVE ser permitido apenas para usuários com permissão de gestão do Acompanhamento; usuários de visualização apenas enxergam o resultado.
- **FR-012**: Agrupamentos DEVEM persistir entre recarregamentos e sessões até serem desmesclados.
- **FR-013**: A unificação DEVE afetar somente o módulo de Acompanhamento; relatórios, RDOs, cadastros, importações, faturamento original, Omie e demais módulos DEVEM permanecer com missões individuais.
- **FR-014**: A visualização consolidada DEVE respeitar busca, filtros e abas existentes do acompanhamento.
- **FR-015**: Toda validação de criação/desmesclagem DEVE impedir agrupamentos inválidos, incluindo menos de duas missões, missão duplicada no mesmo grupo e missão já agrupada em outro grupo ativo.
- **FR-016**: Toda interface visível da feature DEVE estar em português e funcionar em telas mobile sem scroll horizontal.

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Responsive contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------|
| Seleção e ações na aba Projetos do Acompanhamento | `frontend/src/components/projects/ProjectCardsBoard.tsx`; `frontend/src/styles/base.css` (`.acp-filters`, `.acp-seg`, `.acp-pcards-grid`, `.acp-pcard`) | `page-card acp-filters`, `acp-seg`, `field-group`, cards `acp-pcard`; botões novos devem usar o padrão visual compartilhado do app | Checkbox/estado selecionável no card, botão "Unificar selecionadas" e ação "Cancelar seleção"; labels sempre visíveis | Em desktop mantém grid de cards; em mobile controles empilham e seleção fica tocável sem scroll horizontal |
| Card consolidado de missões | `frontend/src/components/projects/ProjectCardsBoard.tsx` card atual; padrões de métricas `.acp-pcard-metric`, `.acp-pcard-row`, `.acp-alerts` | Reusar `acp-pcard`, barras de progresso existentes, badges/linhas atuais e botão de ação no padrão do app | Nome do grupo e lista de missões como conteúdo do card; ação "Desmesclar" acessível no card | Lista de missões quebra linha; métricas e ações não sobrepõem texto em telas estreitas |
| Confirmação de desmesclagem/ações destrutivas | Componentes compartilhados de UI em `frontend/src/components/ui/` | `ConfirmDialog`/modal compartilhado quando houver confirmação | Botões "Cancelar" e "Desmesclar" em português | Rodapé de ações fixo quando modal; corpo rolável em mobile |
| Dashboard do Acompanhamento quando exibir missões | `frontend/src/components/projects/AcompanhamentoDashboard.tsx`; classes `acp-filters`, `acp-kpis`, `acp-table` | Reusar filtros, KPIs, tabela/cards responsivos existentes | Agrupamentos aparecem como uma linha/entrada consolidada e filhos ficam ocultos | Tabela continua usando alternativa responsiva existente sem scroll horizontal de página |

### Key Entities *(include if feature involves data)*

- **Agrupamento de missões do Acompanhamento**: configuração que representa duas ou mais missões tratadas como uma unidade visual no Acompanhamento; possui nome, situação ativa/desmesclada, criador, datas de criação/atualização e lista de missões integrantes.
- **Missão integrante**: vínculo entre uma missão/projeto existente e um agrupamento; uma missão só pode pertencer a um agrupamento ativo por vez.
- **Card consolidado**: representação visual derivada de um agrupamento ativo, calculada a partir dos cards/indicadores individuais atuais das missões integrantes.
- **Missão individual**: projeto/proposta existente que continua sendo a fonte independente de cálculos, relatórios, RDOs, custos, faturamento e progresso.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O gestor consegue criar um agrupamento de duas ou mais missões em até 4 interações depois de entrar na aba Projetos do Acompanhamento.
- **SC-002**: Após unificar missões, 100% dos cards individuais das integrantes ficam ocultos nas visualizações afetadas e exatamente 1 card consolidado aparece no lugar.
- **SC-003**: Para valores monetários e contagens consolidadas, o total do card agrupado é igual à soma dos valores individuais das missões integrantes em 100% dos casos testados.
- **SC-004**: Desmesclar um agrupamento restaura os cards individuais em até 1 recarregamento da listagem e sem alteração nos dados individuais das missões.
- **SC-005**: Relatórios/RDOs/demais módulos continuam exibindo as missões individualmente após a unificação em 100% dos fluxos verificados.
- **SC-006**: Em viewport mobile, seleção, card consolidado e desmesclagem são executáveis sem scroll horizontal de página.

## Assumptions

- Agrupamentos são configurações compartilhadas do módulo de Acompanhamento, não preferências locais do navegador.
- A criação/desmesclagem é uma ação de gestão do acompanhamento; visualizadores sem permissão de gestão apenas veem a configuração vigente.
- O agrupamento não cria um novo projeto/proposta e não muda IDs, relatórios, RDOs, lançamentos do Omie ou importações.
- A consolidação deve partir dos cálculos individuais já existentes, para evitar duplicar regra de negócio e preservar independência por proposta.
- Quando a consolidação de progresso exigir ponderação, o peso padrão é a relevância financeira/planejada de cada missão; o card também lista os progressos individuais para manter rastreabilidade.
- A edição de membros de um agrupamento pode ser feita por desmesclar e criar novamente; edição incremental de membros fica fora do primeiro corte, exceto se já couber no mesmo fluxo visual sem aumentar complexidade.
