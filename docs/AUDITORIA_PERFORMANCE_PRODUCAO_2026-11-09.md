# Auditoria de performance de produção — 09/11/2026

A lentidão permanece concentrada nos caminhos de dados e cálculo. O acesso público
é rápido, os índices estão aplicados e o worker está separado da API, mas o detalhe
de projetos grandes ainda demora vários segundos. Backups completos horários,
espera pelo pool e crescimento do histórico de jobs acrescentam pressão.

Esta rodada complementa a [auditoria de setembro](AUDITORIA_PERFORMANCE_PRODUCAO_2026-09-17.md)
e a [auditoria PostgreSQL de junho](../AUDITORIA_PERFORMANCE_POSTGRESQL.md).
O [plano de implementação](plano-performance-2026-11-09.md) usa os resultados abaixo.
As amostras e configurações verificadas estão nas
[evidências estruturadas](evidence/performance-production-20261109.json).

## Método e alcance

- Coleta em 09/11/2026, aproximadamente 17h53–18h04 UTC, ou 14h53–15h04 de Brasília.
- SSH autorizado pelo usuário. Nenhum deploy, reinício, alteração de cron, migration,
  limpeza de dados, reset de estatísticas ou expiração do cache da API foi executado.
- HTTP público: 20 leituras sequenciais de `/` e 20 de `/health`, com pausa de 500 ms.
- Serviços: processo Node separado dentro do container da API, conectado ao banco
  real com `default_transaction_read_only=on`, confirmado antes das consultas.
  Pool diagnóstico de duas conexões, operações sequenciais e pausas de 500 ms.
  A API publicada usa oito conexões. Os tempos de serviço excluem autenticação HTTP,
  transporte e renderização do navegador; seus caches em memória são próprios.
- Foram feitas cinco leituras por serviço na primeira rodada e três para o grupo
  de missões e a conferência mensal em processo novo. “Primeira leitura” significa
  cache local do processo frio; os buffers do PostgreSQL não foram limpos.
- Logs HTTP: janela solicitada de seis horas, limitada às últimas 120 mil linhas.
  O logger só registra operações a partir de 1 segundo. As 580 ocorrências obtidas
  não fornecem o denominador de tráfego nem o p95 de todas as requisições.
- Navegador: Chromium via Playwright, cinco navegações no login público, viewport
  390×844, cache desativado, banda configurada em 200.000 B/s, latência configurada
  de 150 ms e CPU em 4×. É uma simulação local, com conexões reaproveitadas, não
  uma medição de usuários reais ou de páginas autenticadas.

O checkout do host estava em `3db7e76f`. O SHA256 dos arquivos de detalhe,
avanço e status Omni dentro da API coincide com o workspace auditado. Isso confirma
esses três arquivos, sem presumir identidade de toda a imagem com o checkout.

## HTTP e carregamento público

| Consulta | Amostras | Mediana total | p95 empírico total | Máximo |
| --- | ---: | ---: | ---: | ---: |
| `/` | 20 | 57,38 ms | 83,40 ms | 298,27 ms |
| `/health` | 20 | 57,98 ms | 81,88 ms | 92,45 ms |

O HTML publicado tem `Cache-Control: no-cache`. Os 13 arquivos JS/CSS referenciados
diretamente por ele são comprimidos com gzip e recebem cache imutável. Somam
208.652 bytes transferidos, sem cabeçalhos, e 822.283 bytes descomprimidos.
Esses números não incluem os recursos adicionais da rota, imagens e fonte.

No login em simulação móvel, o LCP ficou entre **3.240 e 3.264 ms**, com mediana
de **3.244 ms**. A primeira amostra registrou aproximadamente 531 KB de transferência
de recursos, incluindo cabeçalhos. O símbolo PNG tem aproximadamente 85 KB, o logo
do login 92 KB e a fonte latina 48 KB. O símbolo apareceu em duas entradas da
amostra com cache desativado; é necessário confirmar o comportamento normal antes
de tratar isso como download duplicado persistente.

## Serviços com dados de produção

Tempos em milissegundos. A coluna de repetições mostra mínimo–máximo e exclui a
primeira leitura. Os poucos pontos por serviço são diagnóstico, não p95 HTTP.
Tamanhos são do JSON serializado sem compressão e sem dados impressos no relatório.

| Serviço | Primeira leitura | Repetições | JSON aproximado |
| --- | ---: | ---: | ---: |
| Dashboard comercial | 1.074 | 0,08–0,10 | 272 KB |
| Cards de projetos | 3.842 | 0,06–0,21 | 287 KB |
| Detalhe 5775 | 493 | 217–379 | 123 KB |
| Detalhe 5719 | 8.352 | **5.869–6.920** | **1.097 KB** |
| Status Omni 5775 | 135 | 117–211 | 446 B |
| Status Omni 5719 | 71 | 56–90 | 462 B |
| Visão geral do Efetivo | 67 | 42–48 | 35 KB |
| Primeira página de workflows | 61 | 31–42 | 431 KB |
| Conferência semanal | 2.421 | 30–32 | 269 KB |
| Conferência mensal, após carga semanal | 249 | 157–212 | 314 KB |
| Grupo ativo amostrado, processo novo | 7.214 | 197–320 | 102 KB |
| Conferência mensal, processo novo | 4.168 | 351–469 | 314 KB |

Os acertos submilissegundo do dashboard e dos cards confirmam o cache de serviço;
não representam o custo HTTP completo. O detalhe grande permanece lento mesmo
após aquecimento. As primeiras leituras da segunda rodada coincidiram com o backup
das 18h UTC; não são uma comparação isolada do efeito desse backup.

### Cálculo de avanço do projeto 5719

