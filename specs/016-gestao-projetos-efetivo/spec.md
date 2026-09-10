# Feature Specification: Gestão de projetos no Efetivo

**Feature Branch**: `feat/016-gestao-projetos-efetivo`
**Created**: 2026-09-09
**Status**: Especificação da primeira entrega; evolução completa em roadmap.md
**Input**: Criar worktree da main, registrar o estudo aprovado e iniciar a implementação do ciclo de gestão de projetos Filtrovali.

## User Scenarios & Testing

### User Story 1 — Receber e assumir o projeto (Priority: P1)

O gestor inicia o handover de um projeto existente e designa seu líder. O próprio líder confirma o recebimento. Esse trabalho pode começar sem equipe definida.

**Why this priority**: Define a responsabilidade desde o recebimento e elimina a exigência prematura de equipe.
**Independent Test**: Iniciar gestão, preencher handover e assumir como líder; atualizar a página e verificar persistência.

**Acceptance Scenarios**:
1. Dado um projeto ativo sem programação, o gestor consegue iniciar seu handover com líder e previsão de mobilização, sem selecionar colaboradores.
2. Dado um handover completo, somente o líder designado pode confirmar o recebimento e avançar para análise.
3. Dada troca de líder, o aceite anterior é invalidado e o projeto retorna ao handover, preservando histórico e respostas.
4. Dado usuário apenas leitor, ele consulta os projetos, mas não os altera, exceto quando é o líder designado daquele projeto.

### User Story 2 — Concluir análise e encaminhar itens críticos (Priority: P1)

O líder revisa escopo e premissas e responde às cinco perguntas de criticidade. Respostas positivas criam pendências únicas, que seguem visíveis durante a espera.

**Independent Test**: Responder equipamento especial = sim duas vezes, verificar uma única pendência, atribuir área/responsável/prazo e concluir análise.

**Acceptance Scenarios**:
1. Não é possível sair da análise enquanto algum item aplicável estiver pendente ou alguma pergunta crítica estiver sem resposta.
2. Uma resposta positiva cria pendência aberta com área sugerida; líder informa responsável e data limite antes de concluir análise. Perguntas cobrem equipamento especial, insumo de longo prazo, mais de dez filtros, contratação e requisitos documentais específicos.
3. Marcar um item como não aplicável exige justificativa. Evidências podem ser registradas como referência textual, sem novo armazenamento de arquivos nesta entrega.
4. Reverter sim para não não apaga a pendência nem seu histórico; a resolução é explícita.

### User Story 3 — Aguardar e iniciar planejamento (Priority: P2)

Após a análise, o projeto pode aguardar ou entrar diretamente em planejamento. O líder vê os dias até a mobilização, o marco D-30 e as pendências, inclusive vencidas.

**Independent Test**: Projeto a 20 dias permite ir direto ao planejamento; projeto a seis meses permite aguardar sem equipe nomeada.

**Acceptance Scenarios**:
1. D-30 é referência de prazo, nunca uma coluna nem impedimento para planejar antecipadamente.
2. Alterar a previsão recalcula o próximo marco e os atrasos exibidos, sem mover a etapa automaticamente.
3. Entrar em planejamento oferece acesso à programação de equipe existente. Os calendários, cenários e estados operacionais atuais permanecem íntegros.

### Edge Cases

- Projetos excluídos, inativos, internos restritos e códigos de sede não participam deste fluxo.
- Não inicializar projetos existentes como recebidos, analisados ou autorizados; adesão explícita pelo gestor.
- Gravações concorrentes devem falhar com mensagem de atualização necessária, sem sobrescrever dados.
- Se o líder for desativado, gestor pode substituí-lo; contas inativas não podem assumir.
- Pendência reaberta exige que a resposta crítica positiva correspondente permaneça rastreável.
- Nenhum avanço desta entrega significa autorização de compra, contratação ou mobilização.

## Requirements

### Functional Requirements

