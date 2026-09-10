# Feature Specification: Documentos do projeto

**Feature Branch**: `feat/016-gestao-projetos-efetivo`

**Created**: 2026-09-10

**Status**: Implementado em 2026-09-10

**Input**: Preparar a próxima entrega do planejamento de Gestão de Projetos: organizar propostas, pedido de compra, contrato, desenhos, especificações, certificados e evidências dentro do projeto, com versões, responsabilidades, aceite, assinatura e preparação para o futuro CRM.

## User Scenarios & Testing

### User Story 1 - Organizar documentos manuais do projeto (Priority: P1)

O Líder de Projetos e as áreas autorizadas cadastram os documentos necessários no próprio detalhe da obra, consultam a versão vigente e preservam as versões anteriores.

**Why this priority**: O projeto precisa de uma fonte única para saber qual arquivo está vigente, quem responde por ele e se ainda falta alguma ação antes de mobilizar ou encerrar.

**Independent Test**: Pode ser validado cadastrando um documento, anexando duas versões e confirmando que a mais recente aparece como vigente enquanto a anterior continua disponível no histórico.

**Acceptance Scenarios**:

1. **Given** um projeto ativo, **When** um usuário autorizado cadastra um documento com tipo, título e responsável, **Then** o documento aparece na categoria Documentos do projeto.
2. **Given** um documento com uma versão vigente, **When** uma nova versão é anexada, **Then** a nova versão se torna vigente e a anterior permanece consultável sem alteração.
3. **Given** um projeto encerrado, **When** o usuário abre seus documentos, **Then** ele pode consultar e baixar o histórico, mas não pode alterar o catálogo até a reabertura.
4. **Given** um documento de origem manual, **When** um usuário sem permissão para aquele tipo tenta alterá-lo, **Then** a operação é recusada sem modificar o histórico.

---

### User Story 2 - Controlar aceite e prontidão documental (Priority: P1)

O Líder define quais documentos são necessários no handover, na mobilização ou no encerramento e acompanha se a versão vigente está disponível e aceita.

**Why this priority**: A existência de um arquivo não prova que ele está vigente ou aprovado. O gate precisa explicar exatamente qual documento está faltando ou aguarda aceite.

**Independent Test**: Pode ser validado marcando um documento como obrigatório para mobilização, registrando seu aceite e verificando o bloqueio antes e a liberação depois do aceite.

**Acceptance Scenarios**:

1. **Given** um documento obrigatório sem versão acessível, **When** a prontidão da etapa é calculada, **Then** o documento aparece como bloqueio com motivo claro.
2. **Given** um documento que exige aceite interno ou do cliente, **When** apenas o arquivo é anexado, **Then** ele permanece pendente até o aceite explícito da versão vigente.
3. **Given** um documento aceito, **When** uma nova versão se torna vigente, **Then** o aceite anterior continua no histórico e a nova versão volta ao estado pendente.
4. **Given** um documento obrigatório que muda depois da autorização para mobilização, **When** a nova versão ou o aceite altera sua prontidão, **Then** a autorização é invalidada e o projeto permanece na mesma coluna com o motivo registrado.
5. **Given** um projeto legado sem requisitos documentais cadastrados, **When** sua prontidão é calculada, **Then** ele não recebe um bloqueio novo apenas pela ativação da funcionalidade.

---

### User Story 3 - Reusar assinaturas, RDOs e relatórios existentes (Priority: P2)

O usuário prepara a assinatura de um PDF pela funcionalidade de Assinaturas já existente e consulta, no mesmo detalhe do projeto, os RDOs e relatórios técnicos que já pertencem à obra.

**Why this priority**: A integração evita arquivos duplicados e mantém cada módulo como fonte oficial de seu próprio processo.

**Independent Test**: Pode ser validado enviando um PDF para assinatura, concluindo o fluxo existente e confirmando o status e o documento final no projeto; RDOs e relatórios devem aparecer sem criar uma segunda cópia.

**Acceptance Scenarios**:

