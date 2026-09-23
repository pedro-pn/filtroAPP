# Feature Specification: execução do projeto

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-09
**Status**: Implementado
**Input**: Continuar a gestão de projetos com a etapa Em execução e seu painel operacional.

## User Scenarios & Testing

### User Story 1 — Iniciar a execução sem perder a autorização (Priority: P1)

O Líder de Projetos move uma obra autorizada de Pronto para mobilizar para Em execução. A autorização permanece vigente durante a mudança e continua liberando as operações protegidas.

**Independent Test**: autorizar um workflow pronto, avançá-lo e consultar novamente o gate operacional.

**Acceptance Scenarios**:

1. A transição para Em execução falha quando a autorização não está vigente.
2. A transição autorizada preserva a data de autorização e atualiza sua versão para a versão da mudança.
3. Romaneio, Estoque e Efetivo continuam reconhecendo a autorização em Em execução.
4. Uma alteração posterior em dado relevante suspende a autorização até revalidação.

### User Story 2 — Acompanhar avanço e documentos operacionais (Priority: P1)

Ao abrir um projeto Em execução, o Líder vê tempo previsto, tempo transcorrido, avanço realizado, término esperado e projetado, RDOs, quantitativos, evidências e relatórios técnicos.

**Independent Test**: consultar o painel com dados do Acompanhamento e relatórios em estados distintos.

**Acceptance Scenarios**:

1. Avanço e prazos vêm da mesma fonte usada pelo Acompanhamento.
2. RDOs distinguem recebidos, liberados ao cliente e assinados, além de indicar quantitativos e evidências.
3. Relatórios técnicos mostram emitidos e meta esperada, com detalhe de aprovados, assinados e devolvidos.
4. RLR pode ter quantidade realizada manual porque ainda não existe como tipo de relatório no sistema.
5. A ausência de dados aparece como informação indisponível, sem estimativa inventada.

### User Story 3 — Registrar e acompanhar desvios (Priority: P1)

O Líder registra um desvio do projeto com categoria, descrição, responsável, prazo, impacto, ação e status. O registro aparece também no módulo Qualidade.

**Independent Test**: criar um desvio pelo painel, listar os desvios do projeto e atualizar seu status.

**Acceptance Scenarios**:

1. As categorias disponíveis são Prazo, Escopo, Cliente, Equipamento, Pessoal, Material, Segurança, Qualidade e Comercial.
2. Todos os campos exigidos são validados no cliente e no servidor.
3. O backend grava um `QualityRecord` do tipo `DESVIO`, associado ao projeto e à natureza da categoria.
4. O Líder ou gestor pode atualizar o status no painel; demais usuários consultam sem editar.

## Requirements

- **FR-001**: O workflow MUST incluir a etapa `EXECUTION` após `READY_TO_MOBILIZE`.
- **FR-002**: A transição `READY_TO_MOBILIZE → EXECUTION` MUST exigir autorização vigente.
- **FR-003**: A autorização MUST ser válida tanto em `READY_TO_MOBILIZE` quanto em `EXECUTION` quando gate e versão coincidirem.
- **FR-004**: O sistema MUST permitir revalidar o gate na etapa `EXECUTION`.
- **FR-005**: O painel MUST reutilizar os dados de avanço e prazo do Acompanhamento.
- **FR-006**: O painel MUST consultar `Report` e relações existentes para as métricas de RDO e relatórios técnicos.
- **FR-007**: Metas dos relatórios técnicos MUST ser persistidas no registro mestre do workflow e auditadas sem suspender a autorização.
- **FR-008**: Tipos de relatório já integrados MUST ter numerador calculado automaticamente.
- **FR-009**: O tipo RLR MUST aceitar numerador manual até existir uma fonte integrada.
- **FR-010**: Desvios MUST ser persistidos no módulo Qualidade, sem entidade paralela.
- **FR-011**: Criação e alteração de desvio MUST ficar restrita ao Líder designado e ao gestor do Efetivo.
- **FR-012**: Entradas das novas APIs MUST ser validadas com Zod.
- **FR-013**: O painel MUST ser responsivo, em pt-BR e usar o modal e botões do kit atual.
- **FR-014**: A função MUST ter campanha temporária de novidade, uma vez por usuário, com expiração em 19/09/2026.

## Success Criteria

- **SC-001**: Nenhuma obra entra em execução sem autorização vigente.
- **SC-002**: Uma obra autorizada continua aceita pelos três bloqueios operacionais depois da transição.
- **SC-003**: As contagens do painel correspondem aos relatórios não excluídos persistidos.
- **SC-004**: Um desvio criado no painel aparece na consulta de desvios do módulo Qualidade.
- **SC-005**: O painel cabe em desktop e mobile sem cortar campos ou causar rolagem horizontal da página.

## Assumptions

- `diasCorridos.pct` do Acompanhamento representa o avanço previsto linear pelo prazo; `avancoPct` representa o realizado.
- Relatório liberado ao cliente é um RDO nos estados `APPROVED` ou `SIGNED`; `SIGNED` representa conclusão das assinaturas.
- RLR não existe em `ReportType` nesta data e, por isso, usa contagem manual explícita.
- Metas de relatórios são informativas nesta entrega e não bloqueiam a entrada em execução.
