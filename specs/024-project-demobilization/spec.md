# Feature Specification: Desmobilização de projetos

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-10
**Status**: Implementado
**Input**: Implementar a próxima entrega do planejamento da Gestão de Projetos: Desmobilização no Kanban único.

## User Scenarios & Testing

### User Story 1 — Iniciar a desmobilização (Priority: P1)

O Líder de Projetos move uma obra de Em execução para Desmobilização no mesmo Kanban, por arraste ou pelo detalhe do card.

**Acceptance Scenarios**:

1. A etapa Desmobilização aparece imediatamente depois de Em execução.
2. A mudança preserva líder, equipe, ciclos, datas e botões operacionais do card.
3. A missão oficial é projetada em Medição final na mesma transação da mudança do projeto.
4. O projeto pode voltar para Em execução quando o trabalho de campo precisar ser retomado.

### User Story 2 — Controlar o retorno da obra (Priority: P1)

Durante a desmobilização, as áreas responsáveis registram a conclusão de campo, conferem o retorno e informam as datas efetivas.

**Acceptance Scenarios**:

1. O detalhe apresenta as frentes Conclusão de campo, Logística de retorno e Retorno de ativos.
2. Cada frente mostra itens concluídos, total e progresso consolidado.
3. O Líder ou gestor informa a data de conclusão de campo e a data real de desmobilização.
4. A data real de desmobilização não pode anteceder a conclusão de campo nem o fim previsto da execução da missão oficial.
5. Ao salvar a desmobilização, a data de retorno da missão e o cronograma do projeto são atualizados sem modificar os ciclos.

### User Story 3 — Manter as áreas responsáveis (Priority: P1)

Operações, Ativos, Suprimentos e Administrativo atualizam somente os itens de sua responsabilidade, enquanto o Líder e o gestor mantêm visão e edição integral.

**Acceptance Scenarios**:

1. Itens de equipamentos, ferramentas e avarias aceitam edição pela área de Ativos.
2. Itens de materiais aceitam edição por Suprimentos.
3. Hospedagem aceita edição pelo Administrativo.
4. Operações acompanha conclusão de campo, retornos e logística.

## Requirements

- **FR-001**: `ProjectWorkflowStage` MUST incluir `DEMOBILIZATION` depois de `EXECUTION`.
- **FR-002**: O fluxo MUST permitir `EXECUTION → DEMOBILIZATION` e `DEMOBILIZATION → EXECUTION`.
- **FR-003**: Entrar em Desmobilização MUST sincronizar a missão oficial para `FINAL_MEASUREMENT` atomicamente.
- **FR-004**: Voltar a Execução MUST restaurar a projeção operacional para `EXECUTION`.
- **FR-005**: A etapa MUST oferecer os 15 controles de desmobilização definidos no planejamento, organizados por frente.
- **FR-006**: O sistema MUST calcular progresso total e por frente, aceitando Concluído e Não aplicável como resolvidos.
- **FR-007**: O workflow MUST registrar a data real de conclusão de campo.
- **FR-008**: A data real de desmobilização MUST usar e atualizar a fonte operacional já existente no projeto e na missão oficial.
- **FR-009**: A atualização de datas MUST validar a cronologia e MUST preservar demandas, alocações e ciclos.
- **FR-010**: A autorização de mobilização MUST deixar de ser vigente depois que o projeto entrar em Desmobilização.
- **FR-011**: Card, modal, arraste, toque, líder, equipe e botões já existentes MUST continuar funcionando.
- **FR-012**: O card em Desmobilização MUST mostrar o progresso e a data efetiva de retorno quando informada.
- **FR-013**: A API MUST validar payload, versão e permissões antes de persistir datas ou checklists.
- **FR-014**: O próximo avanço além de Desmobilização MUST permanecer bloqueado até a entrega de Pós-job.

## Success Criteria

- **SC-001**: O Kanban posiciona um projeto gerenciado em Desmobilização sem criar um segundo card.
- **SC-002**: Os 15 itens aparecem no detalhe e o progresso chega a 100% quando todos estão resolvidos.
- **SC-003**: A data de retorno salva aparece no projeto, na missão oficial e no card.
- **SC-004**: Os ciclos e participantes existentes permanecem iguais após etapa e datas serem atualizadas.
- **SC-005**: Testes de workflow, planejamento, gates operacionais e Romaneio permanecem aprovados.
