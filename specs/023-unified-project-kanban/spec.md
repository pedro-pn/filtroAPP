# Feature Specification: Kanban único de projetos

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-10
**Status**: Implementado
**Input**: Corrigir a interpretação do fluxo: não existem dois Kanbans. O Kanban operacional existente deve ser refinado com as novas etapas e checklists, mantendo o Projeto como card mestre.

## User Scenarios & Testing

### User Story 1 — Consultar um único fluxo (Priority: P1)

Ao abrir Evolução, o usuário vê diretamente um Kanban de projetos, sem seletor entre Gestão de Projetos e Kanban Operacional.

**Acceptance Scenarios**:

1. A tela não apresenta duas abas ou dois Kanbans concorrentes.
2. Cada projeto aparece uma única vez e sua etapa vem do workflow quando a gestão já foi iniciada.
3. Projetos legados sem workflow preservam visualmente a etapa da missão operacional existente.
4. O gestor pode atualizar a etapa operacional de um projeto legado pelo detalhe do mesmo card até iniciar o handover.

### User Story 2 — Preservar mobilização e execução operacionais (Priority: P1)

O fluxo refinado mantém Mobilização e Execução como etapas do mesmo projeto, depois do gate Pronto para mobilizar.

**Acceptance Scenarios**:

1. O projeto autorizado pode avançar de Pronto para mobilizar para Mobilização e depois para Execução.
2. A entrada em Mobilização ou Execução exige uma programação oficial confirmada e completa.
3. A etapa da missão oficial é atualizada na mesma transação da etapa do projeto.
4. Retornar o projeto para Pronto para mobilizar devolve a missão para Stand by.

### User Story 3 — Preservar a operação sem duplicar o andamento (Priority: P1)

Equipe, ciclos e datas continuam sendo configurados em Missões. A evolução temporal passa a ser comandada somente pelo card do projeto.

**Acceptance Scenarios**:

1. O modal do projeto mantém acesso direto à programação da equipe.
2. O card mostra a situação da programação oficial e quantidade de participantes.
3. O gate continua protegendo Efetivo, Estoque e Romaneios durante Mobilização e Execução.

## Requirements

- **FR-001**: Evolução MUST renderizar somente o Kanban mestre de projetos.
- **FR-002**: O parâmetro e o controle de alternância entre Kanbans MUST ser removidos da interface.
- **FR-003**: `ProjectWorkflowStage` MUST incluir `MOBILIZATION` entre `READY_TO_MOBILIZE` e `EXECUTION`.
- **FR-004**: A listagem MUST incluir um resumo da missão oficial atual para evitar perder equipe, datas e situação legadas.
- **FR-005**: Projeto legado sem workflow MUST ser projetado na coluna equivalente à etapa operacional, sem criar aceite ou autorização presumidos.
- **FR-005A**: Enquanto não houver workflow, a atualização operacional legada MUST permanecer acessível dentro do detalhe do card no Kanban único.
- **FR-006**: Projeto gerenciado MUST usar exclusivamente `ProjectWorkflow.stage` como etapa exibida.
- **FR-007**: Mudanças para Mobilização, Execução e retorno a Pronto para mobilizar MUST sincronizar `EfetivoMissionPlan.stage` atomicamente.
- **FR-008**: Mobilização e Execução MUST exigir autorização vigente e programação oficial completa.
- **FR-009**: A autorização MUST permanecer vigente em Pronto para mobilizar, Mobilização e Execução quando a versão e o gate coincidirem.
- **FR-010**: A seção Missões MUST continuar responsável por equipe, ciclos, datas e confirmação da programação.
- **FR-011**: A correção MUST atualizar a campanha guiada temporária por exatamente 10 dias.

## Success Criteria

- **SC-001**: Existe somente um Kanban visível em Evolução.
- **SC-002**: Um projeto gerenciado não pode apresentar etapa distinta da missão oficial após uma mudança operacional bem-sucedida.
- **SC-003**: Projetos legados permanecem reconhecíveis na coluna operacional atual.
- **SC-004**: Os testes de gate, Romaneio, workflow e planejamento continuam aprovados.
