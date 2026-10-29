# Feature Specification: Integração Omni — fase 2

**Created**: 2026-10-28
**Status**: Entrega A implementada e validada localmente, sem deploy; Entrega B implementada e validada localmente, sem deploy
**Input**: `../omni/docs/integracoes/prompt-filtroapp-omni.md`, Parte 2.

## User Scenarios & Testing

### User Story 1 - Reagir às mudanças da missão (Priority: P1)

O Omni recebe mudanças relevantes sem depender exclusivamente de polling.

**Independent Test**: provocar cada evento e recuperar a mudança uma única vez no consumidor, inclusive após retomada.

**Acceptance Scenarios**:
1. **Given** RDO criado, aprovado, devolvido ou assinado; workflow com etapa alterada; Qualidade criada/alterada; romaneio emitido; ou responsáveis alterados, **When** consumir eventos, **Then** cada mudança possui identificador estável, projeto e instante, respeitando o recorte do token.
2. **Given** consumidor interrompido, **When** retomar pelo cursor, **Then** não perder eventos; duplicatas são reconhecíveis pelo identificador.
3. **Given** projeto não autorizado, **When** consumir eventos, **Then** nenhuma informação desse projeto é revelada.

### User Story 2 - Acompanhar e cobrar RDOs (Priority: P1)

O Omni distingue relatórios pendentes, devolvidos, aprovados e assinados para acompanhar atrasos e devoluções.

**Independent Test**: ler um relatório de cada estado com e sem o escopo próprio.

**Acceptance Scenarios**:
1. **Given** `rdo.relatorios.todos.read`, **When** consultar relatórios, **Then** PENDING, RETURNED, APPROVED e SIGNED são distinguíveis e filtráveis no recorte de projetos.
2. **Given** apenas `rdo.relatorios.read`, **When** consultar, **Then** o contrato atual de aprovados permanece igual.

### User Story 3 - Abrir registros de Qualidade pelo Omni (Priority: P1)

Uma resposta negativa a uma checagem da IA pode abrir um desvio rastreável no filtroAPP.

**Independent Test**: enviar a criação duas vezes com a mesma chave e confirmar um único registro.

**Acceptance Scenarios**:
1. **Given** escopo `qualidade.registros.create` e projeto permitido, **When** enviar `POST /qualidade/registros` com Idempotency-Key, **Then** criar registro com origin OMNI e responsável identificado por usuário.
2. **Given** mesma chave e mesmo conteúdo, **When** repetir, **Then** retornar o resultado anterior sem duplicar; mesma chave com conteúdo diferente retorna conflito.
3. **Given** tipo DESVIO, INCIDENTE ou RECLAMACAO_CLIENTE, **When** criar, **Then** aplicar validação e auditoria existentes, com ator/origem rastreáveis.
4. **Given** ausência de escopo ou projeto fora do recorte, **When** criar, **Then** rejeitar sem efeitos persistidos.

### User Story 4 - Reconhecer feriados por localidade (opcional para o filtroAPP)

Dispensada pelo Omni, que mantém calendário próprio. Fora das Entregas A/B do consumidor.

O Omni identifica feriados nacionais, da empresa e municipais para interpretar o regime operacional.

**Acceptance Scenarios**:
1. **Given** `efetivo.feriados.read`, **When** consultar uma cidade e período, **Then** retornar feriados aplicáveis e sua localidade.
2. **Given** Itajaí, **When** consultar o calendário, **Then** representar 15/06 e 08/12 como feriados municipais, sem aplicá-los automaticamente a outras cidades.

### User Story 5 - Confirmar chegada e descarga (Priority: P2)

O Líder de Projetos confirma a chegada e descarga dos equipamentos na obra com referência logística/fiscal.

**Acceptance Scenarios**:
1. **Given** romaneio de saída, **When** registrar chegada/descarga, **Then** preservar data, parcial/total, Líder que confirmou, transportadora e vínculos com NF e CT-e do Omie.
2. **Given** descarga parcial seguida de total, **When** completar, **Then** manter a trilha histórica e evitar confirmação duplicada.
3. **Given** CT-e disponível no Omie, **When** sincronizar, **Then** armazená-lo e vinculá-lo sem confundi-lo com NFS-e, NF-e ou ND.

### User Story 6 - Ler condições mínimas da proposta (Priority: P2)

A Gestão do Omni consulta permanência prevista e diária de stand-by de equipamentos sem acesso comercial amplo.

**Acceptance Scenarios**:
1. **Given** escopo mínimo próprio, como `projetos.condicoes.read`, **When** consultar projeto autorizado, **Then** retornar permanência prevista de CommercialProposal.plannedDays e diária de components.diariaEquipamento, com unidade e nulidade documentadas.
2. **Given** escopo mínimo, **When** consultar, **Then** não retornar outros dados de comercial.*, margens ou componentes da proposta.

### User Story 7 - Consultar Gestão com recorte por projeto (Priority: P2)