- **FR-001**: Um único acompanhamento de gestão por projeto, independente das simulações de equipe.
- **FR-002**: Iniciar em Handover, seguido de Análise inicial, Aguardando planejamento e Planejamento da mobilização. Demais etapas permanecem no roadmap até receberem seus gates e integrações.
- **FR-003**: Gestor inicia e designa líder; gestor ou líder editam gestão; só o próprio líder aceita o handover.
- **FR-004**: Checklists persistentes por etapa, com pendente, concluído e não aplicável justificado; registrar autor e data.
- **FR-005**: Cinco respostas obrigatórias sim/não na análise; sim gera pendência sem duplicação.
- **FR-006**: Pendência registra descrição, área, responsável nominal, prazo necessário em dias, data limite, criticidade e status; positivas devem ser encaminhadas antes de sair da análise.
- **FR-007**: Exibir pendências em qualquer etapa, inclusive durante espera, com atraso e criticidade.
- **FR-008**: Guardar previsão de mobilização e calcular dias restantes e D-30 por data civil, sem depender de horário do navegador.
- **FR-009**: Refinar o Kanban de Evolução existente em um único fluxo do projeto. Preservar equipe, ciclos, datas e cenários em Missões, sem manter um segundo Kanban concorrente.
- **FR-010**: Registrar histórico de alterações e proteger gravações por versão.
- **FR-011**: Consulta paginada e busca por código, nome e cliente; detalhe e visão restaurados após atualização de página.
- **FR-012**: Não emitir mensagens externas nem conceder autorizações operacionais nesta entrega.

### Visual/UI Contract

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---|---|---|---|---|---|---|---|
| Kanban único de projetos | EfetivoPage, MissionsBoard | Button, SearchBar, page-card, tokens globais | select e campos globais com rótulo | Sem reordenação nesta entrega; avanço explícito validado | section=evolucao, projeto=id, busca | Card driver.js e guia de controles reais, atualizado em 10/09 por 10 dias | Colunas com rolagem interna desktop; lista por etapa selecionável mobile |
| Detalhe de gestão | Modal compartilhado e MissionCompletionModal | Modal, Button, efetivo-modal-layout/body/footer, field-group | Erros field-invalid/field-error e aria-invalid, sem validação nativa substitutiva | Não aplicável | projeto=id na URL | Guia temporário da visão | Rodapé fixo, corpo rolável, ações quebram linha |

### Key Entities

- Projeto: registro mestre existente; identidade e dados de cliente reutilizados.
- Gestão do projeto: etapa, líder, aceite, previsão, versão e histórico.
- Resposta de checklist: item, situação, justificativa, autor e momento.
- Resposta crítica: pergunta e sim/não.
- Pendência: encaminhamento e resolução de risco identificado.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Todos os cenários de recebimento e análise funcionam sem equipe alocada.
- **SC-002**: Nenhum usuário diferente do líder designado consegue registrar o aceite.
- **SC-003**: Repetir uma resposta positiva não cria duas pendências para a mesma pergunta/projeto.
- **SC-004**: Nenhuma análise incompleta avança; pendências encaminhadas podem permanecer abertas durante a espera.
- **SC-005**: Em 390px e 1440px, a página não apresenta overflow horizontal; erros de formulário e contexto sobrevivem às interações previstas.

## Assumptions

- O pedido é iniciar implementação: esta entrega fecha o recebimento/análise até a entrada em planejamento; o estudo completo permanece em roadmap.md.
- Líder é uma conta ativa com acesso ao Efetivo; sua identidade é independente da seleção de colaboradores para campo.
- Permissões por área, notificações D-90/D-15/D-7/D-1, reservas, documentos anexados, gates comerciais/operacionais e medição ficam nas entregas seguintes.
- A opção não aplicável não vale para o aceite do líder nem para as perguntas críticas.
- A mobilização prevista da gestão é estimativa própria. Mobilização e Execução sincronizam somente a etapa da programação oficial; datas, equipe e ciclos continuam sendo mantidos em Missões.

## Clarifications

### Session 2026-09-09

Revisão de escopo, entidades, interação, concorrência, permissões e dependências concluída sem perguntas adicionais: decisões de implementação usam o estudo aprovado e as premissas explícitas acima. O escopo das integrações futuras está delimitado no roadmap.

### Session 2026-09-10

Corrigida a interpretação da interface: o acompanhamento de gestão refina o Kanban existente e forma um único fluxo por projeto. Missões permanece como área de configuração operacional, sem controlar uma evolução paralela para projetos gerenciados.
