# Feature Specification: Liberação comercial da gestão de projetos

**Feature Branch**: `feat/016-gestao-projetos-efetivo`  
**Created**: 2026-09-09  
**Status**: Em implementação  
**Input**: Continuar a Gestão de Projetos com liberação comercial preparada para uma futura integração com CRM e tornar o avanço entre etapas evidente para o usuário.

## User Scenarios & Testing

### User Story 1 — Registrar a prontidão comercial (Priority: P1)

O responsável Comercial consulta um projeto e registra a situação dos fatos comerciais necessários: criação das propostas técnica e comercial, aceite da proposta, pedido de compra, contrato, cadastro comercial e condições de medição e faturamento. O sistema apresenta imediatamente se a documentação atual libera execução, medição e faturamento.

**Why this priority**: Compra, contratação e mobilização precisam de uma resposta comercial única e rastreável, sem impedir que o Líder faça o planejamento antecipado.

**Independent Test**: Abrir um projeto como Comercial, resolver todos os fatos aplicáveis e verificar a liberação verde; reabrir um fato e verificar o retorno imediato para não liberado.

**Acceptance Scenarios**:

1. Dado um projeto com gestão iniciada, quando o Comercial abre o detalhe, então vê os oito fatos comerciais e a situação consolidada.
2. Dado um fato pendente, quando todos os fatos são confirmados ou marcados como não aplicáveis dentro das regras, então a situação muda para liberado.
3. Dado um item que aceita “não aplicável”, quando o Comercial escolhe essa situação sem justificativa, então o campo é rejeitado com mensagem visível.
4. Dado um item confirmado, quando falta a data da ocorrência ou a referência/detalhe exigido pelo tipo, então a confirmação é rejeitada.
5. Dado um projeto ainda não liberado, o Líder pode continuar a análise, a cotação e o planejamento, enquanto a interface informa que compra, contratação e mobilização permanecem bloqueadas.
6. Dado um usuário visualizador ou Líder sem papel Comercial, ele consulta a situação e a procedência, mas não altera os fatos comerciais.

### User Story 2 — Preservar a futura fonte CRM (Priority: P1)

Os fatos comerciais guardam a sua procedência. Registros manuais funcionam enquanto não existe integração. Quando um fato vier do CRM, o FiltroAPP exibe a referência, versão e sincronização e impede correção manual do conteúdo sincronizado.

**Why this priority**: A primeira versão não pode criar uma segunda fonte comercial que precise ser descartada quando o CRM começar a operar.

**Independent Test**: Carregar um fato de origem CRM, confirmar que aparece como sincronizado e que uma tentativa de alteração pela rota de usuário falha sem modificar o registro.

**Acceptance Scenarios**:

1. Todo fato registra origem manual ou CRM, referência, observação, data da ocorrência e autoria quando disponível.
2. Um fato vindo do CRM também pode guardar identificador externo, endereço externo, versão da fonte, data de atualização na origem e última sincronização.
3. A rota usada pela interface aceita somente alterações manuais e não permite que o cliente declare artificialmente a origem CRM.
4. Uma nova versão externa poderá substituir uma versão anterior de forma idempotente; essa operação fica no serviço de integração e não é exposta nesta entrega.
5. Os fatos “proposta técnica criada” e “proposta comercial criada” podem satisfazer os itens correspondentes do handover, mantendo compatibilidade com checklists já respondidos antes desta entrega.
6. Faturamento e recebimento realizados continuam fora desta integração e permanecem vinculados ao Omie.

### User Story 3 — Entender e confirmar o avanço do card (Priority: P2)

O Líder sempre encontra no rodapé fixo do diálogo a ação adequada para assumir ou avançar o projeto. Quando o gate ainda está incompleto, o diálogo apresenta os motivos sem exigir uma tentativa às cegas.

**Why this priority**: O usuário já conseguiu preencher os checklists, mas não percebeu como mover o card; a transição precisa ser explícita e fácil de encontrar.

