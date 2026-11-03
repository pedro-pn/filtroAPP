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
(PROJETO/GRUPO ou null), revisao, updatedAt. Avanço calculado pelo mesmo serviço
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