Uma leitura adicional comparou os dois modos da mesma função, durante o backup:

| Modo | Tempo decorrido | CPU acumulada do processo | Histórico diário | Recortes |
| --- | ---: | ---: | ---: | ---: |
| Somente avanço atual | 338 ms | 516 ms | 0 | 0 |
| Pacote completo | **6.106 ms** | **6.543 ms** | 67 pontos | 11 |

Ambos usaram 297 linhas de escopo. CPU acumulada inclui threads do processo e pode
superar o tempo decorrido. O resultado mostra custo relevante de processamento do
pacote completo, além das consultas. A otimização `currentOnly` do Omni funciona em
produção; sua aplicação não substitui os históricos necessários no Acompanhamento.

## Requisições reais já registradas pela API

| Rota identificada no log | Ocorrências ≥1 s | Menor tempo registrado | Maior tempo registrado |
| --- | ---: | ---: | ---: |
| Cards `/projetos-cards` | 61 | 1.914 ms | **14.887 ms** |
| Bootstrap `/gestor` | 59 | 1.139 ms | **9.592 ms** |
| Pendências `/pendencias/contagem` | 63 | 1.061 ms | **8.269 ms** |
| Bootstrap `/new-report` | 84 | 1.004 ms | **7.829 ms** |
| Detalhe `/projetos/:projectId/detalhe` | 4 | 2.773 ms | **14.026 ms** |
| Grupo `/grupos-missoes/:groupId/detalhe` | 2 | 6.639 ms | **8.988 ms** |
| Coleção Omni `/efetivo/projetos/status` | 6 | 1.037 ms | 3.225 ms |

Entre as 580 ocorrências lentas, 233 terminaram com `304`: a revalidação HTTP ainda
pode acontecer depois do trabalho caro. `dbPool.waiting` chegou a **42** no final
de uma requisição lenta. Os nomes do log usam o caminho local do router; entradas
como `GET /` misturam módulos e não permitem atribuição inequívoca.

## Infraestrutura, banco e backups

- VPS atual: **4 vCPUs e aproximadamente 16 GiB de RAM**. Em setembro eram 2 vCPUs
  e 7,8 GiB. Houve aumento de recursos, mas a contenção de CPU continua presente.
- API e worker tinham zero reinícios desde a recriação e `OOMKilled=false`.
  Os limites de recursos estão ativos. API usa oito conexões; worker, duas;
  `BACKGROUND_JOBS_IN_API=false` na API. Worker e Nginx não têm healthcheck no Compose.
- PostgreSQL 16.14: `pg_stat_statements` carregado, I/O timing ativo, log de SQL
  acima de 1 s, 50 conexões máximas, `shared_buffers=512MB` e `work_mem=8MB`.
- As três migrations de performance de junho/setembro estão concluídas. Todos os
  **18 índices** do script de implantação estão presentes, válidos e prontos.
- Banco com aproximadamente **614 MiB**. `JobRun` ocupa 215 MiB, `Report` 156 MiB,
  `ReportSignature` 54 MiB e `OmiePurchase` 49 MiB, incluindo seus índices e TOAST.
  A estimativa de linhas vivas de `JobRun` era 347.225. Duas famílias de jobs de
  assinaturas já tinham mais de 105 mil registros concluídos cada.
- Os contadores de SQL acumulam desde 23/10. Cópias de backup de `Report`, `JobRun`
  e `ReportSignature` aparecem entre os maiores custos totais. Também há leituras
  amplas de relatórios e resumos do ponto. Esses totais não são exclusivos desta coleta.

O cron real continua executando **backup completo horário**. O wrapper carrega sua
configuração e chama o script do repositório; o script conserva
`INCLUDE_REPORTS=true` por padrão. O último backup concluído começou às 17h00m01s
UTC e terminou às 17h11m33s: **11 minutos e 32 segundos**, incluindo relatórios,
certificados e proxy. O backup horário observado é local; o diário tem destino B2.
A compressão de banco usa `nice 19` e o container de arquivos tem limite de 0,5 CPU:
essas proteções estão aplicadas, mas não evitam recomprimir todo o acervo.

Em 30 amostras de um segundo durante os serviços, `CPU steal` teve média de 19,2%,
com pico de 52%. Em outras 30 amostras, sem o processo de serviços e coincidindo com
o backup das 18h UTC, teve média de **35,8%**, com pico de 67%. Uma janela inicial
curta antes desse backup também já apresentou valores acima de 5%. A coexistência
não isola causalidade; backup e contenção do host precisam de acompanhamento separado.
O servidor usa UTC: o cron diário de 02h corresponde a 23h de Brasília do dia anterior.

## Reavaliação das prioridades

1. Reduzir concorrência dos backups preservando a recuperação dos documentos e medir
   o tráfego completo para conseguir calcular os p95 exigidos pelo plano original.
2. Reduzir o custo do pacote completo de avanço e a recomputação do detalhe; o ganho
   comprovado no Omni não se estendeu ao histórico completo do Acompanhamento.
3. Recuperar as consultas condicionadas por aba no Gestor e rever atualização
   periódica/invalidações, mantendo os dados atualizados entre navegadores.
4. Reduzir recursos iniciais, imagens de marca e código das seções do Efetivo.
5. Tratar a carga fria do ponto e o crescimento de `JobRun`. A conferência mensal
   aquecida foi rápida; sua reescrita não deve anteceder os gargalos comprovados.

Redis continua condicionado à necessidade de coordenação entre processos/réplicas
ou fila durável. Aumentar o pool por causa da espera observada exige antes distinguir
CPU, consultas demoradas e rajadas de requisições. A contratação de CPU dedicada
deve ser decidida com uma série mais longa após reduzir a concorrência dos backups.
