# B6 — Gestão

Base `/api/integracoes/v1`; coleções com items/page/generatedAt/requestId e
schemaVersion 1.0. Todas exigem seu escopo e recorte de projeto antes da paginação;
aceitam projectId OU projectCode (preserva zeros), updatedSince, limit, cursor,
snapshotAt. Nenhum total global. Nenhuma alteração automática de credenciais.

| GET | Escopo | Sensibilidade |
|---|---|---|
| /acompanhamento/projetos/semanas | acompanhamento.progresso.read | INTERNAL |
| /acompanhamento/projetos/custos | acompanhamento.custos.read | FINANCIAL |
| /projetos/condicoes | projetos.condicoes.read | INTERNAL |
| campos diária/currency da consulta anterior | projetos.condicoes.valores.read (depende do base) | FINANCIAL |
| /efetivo/alocacoes | efetivo.alocacoes.read | INTERNAL |
| /ponto/projetos/semanas | ponto.resumos.read | INTERNAL |

Sem dependência de comercial.*. O escopo financeiro adicional das condições
resolve a exigência de não publicar reais por um escopo INTERNAL.

## Período e sincronização

G1/G5: weekStart (YYYY-MM-DD, segunda-feira; padrão semana atual em São Paulo)
OU from/to (datas inclusivas, normalizadas às segundas; no máximo 12 semanas).
Rejeitar datas inválidas, ordem invertida, combinações e semanas futuras.
As datas de negócio dos históricos/RDO/ponto são datas civis, não instantes UTC.
Históricos manuais conservam o dia UTC de recordedAt, como o detalhe existente;
registros após 21h de São Paulo podem cair no dia UTC seguinte.
Semana atual é parcial até a leitura. O cursor conserva a semana padrão mesmo
ao virar a semana. O teto não é um snapshot transacional das fontes.

Agregados G1/G2/G5 têm watermark da leitura calculada: updatedSince pode retornar
linhas sem mudança, para não perder edição/exclusão/configuração de fonte. G3/G4
usam carimbos persistidos; reconciliação completa periódica cobre mudanças de
visibilidade e vínculos. Snapshot antigo não reconstrói custos históricos.

## G1

Uma linha por projeto/semana: projectId, projectCode, weekStart, avancoInicio,
avancoFim (número % ou null), metaPontos (número de p.p. ou null), metaDefinidaPor
(PROJETO/GRUPO ou null), meta (objeto ou null), revisao, updatedAt. Avanço calculado pelo mesmo serviço
de histórico diário do detalhe; início usa último ponto anterior à segunda e fim
usa último ponto até domingo (ou leitura na semana atual). Sem evidência anterior,
null; não inventar avanço zero nem retroagir avanço atual sobre semana passada.

Meta resolve última revisão, exclusão e repetição usando serviço compartilhado;
projeto prevalece, seguido da meta do grupo ativo. Não divulgar outros membros.
Metas estruturadas sem plannedPctPoints resultam em metaPontos null.
revisao é null sem linha, ou {concluidaEm, pendencias, itens:[{codigo,rotulo,ok}]}.
pendencias é a quantidade de checks pendentes; checks e rótulos vêm do filtroAPP.
Conclusões legadas continuam válidas quando anteriores a checks novos.
Nota livre e identidade do revisor/autor ficam fora.

## G1 — meta na unidade cadastrada

Extensão aditiva, OpenAPI 1.12.0, catálogo 2026-11-03.2; mesmo envelope 1.0 e
mesmo escopo `acompanhamento.progresso.read`. `metaPontos` e `metaDefinidaPor`
continuam com a seleção e os valores anteriores.

`meta` é null para `NO_TARGET`. Nos demais casos contém todos os campos abaixo.
Números são JSON numbers ou null; nenhuma conversão monetária ou de unidade.

| Campo | Contrato |
|---|---|
| situacao | PLANNED, NO_DATA, NO_RULE, BELOW, PARTIAL, ON_TARGET ou ABOVE, do status do comparativo |
| rotuloSituacao | Rótulo pt-BR compartilhado com o painel |
| emAndamento | inProgress do comparativo |
| periodoInicio, periodoFim | Datas civis inclusivas da contagem, que podem atravessar a semana civil |
| regra | ALL (E) ou ANY (OU); cenários legados usam ALL |
| cenario | Nome do cenário selecionado ou null |
| atingimentoPct | achievementPct, número ou null, sem substituir as medidas dos itens |
| itens | Uma entrada por goal do cenário selecionado ou da lista; vazio em NO_RULE |
| colaboradoresPorDia | Lista `{data,planejado,presentes}`, só para dias contratados do período; vazia sem meta de presença |

