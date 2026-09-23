# Modelo de dados: Desmobilização de projetos

## ProjectWorkflow

- Nova etapa `DEMOBILIZATION` depois de `EXECUTION`.
- `fieldCompletionDate DateTime? @db.Date`: data em que o escopo de campo terminou.

## Project

- `demobilizationDate` permanece como data efetiva consolidada de desmobilização.

## EfetivoMissionPlan

- `stage = FINAL_MEASUREMENT` enquanto o workflow está em Desmobilização.
- `returnDate` acompanha `Project.demobilizationDate` quando a data é atualizada pelo workflow.
- Demandas, alocações e ciclos não são alterados por esta entrega.

## ProjectWorkflowChecklist

Novas seções:

- `DEMOBILIZATION_FIELD`: conclusão e conferências de campo.
- `DEMOBILIZATION_LOGISTICS`: retorno de equipe, equipamentos, hospedagem e frete.
- `DEMOBILIZATION_ASSETS`: chegada à sede, entrega para Ativos e avarias.

## Invariantes

1. Retorno efetivo não antecede a conclusão de campo.
2. Retorno efetivo não antecede o fim previsto da execução da missão oficial.
3. Atualização de etapa e projeção operacional é atômica.
4. Atualização de retorno é atômica entre Projeto e missão oficial.
