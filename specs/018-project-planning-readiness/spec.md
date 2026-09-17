# Feature Specification: documentação antecipada e planejamento D-30

**Feature Branch**: `feat/016-gestao-projetos-efetivo`  
**Created**: 2026-09-09  
**Status**: Implementada; equipe e equipamentos refinados pela entrega 031
**Input**: Avançar a Gestão de Projetos com documentação antecipada, gatilhos relativos à mobilização e planejamento D-30 por área.

## User Scenarios & Testing

### User Story 1 — Antecipar a documentação (Priority: P1)

Administrativo/RH acompanha, em qualquer etapa do projeto, requisitos documentais, exames, treinamentos, certificações e a regularização das pessoas que poderão mobilizar. O sistema resume a situação como OK, em andamento ou crítica.

**Independent Test**: abrir um projeto distante e outro a até 15 dias da mobilização, manter itens documentais pendentes e conferir a mudança do semáforo; concluir todos e conferir `OK`.

**Acceptance Scenarios**:

1. A documentação antecipada permanece visível no detalhe em todas as etapas.
2. Administrativo/RH altera somente os itens documentais; Líder, gestor e administrador também podem atuar como contingência.
3. Itens pendentes ficam críticos quando faltam até 15 dias para mobilizar ou existe pendência documental crítica vencida.
4. Usuários sem a responsabilidade adequada consultam a situação sem alterar os itens.

### User Story 2 — Planejar a mobilização no D-30 (Priority: P1)

Ao entrar no planejamento, o Líder coordena quatro frentes: equipe, equipamentos, materiais e logística preliminar. Cada área atualiza sua parte, e o projeto mostra progresso por frente e no total.

**Independent Test**: levar um projeto a `MOBILIZATION_PLANNING`, preencher cada frente com o papel correspondente e conferir progresso e proteção de acesso.

**Acceptance Scenarios**:

1. A etapa de planejamento mostra equipe e equipamentos em painéis estruturados e mantém materiais e logística em checklists D-30.
2. Líder ou gestor define cargos, quantidades e categorias de equipamentos; Operações altera logística e Suprimentos altera materiais.
3. Os papéis de área não assumem o projeto, trocam líder, respondem itens críticos nem avançam a etapa.
4. “Aguardando planejamento” informa o próximo marco sem repetir o checklist da análise inicial.
5. O quadro apresenta o avanço D-30 quando o projeto já está no planejamento.

### User Story 3 — Reagir a prazos curtos (Priority: P2)

O sistema calcula D-90, D-30, D-15, D-7 e D-1 a partir da mobilização planejada e apresenta os marcos já vencidos e o próximo marco. Projetos cadastrados perto do início recebem imediatamente todas as verificações cujo prazo já passou.

**Independent Test**: cadastrar mobilizações a 160 e 20 dias; conferir o próximo marco no primeiro caso e D-90/D-30 vencidos no segundo.

**Acceptance Scenarios**:

1. As datas são derivadas da mobilização planejada, sem colunas adicionais no Kanban.
2. Para prazo curto, todos os marcos vencidos aparecem imediatamente.
3. A lista e o detalhe mostram o próximo marco e a quantidade de alertas vencidos sem criar notificações duplicadas.
4. A ausência da data de mobilização produz estado explícito “data não definida”.

### Edge Cases

- Mudança na mobilização recalcula todos os marcos sem copiar checklists ou criar tarefas persistidas.
- Data no passado mantém os cinco marcos vencidos e o projeto visível.
- Um checklist marcado como não aplicável exige justificativa pelas regras já existentes.
- Gestor, administrador e Líder atual podem preencher todas as frentes; papéis de área só alteram as suas.
- Papéis Comercial e Visualizador permanecem somente leitura nas novas frentes.
- A futura integração CRM continua restrita aos fatos comerciais e não se torna fonte dos itens operacionais desta entrega.

## Requirements

### Functional Requirements

