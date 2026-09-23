# Data Model: execução do projeto

## ProjectWorkflow

Novo campo:

| Campo | Tipo | Regra |
|---|---|---|
| `executionReportTargets` | JSON | mapa por tipo com `expected`; RLR também aceita `completed`; padrão `{}` |

O estágio aceita o novo valor `EXECUTION`. A versão principal não muda ao editar metas, pois ela representa a validade do gate de mobilização.

## QualityRecord reutilizado

Um desvio criado no painel mantém:

- `type = DESVIO`;
- `projectId` do workflow;
- `origin` com uma das nove categorias operacionais;
- `natureId` da natureza ativa com o mesmo nome;
- descrição, impacto, ação, responsável, prazo e status obrigatórios;
- `disposition = TRATAR`;
- autoria e datas mantidas pelo serviço de Qualidade.

## Estado derivado

- previsto: percentual dos dias corridos do Acompanhamento;
- realizado: avanço físico do Acompanhamento;
- término esperado e projetado: datas do Acompanhamento;
- RDO: contagens derivadas de `Report`, `ReportService` e `ReportAttachment`;
- relatório técnico integrado: contagem de `Report` pelo tipo e status;
- RLR: contagem manual auditada no JSON até existir integração.
