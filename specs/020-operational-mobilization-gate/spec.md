# Feature Specification: gate nas saídas operacionais

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-09
**Status**: Implementado
**Input**: Aplicar de forma controlada a autorização de mobilização às saídas de equipe, equipamentos e materiais.

## User Scenarios & Testing

### User Story 1 — Impedir mobilização sem autorização (Priority: P1)

Quando um projeto já possui Gestão de Projetos iniciada, as áreas operacionais só podem registrar uma saída após a autorização vigente do Líder ou gestor.

**Independent Test**: tentar mobilizar uma missão oficial, emitir um romaneio de saída e retirar material para uma obra gerenciada com autorização ausente, suspensa e vigente.

**Acceptance Scenarios**:

1. Projeto gerenciado sem autorização vigente não aceita a entrada de missão oficial em Mobilização ou Execução.
2. Projeto gerenciado sem autorização vigente não aceita criação nem atualização de romaneio de saída.
3. Projeto gerenciado sem autorização vigente não aceita retirada direta de material com destino à obra.
4. Projeto autorizado aceita as três operações.
5. Uma mudança que suspende a autorização volta a bloquear novas saídas.
6. A recusa acontece antes de gerar documentos ou alterar saldos, posições e auditorias.

### User Story 2 — Preservar operações que não representam saída (Priority: P1)

Retornos e ajustes que não iniciam uma mobilização continuam disponíveis para não impedir a recuperação de equipamentos e materiais.

**Independent Test**: operar entrada de romaneio, devolução de estoque, cenário de equipe e reordenação na mesma coluna com o gate bloqueado.

**Acceptance Scenarios**:

1. Romaneios de entrada e devoluções da obra não consultam a autorização.
2. Cenários hipotéticos do Efetivo não são bloqueados.
3. Reordenar uma missão dentro da mesma etapa não exige nova autorização.
4. Retornar uma missão para etapa de encerramento não é impedido pelo gate de saída.

### User Story 3 — Adotar o controle sem interromper o legado (Priority: P2)

Projetos sem Gestão de Projetos iniciada permanecem no regime legado até serem classificados explicitamente pelo gestor.

**Independent Test**: executar as operações protegidas em um projeto sem workflow e confirmar que continuam disponíveis; iniciar a gestão e confirmar que o gate passa a valer imediatamente.

**Acceptance Scenarios**:

1. Ausência do registro de gestão identifica um projeto legado e não bloqueia a operação.
2. A existência do registro de gestão ativa o controle, independentemente da data de criação do projeto.
3. A mensagem de bloqueio identifica que a liberação deve ser resolvida na Gestão de Projetos.
4. Todas as superfícies protegidas usam a mesma decisão e o mesmo código de erro.

### Edge Cases

- Mover diretamente de Aguardando para Execução também exige autorização.
- Voltar de uma etapa posterior para Mobilização ou Execução representa remobilização e exige autorização.
- Editar romaneio de saída reverte e recria movimentos; por isso exige autorização antes de gerar novos arquivos.
- Uma autorização com data histórica e versão divergente permanece inválida.
- O projeto inexistente continua sendo tratado pela validação própria de cada módulo.

## Requirements

### Functional Requirements

- **FR-001**: O sistema MUST ter uma decisão única de autorização operacional por projeto.
- **FR-002**: Projeto sem Gestão de Projetos iniciada MUST ser classificado como legado não controlado.
- **FR-003**: Projeto com Gestão de Projetos iniciada MUST exigir autorização vigente para operações de saída.
- **FR-004**: A decisão MUST recalcular a prontidão e validar etapa, data e versão da autorização no momento da operação.
- **FR-005**: Entrada de missão oficial em Mobilização ou Execução MUST consultar o gate quando houver mudança de etapa.
- **FR-006**: Missões de cenário e reordenação dentro da etapa atual MUST permanecer disponíveis.
- **FR-007**: Criação e atualização de romaneio de saída MUST consultar o gate antes de gerar arquivos ou alterar dados.
- **FR-008**: Romaneio de entrada MUST permanecer disponível.
- **FR-009**: Retirada direta de estoque por uso em projeto MUST consultar o gate dentro da mesma operação transacional.
- **FR-010**: Devolução da obra, compra, inventário, perda, descarte e estorno MUST manter suas regras atuais.
- **FR-011**: A integração automática de estoque originada por romaneio de saída MUST usar a mesma decisão central.
- **FR-012**: A recusa MUST responder como conflito com código `PROJECT_MOBILIZATION_NOT_AUTHORIZED`, mensagem em pt-BR, situação da autorização e bloqueios explicáveis.
- **FR-013**: Uma operação recusada MUST preservar arquivos, saldos, posição do Kanban e trilhas de auditoria.
- **FR-014**: A campanha vigente da Gestão de Projetos MUST informar que saídas de equipe, equipamentos e materiais passam a respeitar a autorização.

### Visual/UI Contract

| Surface | Behavior | Existing component | Responsive |
|---|---|---|---|
| Gestão de Projetos | Explica que o gate protege saídas operacionais | painel de gate e campanha vigente | texto quebra dentro do modal/card |
| Efetivo, Romaneio e Estoque | Exibe a mensagem retornada ao tentar operação bloqueada | Toast existente | mensagem legível em mobile |

### Key Entities

- Controle de mobilização: decisão calculada como legado, autorizado ou bloqueado.
- Operação protegida: mobilização de equipe, romaneio de saída ou retirada de material para obra.
- Autorização vigente: gate verde, etapa pronta e versão atual igual à versão autorizada.

## Success Criteria

- **SC-001**: 100% das operações de saída em projetos gerenciados são recusadas quando a autorização não está vigente.
- **SC-002**: 100% das operações recusadas deixam documentos, saldos, posições e auditorias inalterados.
- **SC-003**: 100% dos retornos e operações legadas cobertos pelos cenários permanecem disponíveis.
- **SC-004**: As três superfícies protegidas retornam o mesmo código e uma orientação compreensível para correção.
- **SC-005**: A mensagem de bloqueio permanece legível em telas de 390 px sem rolagem horizontal da página.

## Assumptions

- Iniciar a Gestão de Projetos é a classificação explícita que ativa o controle.
- Não existe exceção manual na operação protegida; a liberação ocorre no projeto e fica auditada lá.
- Esta entrega não cria a etapa Em Execução nem altera automaticamente o workflow mestre.
- As interfaces atuais já apresentam erros de mutação por Toast.