1. **Given** uma versão vigente em PDF, **When** o usuário escolhe preparar assinatura, **Then** o sistema abre o fluxo de Assinaturas para aquele documento e mantém o vínculo com o projeto.
2. **Given** uma assinatura concluída, **When** o projeto é recarregado, **Then** o status concluído e o arquivo final assinado ficam disponíveis no documento do projeto.
3. **Given** um documento que exige assinatura, **When** a assinatura ainda não foi concluída, **Then** sua prontidão permanece pendente.
4. **Given** RDOs ou relatórios vinculados ao projeto, **When** o usuário abre a categoria documental, **Then** eles aparecem em uma área operacional de consulta com seus estados atuais e sem duplicação no catálogo versionado.

---

### User Story 4 - Receber documentos do futuro CRM (Priority: P3)

Quando a integração comercial estiver disponível, propostas, pedido de compra e contrato chegam ao projeto como referências versionadas e identificadas pela fonte, sem permitir que o FiltroAPP altere o conteúdo pertencente ao CRM.

**Why this priority**: O modelo precisa nascer compatível com a futura fonte comercial para evitar migração e conflito de autoria, embora o conector ainda não faça parte desta entrega.

**Independent Test**: Pode ser validado por eventos simulados da integração: repetir o mesmo evento não duplica a versão, uma versão antiga não substitui a atual e uma versão do CRM permanece somente leitura.

**Acceptance Scenarios**:

1. **Given** uma referência comercial inédita do CRM, **When** ela é recebida, **Then** o documento é associado ao projeto com origem, identificador externo, versão e data da fonte.
2. **Given** o mesmo evento recebido novamente, **When** ele é processado, **Then** nenhuma versão duplicada é criada.
3. **Given** uma versão externa mais antiga que a vigente, **When** ela é recebida fora de ordem, **Then** ela não substitui a versão atual.
4. **Given** um documento cuja fonte é o CRM, **When** um usuário tenta substituir ou editar sua versão no FiltroAPP, **Then** a alteração é recusada e a consulta oferece acesso à origem externa.
5. **Given** que o CRM ainda não está integrado, **When** a área Comercial precisa registrar uma proposta, pedido ou contrato, **Then** o fluxo manual autorizado continua disponível e identificado como manual.

### Edge Cases

- Uma referência externa indisponível ou sem endereço válido não conta como versão acessível para um gate.
- Arquivo gravado com sucesso, mas cujo cadastro falha, não pode ficar órfão no armazenamento.
- Arquivo com tipo, extensão, tamanho ou conteúdo não permitido é recusado antes de virar versão.
- Arquivo com nome malicioso ou tentativa de atravessar diretórios não altera o caminho de armazenamento.
- Uma versão rejeitada permanece no histórico; a próxima versão começa com um novo estado de aceite.
- Arquivar um documento obrigatório volta a bloqueá-lo enquanto não houver substituto válido.
- Uma nova versão criada enquanto há assinatura em andamento não herda o processo nem o aceite da versão anterior.
- Uma versão já assinada continua auditável quando deixa de ser vigente.
- Duas alterações concorrentes não podem substituir silenciosamente a versão vigente ou o aceite.
- O envio de um arquivo não transforma automaticamente uma proposta em aceita nem um pedido de compra em recebido; os fatos comerciais continuam explícitos.

## Requirements

### Functional Requirements