- **FR-001**: O catálogo compartilhado MUST identificar seção e responsabilidades de cada checklist.
- **FR-002**: O sistema MUST incluir onze itens de documentação antecipada, disponíveis em qualquer etapa.
- **FR-003**: O sistema MUST calcular a prontidão documental como `OK`, `IN_PROGRESS` ou `CRITICAL`, com contagens e motivos.
- **FR-004**: `CRITICAL` MUST ocorrer quando há item pendente a até 15 dias da mobilização ou pendência documental crítica vencida.
- **FR-005**: A etapa `MOBILIZATION_PLANNING` MUST conter planejamento estruturado de equipe e equipamentos e os checklists D-30 de materiais e logística preliminar.
- **FR-006**: O sistema MUST calcular progresso total e por frente do planejamento D-30.
- **FR-007**: Os papéis `efetivo:operations`, `efetivo:assets`, `efetivo:supplies` e `efetivo:administrative` MUST entrar no catálogo de acesso ao módulo.
- **FR-008**: Os papéis de área MUST editar somente os checklists de sua seção; administrador, gestor e Líder atual com acesso operacional MUST editar todos e as definições estruturadas.
- **FR-009**: Papéis de área MUST NOT iniciar gestão, trocar Líder, responder itens críticos, gerir pendências gerais ou mudar etapa.
- **FR-010**: O detalhe de cada checklist MUST informar se o usuário atual pode editá-lo.
- **FR-011**: O sistema MUST derivar D-90, D-30, D-15, D-7 e D-1 da data planejada de mobilização.
- **FR-012**: O cálculo MUST informar datas, marcos vencidos e próximo marco; marcos vencidos em projetos curtos MUST aparecer imediatamente.
- **FR-013**: Os alertas desta entrega MUST ser calculados sob consulta e MUST NOT criar registros ou notificações externas.
- **FR-014**: A interface MUST mostrar os checklists correspondentes à etapa, sem usar a análise inicial como fallback.
- **FR-015**: O quadro MUST mostrar prontidão documental e, no planejamento, o progresso D-30.
- **FR-016**: Atualizações MUST preservar versionamento otimista, auditoria e validação Zod existentes.

### Visual/UI Contract

| Surface | Existing reference inspected | Components/classes to use | Navigation persistence | Novelty/tutorial contract | Responsive contract |
|---|---|---|---|---|---|
| Documentação antecipada | `ProjectWorkflowModal` | `Modal`, `Button`, checklists e badges existentes | projeto permanece em `?projeto=id` | atualizar a campanha vigente, expira em 19/09/2026 | seções empilham e não geram rolagem horizontal |
| Planejamento D-30 | seções de checklist do modal largo | grupos e progresso baseados nos tokens atuais | etapa e projeto vêm da API/URL | mesma campanha vigente | quatro frentes em grade ampla e uma coluna no celular |
| Marcos no card/detalhe | `ProjectWorkflowBoard` e resumo do modal | badges e textos existentes | filtros e projeto permanecem na URL | coberto pela campanha vigente | textos quebram dentro do card |

### Key Entities

- Definição de checklist: chave, etapa opcional, seção e papéis de área autorizados.
- Prontidão documental: situação calculada, contagem e bloqueios.
- Progresso D-30: total e contagem por frente.
- Marco relativo: código, data, vencimento e próximo marco.

## Success Criteria

- **SC-001**: 100% dos novos checklists respeitam a responsabilidade por área também no backend.
- **SC-002**: Um projeto com mobilização em 20 dias apresenta D-90 e D-30 vencidos na primeira consulta.
- **SC-003**: O detalhe nunca apresenta itens da análise inicial quando a etapa é espera ou planejamento.
- **SC-004**: A situação documental e o progresso D-30 se atualizam na mesma interação de salvamento.
- **SC-005**: Em 390px e 1440px, as frentes permanecem legíveis e sem rolagem horizontal da página ou diálogo.

## Assumptions

- A data planejada de mobilização já existente continua sendo a referência dos gatilhos.
- Alertas persistentes, e-mail, WhatsApp e tarefas agendadas ficam para uma integração posterior.
- Preparação D-15, gate “Pronto para mobilizar” e autorizações de compra/contratação serão a próxima entrega.
