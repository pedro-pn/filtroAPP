# Research: Desmobilização de projetos

## Fontes existentes

- `ProjectWorkflow.stage` comanda o card gerenciado.
- `EfetivoMissionPlan.stage` mantém compatibilidade com o quadro operacional.
- `Project.demobilizationDate` e `EfetivoMissionPlan.returnDate` já representam a desmobilização real e limitam o período da missão.
- Os ciclos pertencem à missão e às alocações; a sincronização de etapa não precisa regravá-los.

## Decisões

1. Usar `FINAL_MEASUREMENT` como projeção operacional de Desmobilização, pois é a primeira etapa legada depois de Execução.
2. Manter a conclusão de campo separada do retorno efetivo, já que equipamentos e equipe podem deixar o campo em datas diferentes.
3. Reutilizar a validação cronológica do Planejamento como referência: retorno igual ou posterior ao fim da execução.
4. Manter checklists editáveis apenas na etapa Desmobilização e aplicar os papéis por área já existentes.
