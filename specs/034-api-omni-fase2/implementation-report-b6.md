# Relatório — B6 Gestão (2026-11-03)

## Entrega

G1–G5 implementados, sem itens do prompt adiados. Cinco coleções, seis novos
escopos, três famílias de eventos, contratos, catálogo e Playground atualizados.
Catálogo `2026-11-03.1`: 57 escopos disponíveis e 59 operações. OpenAPI `1.11.0`;
envelope preservado em `schemaVersion: 1.0`. Mudanças aditivas, compatíveis com o
CRM. Plano, tarefas e contrato B6 foram registrados antes da implementação.

## Escopos finais

| Escopo | Sensibilidade | Dependência |
|---|---|---|
| acompanhamento.progresso.read | INTERNAL | nenhuma |
| acompanhamento.custos.read | FINANCIAL | nenhuma |
| projetos.condicoes.read | INTERNAL | nenhuma |
| projetos.condicoes.valores.read | FINANCIAL | projetos.condicoes.read |
| efetivo.alocacoes.read | INTERNAL | nenhuma |
| ponto.resumos.read | INTERNAL | nenhuma |

O único escopo adicional ao prompt é **projetos.condicoes.valores.read**. A diária
é um valor monetário e não pode sair pelo base INTERNAL. Com o adicional,
condições inclui diariaStandByEquipamento e currency:BRL; sem ele omite ambos.
Não há dependência de comercial.* nem concessão automática a tokens existentes.

## Rotas e campos para o Omni

| GET | Campos do item |
|---|---|
| /acompanhamento/projetos/semanas | projectId, projectCode, weekStart, avancoInicio, avancoFim, metaPontos, metaDefinidaPor, revisao, updatedAt |
| /acompanhamento/projetos/custos | projectId, projectCode, orcamento, custoRealizado, avancoFisico, consumoDoCusto, currency, atualizadoEm |
| /projetos/condicoes | projectId, projectCode, permanenciaPrevistaDias, updatedAt; diariaStandByEquipamento e currency somente com o adicional financeiro |
| /efetivo/alocacoes | id, projectId, projectCode, collaboratorId, funcao, mobilizacao, desmobilizacao, updatedAt, deletedAt |
| /ponto/projetos/semanas | projectId, projectCode, weekStart, minutosNormais, minutosExtra70, minutosExtra100, minutosNoturnos, pessoas, atualizadoEm |

Base `/api/integracoes/v1`. Campos solicitados preservados; currency opcional nas
condições explicita BRL. revisao é null ou {concluidaEm,pendencias,itens}, com
pendencias como quantidade e itens [{codigo,rotulo,ok}]. orcamento é null ou
{precoVenda,custoPrevisto,margemPrevista,diasPrevistos}; custoRealizado tem
{total,porCategoria:[{codigo,rotulo,valor}],ate}. Percentuais são números/null;
reais são strings de duas casas. Sem notas livres, revisores, autores, nomes de
colaboradores, CPF, salários ou lançamentos individuais.

## Convenções e fontes

- Semana segunda–domingo, padrão atual em America/Sao_Paulo, parcial até a
  leitura. weekStart deve ser segunda; alternativa from/to inclusiva, até 12
  semanas. Cursor conserva a semana padrão na virada da segunda-feira e vincula
  credencial, escopos, filtros e política de projetos.
- Avanço: computeProgressDetailsForProjects, o mesmo histórico diário e cálculo
  do detalhe. Início é o último ponto anterior à segunda, fim o último até
  domingo/data de leitura; null quando não há evidência anterior. Sem um segundo
  cálculo. RDO/ponto usam dias civis; histórico manual conserva o dia UTC de
  recordedAt, como o painel, inclusive a diferença após 21h de São Paulo.
- Metas: resolvedor compartilhado de revisões, exclusão e repetição. Projeto
  precede grupo ativo, sem revelar os outros membros. Meta estruturada sem
  plannedPctPoints retorna metaPontos null. Revisão usa checks/rótulos do app e
  respeita conclusão legada anterior à inclusão do check WEEKLY_TARGET.
- Custos: getProjectDetail, com exclusões de cost-categories.js, categorias
  administrativas incluídas como na visão de gestor e mão de obra com offshore.
  O helper do total/percentual é compartilhado com ProjectDetailCosts. Total
  inclui Omie sem salários, estoque líquido de devoluções, manuais e HH. Químicos
  não são duplicados entre Omie e estoque.
- Categorias são os quatro agregados mostrados no detalhe: COMPRAS_OMIE,
  ESTOQUE, CUSTOS_MANUAIS, MAO_DE_OBRA. Não se limita às cinco maiores despesas.