- **FR-001**: O sistema MUST manter um catálogo de documentos associado ao registro mestre do projeto.
- **FR-002**: Cada documento MUST possuir tipo, título, responsável, origem, situação, data de criação e histórico de alterações.
- **FR-003**: O catálogo MUST suportar proposta comercial, proposta técnica, pedido de compra, contrato, desenho, especificação, certificado, requisito do cliente, evidência técnica e outros.
- **FR-004**: Um documento MUST poder receber múltiplas versões, com apenas uma versão vigente por vez.
- **FR-005**: Versões anteriores MUST permanecer imutáveis, identificáveis e disponíveis para usuários autorizados.
- **FR-006**: Cada versão MUST registrar origem manual, CRM ou sistema e os dados de autoria ou procedência disponíveis.
- **FR-007**: Uma versão manual com arquivo MUST registrar nome original, formato, tamanho e resumo de integridade.
- **FR-008**: Uma versão externa MUST registrar identificador, versão, data da fonte e endereço de consulta quando fornecidos.
- **FR-009**: O sistema MUST validar formato, tamanho e conteúdo permitido antes de aceitar um arquivo.
- **FR-010**: O download MUST exigir autenticação e acesso ao projeto, sem revelar o caminho físico do arquivo.
- **FR-011**: O usuário autorizado MUST poder arquivar e restaurar um documento sem apagar seu histórico.
- **FR-012**: O sistema MUST aplicar controle de concorrência na alteração do documento vigente, aceite e arquivamento.
- **FR-013**: Cada documento MAY ser classificado como informativo ou obrigatório para handover, mobilização ou encerramento.
- **FR-014**: Um requisito documental só MUST bloquear uma etapa quando tiver sido configurado explicitamente para essa etapa.
- **FR-015**: A prontidão MUST considerar a existência e a acessibilidade da versão vigente.
- **FR-016**: Documentos com aceite interno ou do cliente MUST exigir decisão explícita sobre a versão vigente, com situação, autor e data.
- **FR-017**: Documentos que exigem assinatura MUST permanecer pendentes até a conclusão do processo de assinatura vinculado.
- **FR-018**: Uma nova versão MUST preservar o aceite anterior no histórico e reiniciar a avaliação da nova versão.
- **FR-019**: Alterações documentais que afetem um requisito de mobilização MUST invalidar uma autorização de mobilização vigente e registrar o motivo, sem mover automaticamente o card.
- **FR-020**: Projetos sem requisitos documentais cadastrados MUST conservar o comportamento atual e não receber bloqueios retroativos.
- **FR-021**: Propostas técnica e comercial vigentes MAY servir como evidência para os controles correspondentes do handover sem declarar automaticamente fatos comerciais de aceite, pedido ou contrato.
- **FR-022**: O catálogo MUST integrar PDFs ao processo de Assinaturas existente e refletir seu estado e documento final, sem duplicar signatários ou auditoria.
- **FR-023**: Apenas versões compatíveis com o processo de Assinaturas existente MUST oferecer a ação de preparação para assinatura.
- **FR-024**: RDOs e relatórios técnicos já vinculados ao projeto MUST aparecer como documentos operacionais de consulta, sem gerar cópias no catálogo versionado.
- **FR-025**: Documentos de origem CRM MUST ser somente leitura no FiltroAPP.
- **FR-026**: O recebimento futuro de eventos do CRM MUST ser idempotente e MUST impedir que uma versão externa antiga substitua a mais recente.
- **FR-027**: O registro manual de documentos comerciais MUST continuar disponível até a integração correspondente entrar em operação.
- **FR-028**: Uma referência externa MUST ser copiada para o armazenamento local apenas quando assinatura, retenção ou disponibilidade operacional exigir.
- **FR-029**: O acesso MUST respeitar a visibilidade existente do projeto e as responsabilidades da área para cada tipo documental.
- **FR-030**: Projetos encerrados MUST permitir somente consulta documental até serem reabertos pelo fluxo já existente.
- **FR-031**: Falhas após a gravação de um novo arquivo MUST desfazer o arquivo ainda não associado para evitar conteúdo órfão.
- **FR-032**: O detalhe MUST explicar, em linguagem direta, quando um documento bloqueia um gate e qual ação falta.

### Visual/UI Contract

| Surface | Existing reference audited | Shared component/classes | Required states | Mobile behavior |
|---------|----------------------------|--------------------------|-----------------|-----------------|
| Categoria “Documentos do projeto” no detalhe | `frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx` e `ProjectWorkflowCategory.tsx`, categorias recolhíveis atuais | Modal existente, Button, badges e categorias do diálogo | carregando, vazio, erro, concluído/recolhido, somente leitura e bloqueio explicado | corpo rolável, rodapé fixo, conteúdo sem corte e categoria recolhível |
| Cadastro/edição de documento e versão | formulários atuais do detalhe da evolução | react-hook-form, Zod, `field-group`, `field-invalid`, `field-error`, componentes de formulário compartilhados | padrão, foco, desabilitado, obrigatório vazio, arquivo inválido e envio em andamento | campos empilhados, ações acessíveis e sem rolagem horizontal da página |
| Histórico e documentos operacionais | listas responsivas já usadas no detalhe do projeto | cards/listas, Button, badges e links compartilhados | vigente, anterior, pendente, aceito, rejeitado, arquivado e origem externa | linhas largas viram cards e textos/nomes longos quebram ou truncam |

