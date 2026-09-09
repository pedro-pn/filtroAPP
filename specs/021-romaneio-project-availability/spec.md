# Feature Specification: obras disponíveis no romaneio

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-09
**Status**: Implementado
**Input**: Filtrar as obras do preenchimento do romaneio conforme o tipo de movimentação.

## User Scenarios & Testing

### User Story 1 — Selecionar somente obras liberadas para saída (Priority: P1)

Ao preencher um romaneio de saída, o operador encontra somente projetos gerenciados com autorização de mobilização vigente e obras legadas ainda não concluídas.

**Independent Test**: consultar a lista de saída com projetos gerenciados autorizados e bloqueados, além de projetos legados ativos e concluídos.

**Acceptance Scenarios**:

1. Projeto gerenciado autorizado aparece na lista de Saída.
2. Projeto gerenciado sem autorização vigente não aparece.
3. Projeto legado ativo aparece e projeto legado concluído não aparece.
4. Saída não oferece criação manual de missão ausente.
5. Uma chamada direta continua impedida de usar obra indisponível.

### User Story 2 — Manter entrada disponível para todas as obras (Priority: P1)

Ao preencher um romaneio de entrada, o operador pode selecionar qualquer obra acessível, inclusive concluída ou com entrada anterior.

**Independent Test**: consultar a lista de Entrada com obras ativas, concluídas, gerenciadas e legadas.

**Acceptance Scenarios**:

1. A lista de Entrada não depende da autorização de mobilização.
2. Obras concluídas continuam disponíveis para Entrada.
3. Uma entrada anterior não remove a obra da lista.
4. Projetos excluídos ou sem visibilidade para o usuário permanecem ocultos.

### User Story 3 — Atualizar a seleção ao trocar o tipo (Priority: P2)

Ao alternar entre Saída e Entrada, a tela recarrega as opções corretas e limpa uma escolha incompatível.

**Independent Test**: alternar o tipo e verificar a consulta, a seleção e o texto de orientação.

## Requirements

- **FR-001**: A API de projetos do romaneio MUST aceitar o tipo `OUTBOUND` ou `INBOUND`.
- **FR-002**: Para `OUTBOUND`, projeto com workflow MUST ter autorização vigente.
- **FR-003**: Para `OUTBOUND`, projeto sem workflow MUST estar ativo.
- **FR-004**: Para `INBOUND`, o status ativo, o workflow e a autorização MUST NOT restringir a lista.
- **FR-005**: As regras existentes de exclusão lógica e visibilidade por usuário MUST ser preservadas.
- **FR-006**: A API MUST omitir os dados internos do workflow na resposta da lista.
- **FR-007**: O backend MUST impedir criação e atualização de saída em projeto legado concluído.
- **FR-008**: O backend MUST deixar de criar cadastro pendente a partir de código manual em uma saída.
- **FR-009**: A tela MUST consultar novamente os projetos quando o tipo mudar e limpar a referência anterior.
- **FR-010**: A opção de código manual MUST ficar disponível somente para Entrada.
- **FR-011**: A tela MUST explicar, em pt-BR, o critério da lista atual.
- **FR-012**: A novidade MUST ser apresentada uma vez por usuário até 19/09/2026.

## Success Criteria

- **SC-001**: Nenhum projeto gerenciado sem autorização aparece na lista de Saída.
- **SC-002**: Nenhuma obra legada concluída aparece na lista de Saída.
- **SC-003**: Todas as obras acessíveis, inclusive concluídas, aparecem na lista de Entrada.
- **SC-004**: Trocar o tipo nunca mantém selecionada uma obra da lista anterior.
- **SC-005**: Chamadas diretas não contornam a disponibilidade exibida na interface.

## Assumptions

- Obra antiga significa projeto sem registro `ProjectWorkflow`.
- Para obra antiga, `Project.isActive = false` representa conclusão/arquivamento.
- Enquanto não houver regra de fechamento da devolução, a Entrada não considera quantidade de entradas anteriores para ocultar projetos.
