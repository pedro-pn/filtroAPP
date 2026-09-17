# Feature Specification: Pós-job e fechamento técnico

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-10
**Status**: Implementado
**Input**: Implementar a próxima entrega da Gestão de Projetos: Pós-job / fechamento técnico no Kanban único, com lições aprendidas no módulo Qualidade.

## User Scenarios & Testing

### User Story 1 — Encerrar a desmobilização (Priority: P1)

O Líder de Projetos move a obra de Desmobilização para Pós-job depois de confirmar o retorno e concluir os controles da etapa.

**Acceptance Scenarios**:

1. Pós-job aparece imediatamente depois de Desmobilização no mesmo Kanban.
2. O avanço exige os 15 controles da desmobilização, a conclusão de campo e a data efetiva de retorno.
3. Um bloqueio informa cada controle ou data pendente.
4. Líder, equipe, ciclos, datas, botões e arraste do card permanecem disponíveis.
5. A missão oficial permanece em Medição final e não recebe uma segunda programação.
6. Soltar o card em uma etapa permitida conclui a movimentação sem abrir o detalhe; se houver bloqueio, o detalhe abre e o motivo é apresentado.

### User Story 2 — Registrar o pós-job (Priority: P1)

O Líder registra a reunião, os feedbacks, problemas, soluções, melhorias e lições aprendidas.

**Acceptance Scenarios**:

1. O detalhe oferece campos estruturados para os nove pontos definidos no planejamento.
2. Os nove controles possuem situação, observação, autoria e progresso consolidado.
3. O formulário aceita correções e remoção de dados com controle de versão.
4. O card mostra o progresso do pós-job.
5. As categorias do detalhe podem ser recolhidas e as categorias concluídas iniciam minimizadas.

### User Story 3 — Reutilizar a experiência anterior (Priority: P1)

Ao planejar ou fechar uma obra, o Líder consulta pós-jobs anteriores relacionados ao mesmo cliente ou serviço.

**Acceptance Scenarios**:

1. O detalhe mostra até dez pós-jobs relacionados e identifica o vínculo por cliente ou serviço.
2. O serviço usa o escopo planejado do projeto e mantém um snapshot no fechamento.
3. Uma lição preenchida cria ou atualiza um registro `LICAO_APRENDIDA` vinculado ao projeto no módulo Qualidade.
4. A lição fica pesquisável por projeto e pelo texto consolidado do pós-job.

## Requirements

- **FR-001**: `ProjectWorkflowStage` MUST incluir `POST_JOB` depois de `DEMOBILIZATION`.
- **FR-002**: O fluxo MUST permitir `DEMOBILIZATION → POST_JOB` e `POST_JOB → DEMOBILIZATION`.
- **FR-003**: O avanço para Pós-job MUST exigir desmobilização 100%, conclusão de campo e retorno efetivo.
- **FR-004**: A missão oficial MUST permanecer em `FINAL_MEASUREMENT` durante Pós-job.
- **FR-005**: A etapa MUST incluir os nove controles do planejamento original.
- **FR-006**: O sistema MUST persistir reunião, feedbacks, problemas, soluções, melhorias e lições em registro estruturado por projeto.
- **FR-007**: A API MUST validar etapa, permissão, versão e limites dos campos.
- **FR-008**: O escopo de serviços MUST ser obtido de `ProjectPlannedService`, com o nome do projeto como fallback.
- **FR-009**: O preenchimento de lições MUST sincronizar um `QualityRecord` de tipo `LICAO_APRENDIDA` na mesma transação.
- **FR-010**: Remover as lições MUST arquivar o registro sincronizado e retirar o vínculo ativo.
- **FR-011**: O detalhe MUST listar históricos relacionados pelo mesmo cliente ou por serviço coincidente.
- **FR-012**: O próximo avanço para Documentação / medição permanece fora desta entrega.
- **FR-013**: As categorias do detalhe MUST ser recolhíveis e MUST iniciar fechadas quando todos os seus controles estiverem concluídos.
- **FR-014**: O arraste MUST abrir o detalhe após a soltura somente quando a transição for bloqueada, preservando a movimentação direta quando ela for válida.

## Success Criteria

- **SC-001**: O projeto chega ao Pós-job somente após concluir o gate de desmobilização.
- **SC-002**: Os nove controles e os campos estruturados reaparecem após recarregar a página.
- **SC-003**: A lição aparece no módulo Qualidade com projeto, número e conteúdo consolidado.
- **SC-004**: O histórico diferencia correspondência por cliente e por serviço.
- **SC-005**: Testes de workflow, Qualidade, gates operacionais e interface permanecem aprovados.