A categoria faz parte do diálogo e do Kanban únicos já existentes. O projeto aberto continua representado pelo parâmetro de URL atual. Não há reordenação por arraste nesta entrega. A implementação MUST incluir uma campanha temporária de novidade e um tutorial curto, limitados aos primeiros 10 dias após a data registrada na implementação, mostrando onde anexar, versionar e consultar bloqueios documentais.

### Key Entities

- **Documento do projeto**: registro lógico classificado, associado a um projeto, com responsável, exigência de etapa, regra de aceite, versão vigente e estado de arquivamento.
- **Versão do documento**: registro imutável de um arquivo gerenciado, referência externa ou documento produzido por outro módulo, com procedência, integridade e aceite próprios.
- **Aceite documental**: decisão aplicada à versão vigente, com tipo de aceite, situação, data de negócio, autor, registro e observação.
- **Vínculo de assinatura**: referência ao processo e ao resultado mantidos pela funcionalidade de Assinaturas.
- **Documento operacional**: projeção para consulta de RDO ou relatório já pertencente ao projeto e mantido pelo módulo de origem.

### Assumptions and Dependencies

- O projeto continua sendo o registro mestre; o catálogo não cria uma nova obra nem um segundo Kanban.
- O armazenamento protegido, a autenticação, a visibilidade de projetos, o fluxo de Assinaturas e os vínculos atuais de RDOs/relatórios serão reutilizados.
- A integração real, autenticação, webhooks e telas do CRM ficam fora desta entrega; serão definidos apenas o modelo e o contrato de entrada.
- A existência de um arquivo não substitui as respostas estruturadas de liberação comercial, medição ou faturamento.
- Não haverá migração automática de arquivos históricos dispersos nem eliminação física por política de retenção nesta entrega.
- As áreas Comercial, Operações, Administrativo/RH, QSMS e Ativos poderão manter os tipos ligados às suas responsabilidades; Líder de Projetos e gestores poderão coordenar o conjunto.

## Success Criteria

- **SC-001**: Um usuário autorizado cadastra um documento e sua primeira versão em até dois minutos, sem sair do detalhe do projeto.
- **SC-002**: Em 100% dos testes de versionamento, a versão vigente é inequívoca e as anteriores permanecem consultáveis e inalteradas.
- **SC-003**: Em 100% dos bloqueios documentais simulados, o detalhe identifica o documento e a ação necessária para liberar a etapa.
- **SC-004**: Nenhum projeto legado sem requisito documental configurado recebe bloqueio novo na validação de regressão.
- **SC-005**: Reprocessar o mesmo evento externo não cria duplicata, e eventos antigos não substituem a versão externa vigente.
- **SC-006**: RDOs, relatórios e documentos assinados são consultáveis no projeto por vínculo com suas fontes, sem criar uma segunda cópia do registro de negócio.
- **SC-007**: Usuários sem visibilidade do projeto ou sem responsabilidade documental não conseguem consultar ou alterar arquivos além de sua permissão.
- **SC-008**: O diálogo funciona em desktop e em telefone estreito sem cortar campos nem gerar rolagem horizontal da página.

## Out of Scope

- Implementar o conector, webhooks, autenticação ou interface do CRM.
- Substituir os módulos de Assinaturas, Relatórios, RDO, Qualidade, Estoque ou Equipamentos.
- Interpretar automaticamente cláusulas de contratos, propostas ou pedidos.
- Migrar automaticamente todos os arquivos legados.
- Executar expurgo físico ou definir a política corporativa de retenção documental.

## Implemented Decisions

- O catálogo foi incluído como categoria recolhível no diálogo já existente da Evolução; o Kanban, a URL do projeto, o arraste e os botões de equipe não foram substituídos.
- Requisitos documentais são opcionais e explícitos por etapa. Projetos sem requisitos continuam com os gates anteriores.
- Versões manuais usam armazenamento protegido, validação de conteúdo, SHA-256, histórico imutável e download autenticado. O caminho físico não integra a resposta pública.
- Aceite e assinatura pertencem à versão vigente. Uma nova versão reinicia sua própria decisão, preserva o histórico e suspende a autorização vigente quando o documento participa da mobilização.
- Propostas podem comprovar os itens correspondentes do handover e podem ser vinculadas ao fato comercial, mas não confirmam aceite, pedido, contrato ou condição comercial automaticamente.
- RDOs e relatórios são projetados a partir do módulo de origem. O adaptador CRM permanece interno, idempotente e sem webhook público nesta entrega.
