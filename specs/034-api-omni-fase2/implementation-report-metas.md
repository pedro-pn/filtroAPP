# Complemento B6/G1 — metas na unidade cadastrada

Implementado em 03/11/2026, em `/acompanhamento/projetos/semanas`, sob o mesmo
escopo `acompanhamento.progresso.read`. Mudança aditiva, sem migração de banco,
sem escopo ou evento novo. OpenAPI 1.12.0, catálogo 2026-11-03.2, envelope 1.0.

## Campos finais para o Omni

Nenhum nome solicitado foi alterado. `metaPontos` e `metaDefinidaPor` mantêm a
seleção e os valores existentes. O novo `meta` é null para NO_TARGET, ou:

```text
meta
  situacao, rotuloSituacao, emAndamento
  periodoInicio, periodoFim, regra, cenario, atingimentoPct
  itens[]
    tipo, servico, rotuloServico, unidade, rotuloUnidade, base
    valorCadastrado, planejado, realizado, diferenca
    resultado, pendenciasBase[], descricao
  colaboradoresPorDia[]
    data, planejado, presentes
```

O prompt não nomeava a lista diária; foi escolhido **colaboradoresPorDia**.
Ela contém somente os dias contratados da meta dentro do período, exatamente
como `dailyAttendance` do painel; sem meta de presença, é vazia. `presentes`
pode ser null para ausência de base, equipe não confirmada ou dia futuro.
Não converter null para zero. `atingimentoPct` mantém a precisão do cálculo
compartilhado; não transforma os valores físicos dos itens em percentuais.

Contrato, regras de nulidade e exemplos fictícios das seis variações (p.p.,
listas E/OU, cenário, dia produtivo pendente e presença) em
[delivery-b6.md](contracts/delivery-b6.md#g1--meta-na-unidade-cadastrada) e
[OpenAPI](../015-api-token-playground/contracts/openapi.yaml).

## Decisões de implementação

- O único cálculo de meta continua sendo `buildWeeklyProgressComparison`.
  A projeção da integração só traduz seus campos por allowlist. Para cenários
  antigos, que não possuem outcome por goal, `resultado` traduz os valores já
  calculados para MET/BELOW/NO_DATA/PLANNED.
- Rótulos e frases saíram da implementação exclusiva do frontend para
  `shared/modules/weekly-target-presentation.js`. O painel reexporta essas
  funções e a descrição de cenários usa a mesma função consumida pela API.
- A montagem das fontes físicas é compartilhada no backend por
  `loadWeeklyComparisonSources` e `buildWeeklyComparisonHistories`, também
  usados pelo carregador do painel. Reutiliza medições conciliadas/corrigidas,
  histórico importado, equipe dos RDOs e o construtor de presença existente.
  Nenhum método de extração, produtividade ou presença foi reimplementado.
- O hook do frontend ainda escolhe o histórico contextual recebido do detalhe
  (projeto, agrupamento ou recorte) e chama a função pura. Essa escolha depende
  da visão aberta, que a linha por projeto da integração não representa por
  inteiro. Para projetos, a API fornece o mesmo `dailyProgressHistory` do
  detalhe. Não foi substituído por um histórico calculado de outra maneira.
- Metas próprias e de grupo são resolvidas com todo o histórico de revisões,
  inclusive revisões adjacentes fora da página, preservando repetição, exclusão
  e cortes de períodos sobrepostos. Projeto continua tendo precedência.
- **Granularidade do grupo:** quando a regra é herdada do grupo, o realizado
  é o do projeto da linha. Não agrega outros membros nem lê suas fontes fora
  do recorte do token. Assim, essa linha não equivale ao painel consolidado de
  todo o grupo. Preserva-se o contrato por projeto da B6; a diferença está
  explícita no contrato para o Omni não tratar a linha como um total do grupo.
- Semanas futuras continuam recusadas pelo filtro existente. PLANNED é
  possível na semana atual quando o período de contagem ainda não começou;
  a projeção também foi testada diretamente com semana futura.
- Não publica autor, notas, equipes, identificadores individuais ou valores
  em reais. A presença diária permite só data e quantidades. As permissões e
  os cursores mantêm as regras existentes.
- O realizado muda com os RDOs sem evento novo; releitura das últimas quatro
  semanas a cada 30 minutos é suficiente conforme o consumidor. Alterações
  de meta continuam usando `acompanhamento.meta_alterada`.

## Desempenho

Carrega apenas os projetos da página, sem uma consulta por projeto/semana.
A consulta de serviços é compartilhada com o avanço por meio de uma promise,
mantendo as leituras independentes concorrentes. Há uma leitura em lote dos
RDOs para equipe/tipos de serviço; produtividade e presença usam essa mesma
base em memória. O comparativo é calculado uma vez por proprietário/projeto
na página e indexado por semana.

O teste com dois projetos autorizados, quatro semanas e um projeto externo
confirmou uma consulta a cada fonte: `report`, `reportService`,
`historicalServiceReport` e `projectRealizedCorrection`. Não foi feito benchmark
nos 85 projetos de produção; a validação comprova ausência de N+1, não um SLA
de latência do ambiente publicado.

## Validação

- `integration-weekly-targets.test.js`: Prisma e PostgreSQL WASM descartável,
  paridade com os carregadores do painel em p.p., metros, litros, unidades,
  listas E/OU, qualquer serviço, cenário, NO_RULE, base produtiva pendente,
  presença em lista/cenário, NO_DATA, PLANNED, repetição e contagem quarta–terça.
  Verifica alteração de RDO sem alteração de meta, privacidade e consultas em lote.
- `integration-omni-management.test.js`: HTTP autenticado, meta legada e
  herdada do grupo, escopos, recorte, paginação, sincronização e Playground.
- Testes existentes de metas, períodos de contagem, presença, produtividade,
  serviços, avanço, detalhe, agrupamento, conciliação e histórico importado passaram.
- OpenAPI: validação das allowlists, parâmetros e esquemas, referências e
  exemplos completos das seis formas de meta passou.
- Frontend: os 871 testes da suíte completa passaram, assim como lint e build.
  Os quatro cenários de navegador previstos no CI também passaram.
- Gerador Python do Data Book: 23 testes, com uma referência local ausente
  ignorada conforme a regra existente.
- Auditorias npm de backend/frontend aprovadas no limite high, sem achados
  altos ou críticos. Verificação do proxy HTTPS de staging aprovada.
- `npm run architecture:check` e `git diff --check` passaram.

Os testes de paridade usam seu próprio PostgreSQL WASM descartável. A suíte
completa do backend também foi executada com PostgreSQL 16 em contêiner
descartável e dependências Python isoladas. Os testes inicialmente recusados
pelas proteções de nome/URL do banco foram repetidos com a configuração
esperada, incluindo o teste legado de revisão concorrente de metas.
Nenhum banco de produção foi acessado.

As alterações estão no workspace. Não houve deploy.
