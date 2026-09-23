# Alertas por e-mail e reservas assistidas do projeto

## Objetivo

Ativar as automações internas já aprovadas para a Gestão de Projetos: avisar o Líder e o Planejador sobre os marcos da mobilização e transformar as seleções de equipamentos e insumos do D-30 em reservas visíveis, sem criar bloqueios absolutos para as exceções operacionais.

## Requisitos

1. Cada workflow deve vincular explicitamente um Líder e um Planejador ativos, usando os e-mails cadastrados nos respectivos usuários.
2. O início da gestão exige os dois responsáveis. Projetos já existentes recebem o Líder atual também como Planejador até que um gestor indique a pessoa correta.
3. Líder e Planejador podem manter o workflow; o aceite do handover e a autorização de mobilização continuam restritos ao Líder ou ao gestor.
4. Um job rastreado deve consultar diariamente os workflows anteriores à execução e enviar os alertas vencidos D-90, D-30, D-15, D-7 e D-1.
5. O e-mail deve identificar projeto, cliente, etapa, mobilização, ações do marco e pendências críticas, com ligação para a Gestão de Projetos.
6. Um mesmo endereço vinculado aos dois papéis recebe somente uma mensagem. Cada marco enviado deve ser registrado por projeto, data planejada e destinatário.
7. Reagendar a mobilização cria uma nova referência de alertas; executar novamente o job para a mesma referência não duplica mensagens já enviadas.
8. A seleção confirmada de um equipamento nas etapas D-30, Preparação e Pronto para mobilizar constitui uma reserva planejada pelo intervalo previsto do projeto.
9. Reservas sobrepostas do mesmo equipamento devem aparecer no catálogo com projeto e intervalo conflitantes.
10. A reserva de insumo deve descontar as quantidades planejadas por outros projetos do saldo disponível, preservando separadamente saldo físico, reservado e disponível.
11. As reservas são liberadas automaticamente quando o workflow deixa as etapas anteriores à mobilização. A movimentação física continua sendo controlada por Romaneios e Estoque.
12. Conflitos e faltas geram avisos. O responsável pode manter a seleção mediante justificativa persistida e auditável.
13. Esta entrega não consulta nem altera o Omie.

## Critérios de aceite

- O diálogo de início exige Líder e Planejador e apresenta o e-mail de cada candidato.
- O card do Kanban exibe os dois responsáveis; o detalhe e os seletores mostram também os e-mails quando disponíveis.
- Um projeto no D-30 envia os marcos já vencidos uma única vez para cada endereço distinto.
- Falhas de envio ficam registradas e podem ser tentadas novamente.
- Selecionar equipamento ou insumo em um projeto reduz a disponibilidade apresentada nos demais projetos em planejamento.
- Um conflito pode ser confirmado com justificativa e continua visível no resumo.
- Build, lint e testes de contrato, serviço, reservas e alertas permanecem aprovados.