Cada entrada de `itens` contém:

| Campo | Contrato |
|---|---|
| tipo | PROGRESS, SERVICE ou ATTENDANCE, conforme weeklyTargetGoalKind |
| servico, rotuloServico | serviceType e rótulo de WEEKLY_TARGET_SERVICES, ambos null para meta sem serviço específico |
| unidade | PCT_POINTS, M, L, UN ou COLLABORATORS |
| rotuloUnidade | p.p., m, L, un ou colab./dia, conforme weeklyTargetUnit |
| base | WEEK_TOTAL, PER_PRODUCTIVE_DAY ou PER_WORKDAY |
| valorCadastrado | Valor digitado; não é multiplicado pela base produtiva |
| planejado, realizado, diferenca | plannedValue, actualValue e differenceValue do mesmo cálculo do painel |
| resultado | MET, BELOW, NO_DATA ou PLANNED; listas usam outcome, cenários traduzem os valores já calculados para o mesmo vocabulário |
| pendenciasBase | Apenas códigos de productivityIssues, como MISSING_RDO_BASE, MISSING_TEAM e UNCONFIRMED_TEAM |
| descricao | Mesma frase de configuração da linha no painel, com unidade e base cadastradas |

`presentes` é uma contagem de pessoas distintas nos RDOs, incluindo turnos e
sem duplicar pessoas. É null para dia futuro, sem RDO ou com equipe não confirmada;
RDO confirmado sem equipe conta zero. Não inclui nomes, ids ou dados individuais.
A lista contém somente dias de trabalho da meta dentro do período (o mesmo
`dailyAttendance` do painel), inclusive dias futuros desse período.

O cálculo é exclusivamente `buildWeeklyProgressComparison`, com alvos completos
para resolver repetição, revisão, exclusão e limites entre períodos adjacentes.
Não recortar alvos/históricos nas semanas solicitadas antes do cálculo.
`loadWeeklyComparisonSources` e `buildWeeklyComparisonHistories` montam as
fontes compartilhadas com o carregador de serviços do painel: medições corrigidas,
serviços importados, equipe produtiva e presença dos RDOs. O histórico de avanço
é o diário do detalhe, também fornecido ao painel. Descrições e rótulos residem em
`shared/modules/weekly-target-presentation.js` e são usados pelos dois consumidores.

O recurso tem uma linha por projeto. A precedência projeto/grupo continua igual
a B6: quando só existe regra de grupo, aplica-a às fontes do projeto da linha.
Não soma dados de outros membros (inclusive os fora do recorte do token).
Portanto essa linha não representa o painel agregado do grupo, cujo histórico é
ponderado por dados de todos os membros. Essa diferença de granularidade é
preservada para respeitar o contrato e o recorte; não há segundo cálculo de meta.

Semanas futuras continuam inválidas nos filtros de G1/G5. `PLANNED` pode aparecer
quando a contagem da semana atual começa depois de hoje (por exemplo, quarta a
terça consultada na segunda). O comparativo também suporta semanas futuras;
esta extensão não amplia o intervalo permitido pelo endpoint.

Sincronização: releitura das últimas quatro semanas a cada 30 minutos.
O realizado é derivado e não gera evento novo. A mudança da meta continua usando
`acompanhamento.meta_alterada`. As fontes são carregadas em lote só para os
projetos da página; os serviços carregados são reutilizados no avanço, sem N+1.
O watermark de leitura e as limitações de snapshot descritas acima permanecem.

Exemplos inteiramente fictícios do campo `meta` (os demais campos da linha e o
envelope estão nos exemplos completos do OpenAPI):

### p.p. legado

```json
{"situacao":"ABOVE","rotuloSituacao":"Acima da meta","emAndamento":false,"periodoInicio":"2026-09-28","periodoFim":"2026-10-04","regra":"ALL","cenario":"Meta geral","atingimentoPct":125,"itens":[{"tipo":"PROGRESS","servico":null,"rotuloServico":null,"unidade":"PCT_POINTS","rotuloUnidade":"p.p.","base":"WEEK_TOTAL","valorCadastrado":20,"planejado":20,"realizado":25,"diferenca":5,"resultado":"MET","pendenciasBase":[],"descricao":"Total geral: 20 p.p."}],"colaboradoresPorDia":[]}
```

