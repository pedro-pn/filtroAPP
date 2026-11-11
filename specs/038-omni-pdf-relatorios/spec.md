# Feature Specification: Documentos de relatórios para o Omni

**Feature Branch**: `feat/omni-pdf-relatorios`
**Created**: 2026-11-11
**Status**: Implemented
**Input**: `../omni/docs/integracoes/prompt-filtroapp-pdf-relatorios.md`

## User Scenarios & Testing

### User Story 1 - Baixar o documento do relatório (Priority: P1)

Como equipe da missão no Omni, quero baixar o PDF pronto que corresponde ao relatório, preservando assinaturas e a autorização da integração.

**Why this priority**: O documento é necessário para consulta e compartilhamento da operação.
**Independent Test**: Comparar o documento escolhido com o download interno para final, ZapSign, manual, base aprovada e cache.

**Acceptance Scenarios**:
1. **Given** documento pronto e credencial autorizada, **When** solicita download, **Then** recebe PDF com nome e tamanho corretos.
2. **Given** documento não pronto, **When** solicita download, **Then** recebe conflito com orientação de nova tentativa, sem esperar uma conversão.
3. **Given** projeto não autorizado ou relatório invisível, **When** solicita download, **Then** nenhum documento é exposto.

### User Story 2 - Descobrir documentos disponíveis (Priority: P2)

Como consumidor Omni, quero saber quais relatórios possuem documento e localizar os documentos de manutenção sem duplicá-los.

**Why this priority**: Evita downloads sem documento e permite navegar aos anexos existentes.
**Independent Test**: Listar com e sem a permissão nova e conferir versão, nome, data e identificadores de manutenção.

**Acceptance Scenarios**:
1. **Given** permissão de PDF, **When** lista relatórios, **Then** recebe disponibilidade e metadados de documento.
2. **Given** credencial antiga, **When** lista relatórios, **Then** o contrato anterior é preservado sem campo PDF.
3. **Given** RDO de manutenção, **When** lista, **Then** recebe somente identificadores de documentos autorizados para download na rota de manutenção.

### User Story 3 - Associar colaborador à conta corporativa (Priority: P2)

Como Omni, quero relacionar o colaborador alocado à conta da empresa para determinar associação à missão.

**Why this priority**: A alocação deve poder ser reconhecida sem acesso a CPF ou contatos pessoais.
**Independent Test**: Consultar colaboradores com/sem permissão de contato, contas corporativas, pessoais e ausentes.

**Acceptance Scenarios**:
1. **Given** escopo específico e conta corporativa, **When** consulta colaborador, **Then** recebe e-mail corporativo e identificador de conta.
2. **Given** e-mail pessoal, **When** consulta, **Then** o e-mail pessoal nunca aparece.
3. **Given** credencial antiga, **When** consulta, **Then** não recebe campos adicionais de contato.

### Edge Cases

- Arquivo ausente, corrupto, hash divergente, link simbólico ou caminho fora do armazenamento não libera bytes.
- Arquivo maior que 50 MiB é recusado antes da leitura integral.
- Relatórios pendentes/devolvidos exigem leitura de todos os estados; rascunhos e excluídos permanecem invisíveis.
- Um PDF final indisponível não pode ser substituído silenciosamente por versão inferior.
- Manutenção mantém as permissões, visibilidade e recorte da rota de anexos existente.

## Requirements

### Functional Requirements

- **FR-001**: Adicionar download de PDF com permissão explícita dependente de leitura de relatórios e sensibilidade pessoal.
- **FR-002**: Preservar prioridade final assinado, ZapSign, manual, base aprovada e cache fresco da tela.
- **FR-003**: Não converter, reconciliar ou reparar documentos durante o pedido de integração; informar documento não pronto e prazo de nova tentativa.
- **FR-004**: Aplicar validação de entrada, visibilidade da listagem, recorte de projetos, cotas, tamanho máximo, nome seguro e proibição de cache.
- **FR-005**: Acrescentar metadados de PDF somente para credenciais com a nova permissão; documentar cobertura e custo da listagem.
- **FR-006**: Referenciar documentos de manutenção ligados ao relatório e acessíveis pelo download existente.
- **FR-007**: Acrescentar e-mail exclusivamente do domínio corporativo e identificador da conta sob permissão pessoal própria, sem e-mail pessoal, CPF ou outros dados privados.
- **FR-008**: Preservar tokens, contratos e consumidores atuais; atualizar catálogo, documentação e contrato versionado.
- **FR-009**: Documentar proposta separada para tratar SIGNED como publicado, sem alterar publishedReport nesta feature.
- **FR-010**: Cobrir regras e negativos em testes de backend e executar suíte e verificação arquitetural.

### Visual/UI Contract

N/A - no frontend UI changes. Catálogo e playground existentes consomem metadados das novas permissões; não há nova tela nem campanha visual.

### Key Entities

- **Relatório**: identificação, estado, projeto e documento correspondente.
- **Versão do documento**: origem, integridade, nome e data do PDF pronto.
- **Documento de manutenção**: anexo DOCUMENT de registro ligado ao relatório.
- **Contato corporativo**: associação restrita entre colaborador, conta e e-mail da empresa.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Todos os documentos prontos das cinco origens mantêm a prioridade documentada e permitem download autorizado.
- **SC-002**: Documento não pronto não espera conversão de até 60 segundos; resposta cabe no prazo de 15 segundos da integração.
- **SC-003**: Nenhum token antigo recebe novas permissões ou campos pessoais adicionais.
- **SC-004**: Todos os cenários de autorização, integridade e limites possuem evidência de validação.

## Assumptions

- Escopo corporativo será explícito e PERSONAL; conta sem e-mail corporativo retorna e-mail nulo.
- A integração serve o PDF base/final pronto sem composição de anexos de até 200 MiB; a limitação será documentada.
- Geração em segundo plano é opcional no pedido; não será criada fila efêmera nova. PDFs ausentes são preparados pelo fluxo existente da tela.
- Listagem usa indicador barato de versões persistidas; não valida bytes/hashes nem inspeciona cache do disco. Download é a verificação definitiva.
- Publicação de SIGNED e mudanças no Omni são fora do escopo desta implementação.

## Clarifications

### Session 2026-11-11

Nenhuma ambiguidade crítica exige pergunta: as opções de custo de composição, geração e metadados foram autorizadas pelo prompt. O plano documenta escolhas conservadoras e sua cobertura.
