# Feature Specification: Histórico de standby por projeto

**Feature Branch**: `feat/011-historico-standby`

**Created**: 2026-08-25

**Status**: Draft

**Input**: User description corrigida: "No módulo de acompanhamento, dentro do dashboard de um projeto, adicionar um botão perto do resumo de standby que abra uma caixa de diálogo com DIA, HORA EM STANDBY, NÚMERO DE COLABORADORES e MOTIVO daquele projeto, ignorando dias sem standby. O botão não deve ficar no card externo."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar histórico de standby do projeto (Priority: P1)

Como usuário do módulo de Acompanhamento, quero abrir o histórico de standby dentro do dashboard detalhado de um projeto para identificar em quais dias a equipe ficou parada, por quanto tempo, com quantos colaboradores e por qual motivo, sem sair do contexto do projeto.

**Why this priority**: Esta é a finalidade central da solicitação e permite investigar rapidamente o impacto operacional junto ao resumo de standby do dashboard.

**Independent Test**: Pode ser validada em um projeto que tenha dias com e sem standby: ao acionar o controle junto ao indicador de standby, a pessoa vê somente os dias com duração positiva, com todas as quatro informações solicitadas e sem registros de outro projeto.

**Acceptance Scenarios**:

1. **Given** o dashboard detalhado de um projeto com registros de standby, **When** o usuário aciona o botão de histórico junto ao resumo de standby, **Then** uma caixa de diálogo identifica o projeto e mostra as colunas Dia, Horas em standby, Nº de colaboradores e Motivo.
2. **Given** um projeto com dias com e sem standby, **When** o histórico é exibido, **Then** somente os dias com duração de standby maior que zero aparecem, do mais recente para o mais antigo.
3. **Given** dois projetos com registros de standby, **When** o histórico é aberto a partir de um deles, **Then** a caixa de diálogo contém exclusivamente dados do projeto selecionado.
4. **Given** o quadro externo de projetos, **When** os cards são exibidos, **Then** nenhum card oferece o botão de histórico; a ação existe somente dentro do dashboard de projeto individual.
5. **Given** o dashboard de um agrupamento, **When** o resumo consolidado é exibido, **Then** o controle de histórico individual não é oferecido.

---

### User Story 2 - Entender estados do histórico em qualquer tela (Priority: P2)

Como usuário em campo ou no escritório, quero que o histórico comunique carregamento, ausência de registros e falhas de consulta de forma clara e continue legível no celular.

**Why this priority**: O histórico precisa ser confiável durante a operação e não pode deixar a pessoa diante de uma caixa vazia ou de uma tabela cortada.

**Independent Test**: Pode ser validada abrindo o histórico em um projeto sem standby, simulando falha de consulta e repetindo o fluxo em uma viewport estreita.

**Acceptance Scenarios**:

1. **Given** um projeto sem qualquer dia com standby, **When** o histórico é aberto, **Then** a caixa de diálogo informa que não há registros de standby para o projeto.
2. **Given** uma falha ao consultar o histórico, **When** a caixa de diálogo está aberta, **Then** o usuário vê uma mensagem de erro clara e pode tentar novamente ou fechar a caixa.
3. **Given** uma tela estreita, **When** o histórico é exibido, **Then** cada registro permanece legível em apresentação empilhada, sem rolagem horizontal da página.

### Edge Cases