### Lista por serviço com regra E

```json
{"situacao":"PARTIAL","rotuloSituacao":"Meta parcial","emAndamento":false,"periodoInicio":"2026-09-28","periodoFim":"2026-10-04","regra":"ALL","cenario":null,"atingimentoPct":80,"itens":[{"tipo":"SERVICE","servico":"FLUSHING","rotuloServico":"Flushing","unidade":"M","rotuloUnidade":"m","base":"WEEK_TOTAL","valorCadastrado":100,"planejado":100,"realizado":100,"diferenca":0,"resultado":"MET","pendenciasBase":[],"descricao":"A equipe deve fazer 100 m de flushing na semana."},{"tipo":"SERVICE","servico":"FILTRAGEM","rotuloServico":"Filtragem","unidade":"L","rotuloUnidade":"L","base":"WEEK_TOTAL","valorCadastrado":500,"planejado":500,"realizado":400,"diferenca":-100,"resultado":"BELOW","pendenciasBase":[],"descricao":"A equipe deve fazer 500 L de óleo filtrado na semana."}],"colaboradoresPorDia":[]}
```

### Lista por serviço com regra OU

```json
{"situacao":"ON_TARGET","rotuloSituacao":"Dentro da meta","emAndamento":false,"periodoInicio":"2026-09-28","periodoFim":"2026-10-04","regra":"ANY","cenario":null,"atingimentoPct":100,"itens":[{"tipo":"SERVICE","servico":"FLUSHING","rotuloServico":"Flushing","unidade":"M","rotuloUnidade":"m","base":"WEEK_TOTAL","valorCadastrado":100,"planejado":100,"realizado":100,"diferenca":0,"resultado":"MET","pendenciasBase":[],"descricao":"A equipe deve fazer 100 m de flushing na semana."},{"tipo":"SERVICE","servico":"TESTE_PRESSAO","rotuloServico":"Teste de pressão","unidade":"UN","rotuloUnidade":"un","base":"WEEK_TOTAL","valorCadastrado":2,"planejado":2,"realizado":0,"diferenca":-2,"resultado":"BELOW","pendenciasBase":[],"descricao":"A equipe deve fazer 2 unidades de teste de pressão na semana."}],"colaboradoresPorDia":[]}
```

### Cenário por combinação exata

```json
{"situacao":"ABOVE","rotuloSituacao":"Acima da meta","emAndamento":false,"periodoInicio":"2026-09-28","periodoFim":"2026-10-04","regra":"ALL","cenario":"Limpeza e filtragem","atingimentoPct":110.00000000000001,"itens":[{"tipo":"SERVICE","servico":"LIMPEZA_QUIMICA","rotuloServico":"Limpeza química","unidade":"M","rotuloUnidade":"m","base":"WEEK_TOTAL","valorCadastrado":100,"planejado":100,"realizado":120,"diferenca":20,"resultado":"MET","pendenciasBase":[],"descricao":"Limpeza química: 100 m"},{"tipo":"SERVICE","servico":"FILTRAGEM","rotuloServico":"Filtragem","unidade":"L","rotuloUnidade":"L","base":"WEEK_TOTAL","valorCadastrado":500,"planejado":500,"realizado":550,"diferenca":50,"resultado":"MET","pendenciasBase":[],"descricao":"Filtragem: 500 L"}],"colaboradoresPorDia":[]}
```

### Por dia produtivo sem RDO-base

```json
{"situacao":"NO_DATA","rotuloSituacao":"Sem dados suficientes","emAndamento":false,"periodoInicio":"2026-09-28","periodoFim":"2026-10-04","regra":"ALL","cenario":null,"atingimentoPct":null,"itens":[{"tipo":"SERVICE","servico":"FLUSHING","rotuloServico":"Flushing","unidade":"M","rotuloUnidade":"m","base":"PER_PRODUCTIVE_DAY","valorCadastrado":50,"planejado":null,"realizado":80,"diferenca":null,"resultado":"NO_DATA","pendenciasBase":["MISSING_RDO_BASE","NO_PRODUCTIVE_TIME"],"descricao":"Cada colaborador deve fazer 50 m de flushing por dia trabalhado. Cada pessoa da equipe do RDO conta 1 por dia com RDO deste serviço."}],"colaboradoresPorDia":[]}
```