O Omni combina acompanhamento, financeiro, romaneios, alocações e ponto sem ampliar o acesso a dados individuais.

**Acceptance Scenarios**:
1. **Given** cada escopo próprio, **When** consultar, **Then** disponibilizar acompanhamento.progresso.read, acompanhamento.custos.read, omie.recebiveis.read, omie.compras.read, romaneios.itens.read e efetivo.alocacoes.read somente nos projetos autorizados.
2. **Given** ponto.resumos.read, **When** consultar, **Then** devolver agregado por projeto sem identificação ou dados individuais de colaboradores.
3. **Given** token sem um desses escopos, **When** consultar a operação correspondente, **Then** retornar 403.

### User Story 8 - Identificar outros responsáveis da missão (Priority: P3)

O filtroAPP registra vínculos estruturados para vendedor, documentação e mobilização, além da viagem da equipe.

**Acceptance Scenarios**:
1. **Given** vendedor da carteira, **When** associá-lo, **Then** manter referência estruturada; o texto legado CommercialProposal.vendedor permanece compatível até migração planejada.
2. **Given** projeto, **When** definir responsáveis por documentação e coordenação de mobilização, **Then** manter vínculos independentes e auditáveis.
3. **Given** viagem programada da equipe, **When** registrar a data, **Then** não confundi-la com mobilização nem início de execução.

### Edge Cases

- Eventos repetidos, fora de ordem, retenção expirada, exclusões e mudança da política do token.
- Responsável removido/inativo; proposta ou documento fiscal ainda não sincronizado.
- Feriados de cidades homônimas exigem identificação inequívoca de cidade/UF.
- Idempotência após timeout e concorrência; agregados com grupos pequenos não devem revelar pessoas.

## Requirements

### Functional Requirements

- **FR-001**: Publicar feed `GET /eventos?cursor=` em tabela própria, gravado na mesma transação da mudança, independente de NotificationEvent; sem webhook na Entrega A.
- **FR-002**: Aplicar o contrato [omni-phase2.md](contracts/omni-phase2.md): sequência crescente por banco, cursor assinado, retenção mínima de 30 dias e 410 CURSOR_EXPIRED; eventos.read mais escopo do recurso e recorte de projetos antes da paginação.
- **FR-003**: Criar leitura de RDOs além de APPROVED com escopo próprio e compatibilidade com consumidores atuais.
- **FR-004**: Criar escrita de Qualidade idempotente, origem OMNI, tipos definidos e responsável por usuário, preservando o campo legado actionOwner quando necessário à compatibilidade.
- **FR-005**: Leitura de feriados e suporte municipal são opcionais por necessidade própria do filtroAPP; não implementar para o Omni.
- **FR-006**: Persistir confirmação de chegada/descarga e importar CT-e do Omie com relações fiscais/logísticas.
- **FR-007**: Expor somente as duas condições comerciais solicitadas em escopo mínimo independente de comercial.*.
- **FR-008**: Liberar os sete escopos de Gestão definidos na US7 com projeções mínimas, cotas, paginação e isolamento por projeto; ponto somente agregado.
- **FR-009**: Projetar os novos vínculos e data da US8 com validação, auditoria e estratégia de compatibilidade.
- **FR-010**: Liberar apenas eventos.read, rdo.relatorios.todos.read e qualidade.registros.create na Entrega A. Entrega B publica medição, notas, romaneios, pendências e US5; US6–US8 remanescentes ficam em backlog; US4 não é necessária para o Omni.

### Key Entities

Evento de saída, relatório em revisão/assinatura, registro de Qualidade de origem Omni, feriado municipal, confirmação de descarga, CT-e, condições comerciais por projeto e responsáveis estruturados.

## Success Criteria

- **SC-001**: Cada mudança autorizada pode ser recuperada após interrupção sem perda silenciosa.
- **SC-002**: Reenvios de criação de Qualidade com a mesma chave produzem um único registro.
- **SC-003**: Todos os dados de Gestão permanecem dentro do projeto e escopos autorizados.
- **SC-004**: O Omni consegue distinguir feriados locais, etapas logísticas, responsáveis e estados de RDO sem inferir dados ausentes.

## Dependencies and Assumptions

Entrega A contratada por `../omni/docs/integracoes/prompt-filtroapp-fase2.md`, detalhada em plan.md e contracts/omni-phase2.md. Entrega B depende de contratos de CT-e, agregações e migração de vínculos. O Omni mantém seu calendário; feriados só serão implementados por necessidade própria do filtroAPP.


## Extensão Entrega B (2026-10-29)

Input adicional: ../omni/docs/integracoes/prompt-filtroapp-entrega-b.md.
Ordem e contrato em [delivery-b.md](contracts/delivery-b.md): B1 medição e valores
condicionais; B2 notas ligadas por código Omie exato; B3 resumo dos romaneios;
B4 pendências agregadas; B5 histórico de descarga idempotente e simulável, com
importação de CT-e por ID conhecido. Demais itens US6–US8 permanecem planejados.