- Orçamento selecionado significa **versão 1**; selectionStatus UNKNOWN/CHOSEN/LOST
  representa a marcação de vitória, e não a seleção da revisão. O previsto segue
  o detalhe, com adicionais selecionados e percentual da proposta, podendo
  divergir do ProjectBudget bruto e do card. Consumo é percentual inteiro
  arredondado, null sem orçamento ou previsto positivo. Projetos sem proposta
  também recebem realizado do mesmo serviço, sem inventar orçamento.
- Permanência: ProjectBudget.plannedDays da versão 1; fallback na
  CommercialProposal exata ligada por sourceProposalCodBd. Diária vem dos
  components.diariaEquipamento dessa proposta; nunca de uma revisão mais nova
  escolhida por aproximação. Sem fonte conhecida, null.
- Alocações: plano oficial ativo, missão confirmada e não excluída; tombstones
  de alocação são publicados. Datas civis da alocação, sem expandir ciclos.
- Ponto: merge de imports e classificação analítica diária do motor existente,
  incluindo aliases, overrides, contexto de RDO/Efetivo e teto mensal de extras.
  Minutos efetivos, sem piso financeiro de 8h48. Pessoas sem perfil financeiro
  também contam. Projeto/semana com menos de duas pessoas com minutos apropriados
  é **omitido antes da paginação**, sem complemento mensal.

## Eventos e sincronização

Migration `20261103160000_omni_management_b6`, apenas gatilhos aditivos, sem
backfill. Meta (inclusive exclusão/revisões) e conclusão de revisão publicam
acompanhamento.meta_alterada / acompanhamento.revisao_concluida, autorizados
por eventos.read + acompanhamento.progresso.read. Alocação publica
alocacao.alterada, autorizado por eventos.read + efetivo.alocacoes.read.
Meta de grupo emite por projeto membro; não divulga lista de membros. Nota de
revisão e alterações sem mudança pública não repetem conclusão. Eventos e
alterações fazem rollback juntos. Sem eventos novos de custos ou ponto.

G1/G2/G5 usam watermark da leitura: updatedSince pode repetir linhas sem mudança,
para não perder alterações em fontes/configurações que não alteram o projeto.
G3 usa o maior carimbo de projeto/orçamento/proposta; G4 usa o da alocação.
Snapshot não reconstrói estado histórico das fontes. Reconciliar periodicamente
vínculos, visibilidade, remoções de missão/plano e semanas suprimidas por privacidade.

## Validação

- Cenários B6 com HTTP Bearer, Prisma e PostgreSQL descartável (PGlite): paridade
  de avanço manual/RDO, alteração só no serviço sem mudar o projeto, histórico,
  meta de projeto/grupo, revisão, custos com exclusões/salários/estoque/devoluções,
  HH, adicionais e percentual da proposta, orçamento ausente/zerado, condições
  com/sem valores, alocações oficiais/tombstones, aliases/override/merge do ponto,
  privacidade e supressão antes de paginar, escopos/recorte/cursor/rollback/feed.
- OpenAPI: projeções, estruturas aninhadas, parâmetros, escopos, rotas e exemplos
  fictícios. Playground: cinco operações, campos de período, validação e escopo
  financeiro opcional. Testes B6 + contrato: 15 aprovados, sem skips.
- Frontend completo: 871 aprovados, sem falhas. Lint e build aprovados.
- Todo o histórico de migrations aplicado em PostgreSQL 16 descartável; Prisma
  validate/generate, architecture:check e git diff --check aprovados.
- Revisão pelo grafo (detect_changes/get_review_context/get_affected_flows) e
  conferência na fonte. Cobertura HTTP/Prisma/SQL não é integralmente modelada
  pelo grafo. A suíte B6 foi acrescentada ao job Omni do CI.

Backend completo com PostgreSQL 16: **2.599 testes, 2.565 aprovados, 34 opcionais
ignorados e nenhuma falha**. Inclui os dois testes reais Omni de concorrência e
ordem de commit. O Prisma Client local foi regenerado para refletir o schema
atual, incluindo o outbox de e-mail anterior à B6. O banco/container descartável
de validação foi removido ao concluir.

## Depois da entrega

Nenhum item G1–G5 ficou adiado. US8, demais leituras financeiras não contratadas e
descoberta automática de CT-e continuam no backlog anterior. Aplicar a migration
no ambiente de destino, publicar o código e conceder/rotacionar explicitamente os
escopos do Omni são etapas operacionais posteriores. Não foi feito deploy nem
alterado token real ou banco de desenvolvimento/produção.

Documentação: [API_INTEGRACOES.md](../../docs/API_INTEGRACOES.md) e
[contrato B6](contracts/delivery-b6.md).