### Equipe mínima por dia

```json
{"situacao":"BELOW","rotuloSituacao":"Abaixo da meta","emAndamento":false,"periodoInicio":"2026-09-28","periodoFim":"2026-10-04","regra":"ALL","cenario":null,"atingimentoPct":66.66666666666666,"itens":[{"tipo":"ATTENDANCE","servico":null,"rotuloServico":null,"unidade":"COLLABORATORS","rotuloUnidade":"colab./dia","base":"PER_WORKDAY","valorCadastrado":3,"planejado":3,"realizado":2,"diferenca":-1,"resultado":"BELOW","pendenciasBase":[],"descricao":"Pelo menos 3 colaboradores no RDO em cada dia de trabalho do projeto (seg, ter)."}],"colaboradoresPorDia":[{"data":"2026-09-28","planejado":3,"presentes":3},{"data":"2026-09-29","planejado":3,"presentes":2}]}
```

## G2

Uma linha por projeto: projectId, projectCode, orcamento (null sem orçamento
selecionado), custoRealizado:{total,porCategoria:[{codigo,rotulo,valor}],ate},
avancoFisico, consumoDoCusto, currency:BRL, atualizadoEm.
orcamento:{precoVenda,custoPrevisto,margemPrevista,diasPrevistos}.
Reais são strings com duas casas; percentuais são números ou null.

Fonte de verdade: detalhe de Acompanhamento, com categorias administrativas
incluídas como na visão de gestor, exclusões de cost-categories.js e salários
excluídos do Omie. Total inclui Omie, estoque líquido, manuais e mão de obra com
offshore, como o componente ProjectDetailCosts. Por categoria usa os quatro
agregados COMPRAS_OMIE, ESTOQUE, CUSTOS_MANUAIS, MAO_DE_OBRA exibidos no detalhe.
Orçamento selecionado significa versão 1, independentemente de selectionStatus (UNKNOWN/CHOSEN/LOST indica vitória da proposta).
O previsto inclui adicionais selecionados e percentual da proposta, podendo
diferir do ProjectBudget bruto/card. Consumo usa o total realizado sobre esse
previsto, arredondado a inteiro como no detalhe; null se previsto <=0 ou ausente.
ate é a data de leitura em São Paulo (a mão de obra pode ter cobertura anterior).
Sem lançamentos, custo por pessoa, salários ou dados de colaborador.

## G3

projectId, projectCode, permanenciaPrevistaDias, updatedAt. Dias vêm do orçamento
ProjectBudget versão 1 selecionado; fallback na CommercialProposal exatamente
vinculada por sourceProposalCodBd. Sem selecionar revisão por nome/código similar.
Com projetos.condicoes.valores.read, acrescentar diariaStandByEquipamento
(components.diariaEquipamento da proposta vinculada; string BRL/null) e currency.
Sem esse escopo, omitir os dois campos. Não inferir diária da proposta nova.

## G4

id, projectId, projectCode, collaboratorId, funcao (jobRoleNameSnapshot),
mobilizacao, desmobilizacao (datas civis/null), updatedAt, deletedAt.
Somente plano oficial ativo e missão confirmada, não excluída; inclui alocações
excluídas logicamente como tombstones. Datas da alocação, sem expandir seus ciclos.
Sem nome/CPF/salário/contatos. Remoção da missão/plano requer reconciliação.

## G5

projectId, projectCode, weekStart, minutosNormais, minutosExtra70,
minutosExtra100, minutosNoturnos, pessoas, atualizadoEm. Minutos podem ser
fracionários por rateio, sem piso financeiro de 8h48. Mesma mesclagem de imports,
atribuição analítica por dia, aliases, overrides e divisão mensal de extras do
motor existente. Incluir apenas dias com ponto efetivo; conflitos sem atribuição
não entram. Omitir projetos/semanas com menos de duas pessoas com minutos.
Sem totais mensais, nomes ou identificadores de colaborador na resposta.

## Eventos

Feed exige eventos.read mais acompanhamento.progresso.read para
acompanhamento.meta_alterada e acompanhamento.revisao_concluida, ou
efetivo.alocacoes.read para alocacao.alterada. Meta de grupo gera evento por
projeto membro; nunca entrega a lista de membros. Sem backfill. Conclusão só
emite ao concluir; alterações sem mudança pública não reemitem. Tombstones de
alocações mantêm evento. Sem eventos de custos ou ponto; leitura diária.