**Independent Test**: Abrir o diálogo com gate incompleto e completo em desktop e celular, conferir motivos e executar a transição sem rolar até o fim do conteúdo.

**Acceptance Scenarios**:

1. No handover, o Líder vê no rodapé a ação “Assumir e iniciar análise”; outros usuários veem o responsável pela ação.
2. Na análise inicial, o Líder vê no rodapé as opções permitidas para aguardar ou iniciar o planejamento.
3. Uma ação bloqueada apresenta a quantidade e os motivos pendentes; ao resolver o último motivo, a ação é liberada sem recarregar a página inteira.
4. Salvar o último checklist não move o projeto automaticamente. O Líder confirma a mudança de etapa para preservar a intenção e o histórico.
5. O rodapé continua fixo, o corpo permanece rolável e não existe corte ou rolagem horizontal em 390px e 1440px.

### Edge Cases

- Proposta, pedido de compra e contrato aceitam “não aplicável”; propostas criadas, cadastro comercial e condições de medição/faturamento exigem confirmação.
- Fato confirmado exige data da ocorrência. Documento ou pedido exige referência; condição comercial exige descrição.
- Alterar um fato depois da liberação recalcula o semáforo e registra o evento, sem mover a etapa do projeto.
- Um registro CRM permanece somente leitura mesmo para o Líder, Comercial ou gestor; uma correção futura deve ocorrer na origem ou por exceção auditada ainda não incluída.
- Projetos existentes com os checklists de proposta já concluídos não voltam automaticamente ao handover.
- Troca de líder continua invalidando o aceite, mas não apaga fatos comerciais.
- Atualizações concorrentes usam a versão da gestão e falham sem sobrescrever a gravação mais recente.
- A indisponibilidade futura do CRM terá estado próprio; política temporal de dados desatualizados fica para a implementação do adaptador.

## Requirements

### Functional Requirements

- **FR-001**: O sistema MUST manter um catálogo versionado de oito fatos comerciais: proposta comercial criada, proposta técnica criada, proposta aceita, pedido de compra recebido, contrato assinado, cadastro/condições comerciais atendidas, condição de medição definida e condição de faturamento definida.
- **FR-002**: Cada fato MUST ter situação pendente, confirmada ou não aplicável, respeitando a aplicabilidade definida pelo catálogo.
- **FR-003**: “Não aplicável” MUST exigir justificativa; “confirmado” MUST exigir data da ocorrência e a referência ou descrição definida para aquele fato.
- **FR-004**: Cada fato MUST registrar origem manual ou CRM e preservar metadados de autoria, referência externa, versão e sincronização quando existirem.
- **FR-005**: Alterações pela interface MUST gerar somente fatos manuais e MUST NOT modificar fatos cuja origem vigente seja CRM.
- **FR-006**: Somente administrador, gestor do Efetivo ou usuário com papel Comercial do Efetivo MUST alterar fatos manuais. Líderes e visualizadores MUST manter acesso de leitura.
- **FR-007**: O papel Comercial MUST conceder acesso ao módulo e à edição da frente comercial, sem conceder início da gestão, troca de líder, edição de checklist operacional ou mudança de etapa.
- **FR-008**: A liberação comercial MUST ser calculada a partir de todos os fatos; qualquer pendência ou situação inválida mantém “não liberado”.
- **FR-009**: A resposta da gestão MUST informar situação consolidada, motivos de bloqueio e operações afetadas: compra, contratação e mobilização.
- **FR-010**: A liberação comercial MUST NOT bloquear análise, cotação ou entrada no planejamento nesta entrega.
- **FR-011**: Fatos confirmados de criação das propostas MUST satisfazer os itens equivalentes do gate do handover; checklists legados concluídos continuam válidos.
- **FR-012**: Toda alteração MUST participar do controle de versão e do histórico já existente da gestão.
- **FR-013**: O detalhe MUST informar para cada destino permitido se a transição está liberada e quais motivos a bloqueiam.
- **FR-014**: A ação de aceite ou avanço MUST permanecer no rodapé fixo do diálogo e MUST exigir confirmação explícita do usuário.
- **FR-015**: O quadro MUST exibir a situação comercial consolidada de projetos com gestão iniciada.
- **FR-016**: A implementação MUST preservar Project como identidade operacional, o webhook de entrada existente, a proposta comercial importada e Omie como fonte de realizado.
- **FR-017**: Nenhum endpoint de sincronização CRM MUST ser publicado antes de existir contrato e credencial definidos com o aplicativo externo.

