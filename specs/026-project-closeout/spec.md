# Feature Specification: Documentação e medição do projeto

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-10
**Status**: Implementado
**Input**: Implementar a próxima entrega da Gestão de Projetos: Documentação / Medição no Kanban único, consolidando evidências documentais e valores da medição sem confundir medição aprovada com faturamento.

## User Scenarios & Testing

### User Story 1 — Concluir o pós-job (Priority: P1)

O Líder de Projetos move a obra de Pós-job para Documentação / medição depois de registrar a reunião e concluir os controles do fechamento técnico.

**Acceptance Scenarios**:

1. Documentação / medição aparece imediatamente depois de Pós-job no mesmo Kanban.
2. O avanço exige os nove controles do pós-job e a data da reunião.
3. Um bloqueio informa cada controle ou data pendente.
4. A missão oficial permanece em Medição final e não recebe uma nova programação.
5. Líder, equipe, ciclos, datas, botões e arraste do card permanecem disponíveis.

### User Story 2 — Consolidar a documentação (Priority: P1)

O Líder acompanha RDOs, relatórios técnicos, pendências e aceite do cliente até concluir a documentação técnica.

**Acceptance Scenarios**:

1. A etapa apresenta os sete controles de documentação previstos no planejamento.
2. O detalhe mostra quantos RDOs e relatórios foram emitidos, liberados, assinados ou devolvidos usando os registros já existentes.
3. O detalhe mostra os relatórios aceitos pelo cliente sem marcar controles automaticamente quando a evidência não comprovar a totalidade esperada.
4. Os controles persistem situação, observação, autoria e progresso consolidado.

### User Story 3 — Registrar e acompanhar a medição (Priority: P1)

O Líder consolida quantitativos, adicionais, evidências, datas e valores de execução, medição e aprovação.

**Acceptance Scenarios**:

1. A etapa apresenta os sete controles de medição previstos no planejamento.
2. O Líder registra valor executado, medido e aprovado, além das datas de preparação, envio e aprovação.
3. O sistema calcula o valor pendente de aprovação como medido menos aprovado.
4. O sistema mostra o contrato previsto e o valor faturado vindos das fontes atuais em campos distintos.
5. O sistema rejeita valores negativos, medição superior ao executado, aprovação superior ao medido e datas fora de ordem.

## Requirements

- **FR-001**: `ProjectWorkflowStage` MUST incluir `FINAL_MEASUREMENT` depois de `POST_JOB`.
- **FR-002**: O fluxo MUST permitir `POST_JOB → FINAL_MEASUREMENT` e `FINAL_MEASUREMENT → POST_JOB`.
- **FR-003**: O avanço para Documentação / medição MUST exigir pós-job 100% e data da reunião.
- **FR-004**: A missão oficial MUST permanecer em `FINAL_MEASUREMENT` durante esta etapa.
- **FR-005**: A etapa MUST incluir sete controles de documentação e sete controles de medição.
- **FR-006**: O sistema MUST persistir resumo dos quantitativos, adicionais, evidências, valores e datas da medição com auditoria.
- **FR-007**: A API MUST validar etapa, permissão, versão, limites, ordem dos valores e ordem cronológica das datas.
- **FR-008**: O painel documental MUST reutilizar RDOs, relatórios, metas e aceites do cliente já registrados.
- **FR-009**: Os indicadores automáticos MUST servir como evidência e não concluir checklists que dependam de confirmação humana.
- **FR-010**: Contrato previsto, valor faturado, valor executado, valor medido e valor aprovado MUST permanecer dimensões distintas.
- **FR-011**: O contrato previsto MUST usar o orçamento/propostas adicionais atuais; essa origem poderá ser substituída pela futura integração com CRM.
- **FR-012**: O valor faturado MUST usar os recebíveis do Omie já vinculados ao projeto.
- **FR-013**: O próximo avanço para Encerrado permanece fora desta entrega.
- **FR-014**: As categorias concluídas MUST iniciar recolhidas e permanecer expansíveis.

## Edge Cases

- Projeto sem orçamento, recebível, RDO, relatório ou meta configurada mostra zero/ausente sem bloquear a tela.
- Valores iguais a zero são válidos e diferentes de campos não preenchidos.
- Uma devolução ou rejeição posterior deixa de contar como aceite/liberação atual.
- Limpar os dados da medição remove os valores opcionais sem criar totais artificiais.
- Datas parciais são aceitas, desde que qualquer par informado respeite a ordem cronológica.

## Success Criteria

- **SC-001**: O projeto chega a Documentação / medição somente após concluir o gate do pós-job.
- **SC-002**: Os 14 controles e os dados estruturados reaparecem após recarregar a página.
- **SC-003**: O painel reproduz os totais documentais derivados dos registros existentes.
- **SC-004**: O painel diferencia contrato, faturamento, execução, medição, aprovação e pendência.
- **SC-005**: Testes de workflow, painel, gates operacionais e interface permanecem aprovados.
