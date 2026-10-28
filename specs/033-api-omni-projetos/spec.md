# Feature Specification: API de projetos para o Omni

**Feature Branch**: `feat/api-omni-projetos`
**Created**: 2026-10-28
**Status**: Implemented — validated locally, not deployed
**Input**: `../omni/docs/integracoes/prompt-filtroapp-omni.md`, Parte 1.

## User Scenarios & Testing

### User Story 1 - Conhecer o contrato operacional (Priority: P1)

O Omni consulta projetos para identificar cliente, proposta e regime de trabalho e reconhecer RDOs fora do contratado.

**Independent Test**: consultar um projeto autorizado com os novos campos e comparar o resultado anterior.

**Acceptance Scenarios**:
1. **Given** um token com `projetos.read`, **When** consultar projetos, **Then** os campos atuais permanecem e os nove campos solicitados são acrescentados.
2. **Given** um projeto sem workflow, **When** consultado, **Then** `executedAtHeadquarters` é nulo.

### User Story 2 - Endereçar as pessoas da missão (Priority: P1)

O Omni identifica o Líder de Projetos, Gestor de Contrato e operador de campo pelo e-mail corporativo.

**Independent Test**: percorrer páginas com uma linha por projeto e papel e conferir os vínculos.

**Acceptance Scenarios**:
1. **Given** responsáveis cadastrados, **When** consultar com `projetos.responsaveis.read`, **Then** LEADER corresponde a leaderUserId, PLANNER a plannerUserId e FIELD_OPERATOR a operatorId.
2. **Given** e-mail pessoal ou ausência de usuário, **When** consultar, **Then** email é nulo; nunca usar e-mail do colaborador nem username como fallback.
3. **Given** token sem o escopo ou projeto fora do recorte, **When** consultar, **Then** retornar 403 sem acessar dados.
4. **Given** mudança somente no workflow, **When** consultar com updatedSince, **Then** incluir os responsáveis usando o maior updatedAt entre projeto e workflow.

### User Story 3 - Sincronizar status em uma coleção (Priority: P1)

O Omni lê status, gates e avanço em uma coleção para reduzir 42 requisições a uma página de até 100 projetos.

**Independent Test**: comparar cada item com a projeção individual e verificar os quatro campos de datas/prazo.

**Acceptance Scenarios**:
1. **Given** projetos autorizados, **When** filtrar por active, projectCode/projectId ou stage, **Then** retornar somente os projetos correspondentes.
2. **Given** mudança no avanço sem nova versão de workflow, **When** repetir a leitura completa, **Then** refletir o novo avanço; updatedSince é rejeitado.
3. **Given** consumidor CRM existente, **When** consultar por id, **Then** contrato e comportamento permanecem iguais.

### Edge Cases

- Papéis ausentes não geram linhas; uma pessoa em dois papéis gera duas linhas.
- Sem workflow pode existir somente FIELD_OPERATOR; sem responsáveis, nenhuma linha.
- Projetos excluídos e fora da política nunca aparecem.
- Cursor adulterado, filtros/política alterados ou snapshot incompatível são rejeitados.
- Mudança de pessoa, exclusão ou desvinculação exige reconciliação completa periódica, pois não há tombstones.
- Edição de nome/e-mail de usuário não altera necessariamente os carimbos do projeto/workflow.

## Requirements

### Functional Requirements

- **FR-001**: Acrescentar clientName, clientCnpj (14 dígitos ou nulo para legado inválido), commercialProposalCode, endDate, includesSaturday, includesSunday, workdayHours, weekendWorkdayHours e executedAtHeadquarters a projetos.
- **FR-002**: Publicar responsáveis com projectId, projectCode, role, userId, collaboratorId, name, email e updatedAt; sensibilidade PERSONAL; escopo próprio AVAILABLE.
- **FR-003**: Expor exclusivamente e-mails de User no domínio exato `filtrovali.com.br`, conforme confirmação do usuário.
- **FR-004**: Responsáveis aceitam updatedSince, projectCode/projectId mutuamente exclusivos, limit, cursor e snapshotAt.
- **FR-005**: Publicar coleção de status com a projeção individual mais commercialExpectedMobilizationDate, commercialExpectedStartDate, commercialExpectedDurationDays e actualMobilizationDate; sem updatedSince.
- **FR-006**: Preservar paginação assinada, snapshot, isolamento por projeto, cotas e allowlists de saída.
- **FR-007**: Atualizar catálogo, Playground, OpenAPI e documentação; manter schemaVersion 1.0, pois o envelope permanece igual e as mudanças são aditivas.
- **FR-008**: Corrigir as seis siglas do README; inventariar divergências em UI/documentos sem editar templates DOCX de clientes.
- **FR-009**: Registrar a Parte 2 somente como spec de backlog, sem liberar seus escopos ou funcionalidades.

### Visual/UI Contract

Catálogo e formulários do Playground existentes são alimentados por descritores do backend. Não há tela, controle, navegação ou interação nova; preservam-se componentes e estilos atuais. Divulgação/tutorial não se aplica à atualização de metadados do contrato.

### Key Entities

- Projeto: identidade, cliente e regime operacional.
- Responsável: vínculo de uma pessoa a um projeto e papel.
- Status: resumo calculado do workflow e avanço, sem pessoas, documentos, textos de pendências ou valores.

## Success Criteria

- **SC-001**: Os 42 projetos ativos podem ser sincronizados em uma requisição com limite de 100.
- **SC-002**: Nenhum dado de projetos fora do recorte ou campo excluído aparece nos testes.
- **SC-003**: Consumidores atuais continuam recebendo todos os campos e envelopes anteriores.
- **SC-004**: Cada papel disponível possui a identidade correta e somente e-mail corporativo autorizado.
