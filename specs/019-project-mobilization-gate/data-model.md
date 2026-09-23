# Data model

## ProjectWorkflow

- `stage`: recebe `PREPARATION` e `READY_TO_MOBILIZE`.
- `mobilizationAuthorizedAt`: data/hora da última emissão formal.
- `mobilizationAuthorizationVersion`: versão exata autorizada.

## Checklist

A tabela existente armazena as novas chaves. O catálogo recebe seções `D15_TEAM`, `D15_CLIENT`, `D15_EQUIPMENT`, `D15_MATERIALS`, `D15_PRE_JOB`, `D15_TRAVEL` e `D15_QSMS`.

## Papel

`ModuleRoleCode` recebe `EFETIVO_QSMS`, exposto como `efetivo:qsms`.

## Projeções

- `preparationReadiness`: progresso total e por seção.
- `mobilizationGate`: nove frentes, bloqueios, `ready` e risco de prazo.
- `mobilizationAuthorization`: `NOT_AUTHORIZED`, `AUTHORIZED` ou `SUSPENDED`, data, versão emitida e versão atual.
