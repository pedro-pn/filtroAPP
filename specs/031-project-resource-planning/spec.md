# Planejamento estruturado de equipe e equipamentos

## Objetivo

Substituir os checklists genéricos de equipe e equipamentos do D-30 por decisões estruturadas que usem os cadastros atuais do FiltroAPP, mostrem a situação prevista na mobilização e orientem o planejador sem criar bloqueios por indisponibilidade.

## Requisitos

1. Perguntas comuns de Sim/Não começam sem resposta e pendentes. A resposta Não registra a decisão, mas não conclui uma frente cuja confirmação necessária seja Sim.
2. No contato inicial com o cliente, exibir Não como estado visual inicial e manter a análise pendente até Sim, nome e data.
3. A frente Equipe pergunta se a necessidade foi definida. Ao escolher Sim, abrir no mesmo diálogo um painel com os cargos operacionais ativos e a quantidade de pessoas por cargo.
4. Exigir ao menos um cargo para confirmar a equipe e mostrar depois um resumo persistido por cargo e quantidade.
5. Calcular a disponibilidade de colaboradores na data prevista de mobilização considerando vínculo ativo, afastamentos e alocações confirmadas. Quando a quantidade livre for insuficiente, mostrar a necessidade de contratação como aviso não bloqueante.
6. Reservar no contrato da resposta a futura origem Solides para a conferência de documentos e treinamentos dos colaboradores possíveis, sem simular dados antes da integração.
7. A frente Equipamentos pergunta se a necessidade foi definida. Ao escolher Sim, abrir no mesmo diálogo um painel com as categorias ativas e todos os equipamentos cadastrados das categorias selecionadas.
8. Para cada equipamento, informar disponibilidade prevista na mobilização com base no saldo de romaneios e no retorno previsto da obra que o utiliza.
9. Exibir a validade de calibração na mobilização e a situação de manutenção calculada com o histórico aprovado e a periodicidade da categoria.
10. Exigir ao menos uma categoria para confirmar equipamentos. Indisponibilidade, calibração e manutenção geram avisos e não impedem a confirmação.
11. Substituir as antigas confirmações genéricas D30_TEAM e D30_EQUIPMENT na prontidão e no gate; materiais e logística continuam nos checklists existentes.
12. Todas as alterações permanecem versionadas e auditadas no workflow.

## Critérios de aceite

- Um projeto novo não apresenta Sim ou Não previamente selecionado nas perguntas comuns.
- Marcar Não em equipe ou equipamentos mantém a frente pendente.
- Confirmar equipe persiste cargos e quantidades e apresenta o resumo após recarregar.
- Déficit de um cargo apresenta a quantidade sugerida para contratação sem bloquear o planejamento.
- Confirmar equipamentos persiste categorias e apresenta os equipamentos com disponibilidade, calibração e manutenção na data prevista.
- O avanço para Preparação exige equipe e equipamentos confirmados e os checklists de materiais e logística concluídos.
- Registros antigos dos checklists removidos deixam de aparecer e de participar do gate D-30.
