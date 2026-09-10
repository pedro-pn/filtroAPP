# Feature Specification: Encerramento do projeto

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-10
**Status**: Implementado
**Input**: Implementar a última etapa do Kanban único de Gestão de Projetos, com gate final, autoria/data do encerramento e reabertura justificada.

## User Scenarios & Testing

### User Story 1 — Encerrar o projeto (Priority: P1)

O Líder de Projetos encerra a obra após concluir documentação, medição, pós-job, devolução de ativos e todas as pendências.

**Acceptance Scenarios**:

1. Encerrado aparece imediatamente depois de Documentação / medição no mesmo Kanban.
2. O avanço exige todos os controles finais, aprovação estruturada da medição, pós-job realizado e ausência de pendências abertas.
3. Cada requisito pendente aparece como motivo do bloqueio no detalhe e após soltar um card em movimento inválido.
4. O encerramento guarda data e usuário e move a missão oficial para Encerrado.
5. Líder, equipe, ciclos, datas e botões informativos do card continuam visíveis.

### User Story 2 — Consultar um projeto encerrado (Priority: P1)

O usuário consulta o histórico técnico e financeiro de uma obra encerrada sem alterar acidentalmente seus registros.

**Acceptance Scenarios**:

1. O detalhe mostra “Missão encerrada”, data e autor.
2. Os dados de documentação, medição, pós-job, pendências e checklist final permanecem consultáveis.
3. Ações de edição ficam bloqueadas enquanto o projeto permanece encerrado.

### User Story 3 — Reabrir com justificativa (Priority: P1)

O Líder ou gestor reabre um projeto quando surge uma correção posterior e informa o motivo.

**Acceptance Scenarios**:

1. A reabertura exige uma justificativa textual.
2. O projeto volta para Documentação / medição e a missão oficial volta para Medição final.
3. O histórico registra justificativa, autor e data.
4. Arrastar um projeto encerrado para trás abre o detalhe que solicita a justificativa.

## Requirements

- **FR-001**: `ProjectWorkflowStage` MUST incluir `FINISHED` depois de `FINAL_MEASUREMENT`.
- **FR-002**: O fluxo MUST permitir `FINAL_MEASUREMENT → FINISHED` e `FINISHED → FINAL_MEASUREMENT`.
- **FR-003**: O gate final MUST exigir os dez controles do checklist de encerramento.
- **FR-004**: O gate final MUST exigir os 14 controles de documentação/medição já existentes.
- **FR-005**: O gate final MUST exigir data e valor da aprovação da medição e data da reunião de pós-job.
- **FR-006**: O gate final MUST bloquear qualquer pendência interna ainda aberta.
- **FR-007**: O encerramento MUST guardar autoria e data.
- **FR-008**: A missão oficial MUST ser sincronizada com `FINISHED` no encerramento.
- **FR-009**: Um projeto encerrado MUST ser somente leitura, salvo pela ação explícita de reabertura.
- **FR-010**: A reabertura MUST exigir justificativa e registrar a ação na auditoria.
- **FR-011**: A reabertura MUST limpar a autoria/data atuais do encerramento e sincronizar a missão com `FINAL_MEASUREMENT`.
- **FR-012**: O Kanban MUST preservar arraste, informações de líder/equipe/ciclos/datas e programação da equipe na mesma página.
- **FR-013**: O checklist concluído MUST iniciar recolhido e continuar expansível.

## Edge Cases

- Valor aprovado igual a zero é válido quando a data de aprovação está informada.
- Uma pendência `OPEN` ou `IN_PROGRESS` impede o encerramento; somente `RESOLVED` libera.
- Projetos legados já encerrados continuam na mesma coluna mesmo sem gestão iniciada.
- Uma tentativa concorrente usa o controle de versão existente.
- Justificativa vazia ou composta apenas por espaços não reabre o projeto.

## Success Criteria

- **SC-001**: Nenhum projeto gerenciado chega a Encerrado com um requisito do gate pendente.
- **SC-002**: Autor e data reaparecem depois de recarregar a página.
- **SC-003**: O projeto encerrado não aceita mutações comuns.
- **SC-004**: A reabertura volta as duas projeções para medição e preserva a justificativa no histórico.
- **SC-005**: Testes de regras, serviço, missão e interface permanecem aprovados.
