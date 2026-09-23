# Implementation Plan: Desmobilização de projetos

## Decisão

`ProjectWorkflow.stage` ganha `DEMOBILIZATION` e continua sendo a etapa canônica do card. A missão oficial recebe `FINAL_MEASUREMENT` como projeção operacional desta etapa, preservando o Kanban único.

A conclusão de campo será armazenada em `ProjectWorkflow.fieldCompletionDate`. A desmobilização efetiva continuará usando `Project.demobilizationDate` e `EfetivoMissionPlan.returnDate`, que já delimitam o período operacional. A API de workflow atualizará essas fontes na mesma transação para evitar uma terceira data concorrente.

## Alterações

1. Estender contratos compartilhados, tipos, enum Prisma e migration.
2. Adicionar três seções e os 15 itens de checklist da desmobilização.
3. Calcular progresso total e por frente na regra de negócio.
4. Implementar transições e sincronização da missão oficial.
5. Criar uma ação validada para salvar conclusão de campo e retorno efetivo.
6. Sincronizar o retorno com projeto e missão, preservando alocações e ciclos.
7. Exibir datas, progresso e checklists no modal e no card do Kanban.
8. Cobrir contratos, regras, serviço, sincronização e interface com testes.

## Constitution Check

- UI em pt-BR, modal existente rolável e layout responsivo preservados.
- Entrada validada por Zod compartilhado no frontend e backend.
- Campo novo entregue por migration Prisma versionada.
- Regras e persistência cobertas por testes de backend.
- Componentes, estilos e arraste existentes serão reutilizados.
- A novidade integra a campanha temporária já vigente do Kanban, sem criar outra sobreposição.

## Riscos e mitigação

- Divergência de datas: uma transação atualiza workflow, missão e projeto.
- Ciclos de equipe: nenhuma escrita será feita nas relações de ciclos ou alocações.
- Retorno à execução: a projeção da missão volta a Execução e as datas registradas são preservadas como histórico até edição explícita.
- Próxima etapa: Desmobilização fica como última etapa gerenciada nesta entrega; Pós-job será incorporado no incremento seguinte.