### Visual/UI Contract

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---|---|---|---|---|---|---|---|
| Frente comercial no detalhe | `ProjectWorkflowModal`, modal largo do Efetivo | `Modal`, `Button`, `field-group`, `field-invalid`, `field-error`, `efetivo-modal-layout/body/footer` | React Hook Form + Zod; rótulos visíveis; selects globais; fonte CRM desabilitada | N/A | Projeto permanece em `?projeto=id` | Atualizar a campanha vigente da Gestão de Projetos para citar a frente comercial; mesma expiração em 19/09/2026 | Grade ampla no desktop e empilhada no mobile; corpo rolável; sem overflow horizontal |
| Card do projeto | `ProjectWorkflowBoard` | Card e badges atuais baseados em tokens | N/A | N/A | Busca, página, visão e projeto continuam na URL | Coberto pela campanha vigente | Semáforo quebra dentro do card e não aumenta a coluna |
| Ações de avanço | Rodapé compartilhado do modal | `Button`, `efetivo-modal-footer` | Motivos de gate como texto acessível; botões disabled com contexto visível | N/A | A nova etapa atualiza consulta e URL mantém o projeto | Tutorial vigente aponta o detalhe | Rodapé pode quebrar linhas em celular sem esconder ações |

### Key Entities

- Fato comercial do projeto: situação, procedência, evidência, ocorrência, versão externa, sincronização e autoria.
- Prontidão comercial: resultado calculado e motivos que impedem a liberação.
- Permissão Comercial do Efetivo: acesso limitado à frente comercial.
- Opção de transição: etapa de destino, autorização e motivos de bloqueio.

## Success Criteria

- **SC-001**: Em 100% dos projetos, a situação verde só aparece quando os oito fatos estão resolvidos conforme suas regras.
- **SC-002**: Usuários Comerciais conseguem completar a frente sem obter permissão para alterar checklists, líder ou etapa.
- **SC-003**: Nenhuma alteração manual modifica um fato identificado como vindo do CRM.
- **SC-004**: O Líder identifica a ação de avanço e seus bloqueios sem rolar o conteúdo do diálogo.
- **SC-005**: Após resolver o último requisito, a situação e as ações são atualizadas na mesma interação de salvamento.
- **SC-006**: Em 390px e 1440px, fatos comerciais, motivos e ações permanecem visíveis sem rolagem horizontal da página ou do diálogo.

## Assumptions

- A integração CRM real ainda não possui contrato disponível; esta entrega prepara o modelo e o comportamento manual.
- Administradores e gestores podem atuar como contingência do Comercial.
- A administração normalmente seleciona um papel por módulo, mas a autorização deve tratar combinações já existentes de forma aditiva; o papel Comercial isolado é limitado à frente comercial.
- A data de ocorrência usa data civil. Datas e versões técnicas da sincronização futura são metadados de servidor.
- Bloqueios efetivos nas APIs de compra, contratação e mobilização serão conectados quando essas autorizações forem implementadas.

## Clarifications

### Session 2026-09-09

O CRM é fonte futura dos passos comerciais, incluindo proposta técnica/comercial e pedido de compra. A entrega atual deve funcionar manualmente, preservar procedência e evitar que fatos externos sejam editados como se fossem internos. As decisões restantes seguem os padrões já aprovados da Gestão de Projetos.
