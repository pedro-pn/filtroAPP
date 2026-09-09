# Feature Specification: preparação D-15 e autorização de mobilização

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-09
**Status**: Implementado
**Input**: Continuar a Gestão de Projetos com a preparação D-15 e o gate forte “Pronto para mobilizar”.

## User Scenarios & Testing

### User Story 1 — Confirmar a preparação D-15 (Priority: P1)

Depois de concluir o planejamento D-30, o Líder inicia a preparação e cada área confirma equipe, cliente, equipamentos, materiais, pré-job, viagem e QSMS.

**Independent Test**: concluir D-30, entrar em Preparação, preencher cada grupo com os respectivos papéis e conferir o progresso consolidado.

**Acceptance Scenarios**:

1. A entrada em Preparação exige todos os itens D-30 resolvidos.
2. Operações confirma equipe, logística e pré-job; Administrativo/RH confirma documentos, exames, treinamentos, cadastros, integração e hospedagem; Ativos confirma equipamentos; Suprimentos confirma materiais; QSMS confirma sua frente.
3. Papéis combinados acumulam as frentes permitidas e nenhum papel de área muda a etapa.
4. Itens “não aplicáveis” continuam exigindo justificativa.
5. A preparação permanece consultável ao chegar em “Pronto para mobilizar”.

### User Story 2 — Autorizar a mobilização por gate (Priority: P1)

O Líder consulta nove frentes consolidadas. Somente com Comercial, Equipe, Documentação, Equipamentos, Materiais, QSMS, Hospedagem, Logística e Cliente verdes pode emitir a autorização e mover o card para “Pronto para mobilizar”.

**Independent Test**: manter uma frente pendente e confirmar o bloqueio; concluir todas, emitir a autorização e verificar data, versão e evento de auditoria.

**Acceptance Scenarios**:

1. O gate apresenta situação e bloqueios por frente.
2. Pendência crítica aberta também bloqueia a autorização.
3. A ação “Autorizar mobilização” é exclusiva do Líder atual, gestor ou administrador.
4. A autorização registra data e a versão exata do projeto em que foi emitida.
5. Alterar qualquer dado versionado depois da emissão suspende a autorização.
6. Com o gate novamente verde, o Líder ou gestor pode revalidar a autorização sem trocar de coluna.
7. Voltar para Preparação cancela o estado de autorização vigente, preservando a trilha de eventos.

### User Story 3 — Enxergar risco em D-7 e D-1 (Priority: P2)

Quando os marcos D-7 ou D-1 já foram atingidos e o gate ainda tem bloqueios, o quadro e o detalhe destacam atenção ou risco de mobilização.

**Independent Test**: consultar um projeto a sete e a um dia da mobilização com pendências e conferir os dois níveis; autorizar e conferir o estado verde.

**Acceptance Scenarios**:

1. D-7 com gate incompleto apresenta atenção e a contagem de bloqueios.
2. D-1 com gate incompleto apresenta “Risco de mobilização”.
3. Projeto autorizado permanece verde mesmo depois de D-1.
4. Reagendar a mobilização recalcula o risco e invalida a autorização anterior pela versão.

### Edge Cases

- Projetos cadastrados dentro do D-15 podem avançar imediatamente depois de resolver D-30.
- Uma autorização suspensa não é considerada válida mesmo que possua data histórica.
- Corrigir um item em “Pronto para mobilizar” exige revalidação explícita.
- Origem CRM continua somente leitura e pode suspender a autorização se a prontidão comercial regredir.
- A integração física com saídas de equipe, equipamentos e materiais será ativada de forma controlada após classificação dos projetos existentes.

## Requirements

### Functional Requirements

- **FR-001**: O fluxo MUST incluir `PREPARATION` e `READY_TO_MOBILIZE` como etapas reais.
- **FR-002**: A transição de planejamento para preparação MUST exigir os 25 itens D-30 resolvidos.
- **FR-003**: O catálogo MUST incluir os checklists D-15 de equipe, cliente, equipamentos, materiais, pré-job, viagem e QSMS.
- **FR-004**: Cada checklist MUST informar e validar seus papéis responsáveis no backend.
- **FR-005**: O papel `efetivo:qsms` MUST permitir acesso ao módulo e edição apenas dos itens atribuídos ao QSMS.
- **FR-006**: O backend MUST calcular as nove frentes do gate, seus totais e seus bloqueios.
- **FR-007**: Comercial MUST usar a prontidão comercial; Documentação MUST combinar documentação antecipada e confirmações pessoais/do cliente; as demais frentes MUST usar seus checklists D-15.
- **FR-008**: Pendências abertas de criticidade alta MUST bloquear o gate.
- **FR-009**: A transição para `READY_TO_MOBILIZE` MUST exigir gate verde e registrar `mobilizationAuthorizedAt` e `mobilizationAuthorizationVersion`.
- **FR-010**: A autorização vigente MUST exigir etapa pronta, gate verde e igualdade entre a versão autorizada e a versão atual.
- **FR-011**: Toda alteração posterior MUST suspender automaticamente a autorização pelo controle de versão.
- **FR-012**: O PATCH MUST aceitar `authorize_mobilization` somente na etapa pronta, com gate verde e para Líder/gestor.
- **FR-013**: Voltar para Preparação MUST limpar a autorização vigente e registrar o evento normal de etapa.
- **FR-014**: O detalhe MUST mostrar tabela do gate, progresso D-15, bloqueios e ação de autorização/revalidação no rodapé fixo.
- **FR-015**: O quadro MUST mostrar progresso D-15, situação da autorização e alerta D-7/D-1.
- **FR-016**: Esta entrega MUST expor um estado confiável para integrações; a imposição nas rotas operacionais externas MUST permanecer desativada até a adoção controlada.

### Visual/UI Contract

| Surface | Reference | Components | Navigation | Novelty | Responsive |
|---|---|---|---|---|---|
| Preparação D-15 | modal largo da gestão | `Modal`, `Button`, checklists existentes | projeto em `?projeto=id` | atualizar campanha vigente até 19/09/2026 | grupos em duas colunas e uma no mobile |
| Gate | status e semáforos atuais | tabela semântica com alternativa empilhada | etapa vem da API | mesma campanha | linhas viram cards em tela estreita |
| Card | `ProjectWorkflowBoard` | badges e tokens atuais | filtros permanecem na URL | coberto pela campanha | conteúdo quebra dentro do card |

### Key Entities

- Preparação D-15: progresso total e por seção.
- Gate de mobilização: nove frentes e bloqueios críticos.
- Autorização de mobilização: data, versão emitida e situação vigente/suspensa.

## Success Criteria

- **SC-001**: Nenhum projeto entra em Preparação com D-30 incompleto.
- **SC-002**: Nenhum projeto recebe autorização com frente vermelha ou pendência crítica aberta.
- **SC-003**: Qualquer mutação posterior torna a autorização não vigente até revalidação.
- **SC-004**: Papéis de área conseguem editar apenas sua responsabilidade.
- **SC-005**: Em 390px e 1440px, checklists, gate e ações permanecem visíveis sem rolagem horizontal da página.

## Assumptions

- O Líder atual e o gestor são as autoridades para emissão e revalidação.
- A trilha `ProjectWorkflowEvent` identifica o autor da autorização.
- O bloqueio nas APIs de saída será ativado depois que projetos em andamento forem classificados e a política de exceção for definida.