- Duração de standby nula, vazia, inválida ou igual a zero não gera linha no histórico.
- Um registro com standby válido e motivo ausente continua visível, apresentando indicação de informação não registrada.
- Um registro com standby válido e quantidade de colaboradores ausente continua visível, apresentando indicação de informação não registrada.
- Um histórico longo mantém o cabeçalho e as ações acessíveis enquanto apenas o conteúdo da caixa de diálogo rola.
- Ao fechar um dashboard e abrir o histórico em outro projeto, nenhum dado do projeto anterior permanece visível como se pertencesse ao novo projeto.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST exibir, dentro do dashboard de cada projeto individual, um botão de histórico visualmente próximo ao resumo de standby.
- **FR-002**: O sistema MUST abrir uma caixa de diálogo associada ao projeto selecionado sem navegar para fora do dashboard.
- **FR-003**: A caixa de diálogo MUST identificar claramente o projeto ao qual o histórico pertence.
- **FR-004**: O histórico MUST apresentar, para cada registro, Dia, Horas em standby, Nº de colaboradores e Motivo.
- **FR-005**: O histórico MUST omitir todos os dias cuja duração de standby seja ausente, inválida ou igual a zero.
- **FR-006**: O histórico MUST ordenar os dias do mais recente para o mais antigo.
- **FR-007**: A duração MUST ser apresentada como tempo em horas e minutos, sem perda dos minutos registrados.
- **FR-008**: O Nº de colaboradores MUST corresponder ao efetivo registrado no relatório diário do mesmo dia; quando indisponível, a ausência MUST ser indicada sem inventar um valor.
- **FR-009**: O Motivo MUST corresponder ao motivo de standby registrado no relatório diário; quando indisponível, a ausência MUST ser indicada.
- **FR-010**: O sistema MUST restringir os registros ao projeto escolhido e aos dados que o usuário já tem permissão para consultar no módulo.
- **FR-011**: O sistema MUST comunicar os estados de carregamento, histórico vazio e falha de consulta, oferecendo nova tentativa após falha.
- **FR-012**: O usuário MUST poder fechar a caixa de diálogo por controle visível, tecla Escape e retorno de foco ao botão que a abriu.
- **FR-013**: Cards do quadro externo e dashboards que representam agrupamentos MUST NOT exibir o botão de histórico de um projeto individual.
- **FR-014**: A nova função MUST ser anunciada uma vez por usuário e navegador durante uma campanha global de 10 dias corridos iniciada em 2026-08-25; depois de 2026-09-04, o anúncio MUST NOT aparecer.

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Botão junto ao standby no dashboard | `frontend/src/components/projects/ProjectDetailDashboard.tsx` | Botão compacto e estilos/tokens já usados nas ações e métricas do dashboard | N/A | N/A | O diálogo é estado transitório e o dashboard aberto permanece selecionado | Anúncio temporário, uma vez por usuário/navegador, entre 2026-08-25 e 2026-09-04, apontando para o botão real no dashboard | A ação permanece junto ao KPI, pode quebrar linha e não amplia o bloco |
| Caixa de diálogo do histórico | `frontend/src/components/ui/Modal.tsx` e diálogos existentes do módulo | `Modal`, botão compartilhado, classes globais de cabeçalho/corpo/rodapé e tokens de `variables.css` | N/A | N/A | N/A, pois o diálogo não representa navegação compartilhável | O anúncio aponta para o controle real no dashboard; nenhum onboarding permanente é criado | Corpo rolável e rodapé fixo; tabela no desktop e registros empilhados em telas estreitas; sem rolagem horizontal de página; motivos longos quebram linha |

### Key Entities *(include if feature involves data)*

- **Registro diário de standby**: Ocorrência vinculada a um projeto e dia, com duração positiva, efetivo de colaboradores e motivo operacional.
- **Projeto acompanhado**: Projeto cujo dashboard origina a consulta e delimita todos os registros retornados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% dos registros apresentados, as quatro informações solicitadas correspondem ao mesmo projeto e ao mesmo dia.
- **SC-002**: Em 100% dos históricos, dias sem standby positivo são omitidos.
- **SC-003**: Um usuário consegue abrir, interpretar e fechar o histórico em até 30 segundos, sem sair do dashboard do projeto.
- **SC-004**: O histórico permanece utilizável em larguras de tela a partir de 320 px, sem rolagem horizontal da página e sem truncar o motivo de forma irrecuperável.
- **SC-005**: Para um histórico de até 500 dias com standby, o primeiro conteúdo útil é apresentado em até 2 segundos em condições normais de uso.

## Assumptions

- "Número de colaborador" significa a quantidade de colaboradores registrada no relatório diário do projeto, e será rotulada como "Nº de colaboradores" para evitar ambiguidade.
- A origem oficial das informações é o conjunto de relatórios diários já considerado pelo módulo de Acompanhamento para calcular o resumo de standby do dashboard.
- Não serão criados nem editados registros de standby por esta função; o histórico é somente leitura.
- O botão se aplica apenas ao dashboard de projetos individuais. O quadro externo e dashboards consolidados de agrupamentos ficam fora do escopo.
- Quando não houver motivo ou efetivo registrado em dados legados, a linha continua disponível com indicação visual de ausência.
