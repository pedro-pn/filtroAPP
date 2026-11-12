# Operação e aceite das melhorias de performance

Este roteiro orienta a publicação manual da branch `fix/page-loading-performance`.
As seções datadas registram as publicações e medições confirmadas. Backups permanecem adiados pelo usuário;
não alterar cron, volumes, retenção ou configuração de backup neste trabalho.
Seguir também [PRODUCTION.md](../deploy/PRODUCTION.md) e o planejamento
[de performance](plano-performance-2026-11-09.md).

## Publicação e cache de leitura

1. Validar CI, migrations e os contratos em homologação pelo processo existente.
2. Aplicar todas as migrations antes de habilitar o cache. A migration
   `20261110230000_performance_read_revision` cria marcadores por conexão escritora
   e triggers de statement nas 187 tabelas de aplicação relacionadas no SQL.
   Não modifica cópias históricas/backup nem cria índice de negócio.
3. Manter `ACOMPANHAMENTO_READ_CACHE_ENABLED=false` inicialmente. Depois do aceite
   funcional e da comparação em staging, habilitar uma camada de cada vez pelo
   procedimento abaixo e recriar o serviço HTTP pelo processo de publicação.
   `restart` não atualiza o ambiente do container.
4. Para desativar, restaurar `false` e recriar o serviço HTTP. A migration pode
   permanecer: não depende do flag e não exige reversão destrutiva do schema.

Com `ACOMPANHAMENTO_RESPONSE_CACHE_ENABLED=true`, o cache de respostas é local ao
processo, limitado a 32 entradas, 16 MiB de respostas concluídas
e 2 MiB por resposta. O TTL é o menor entre `DASHBOARD_CACHE_TTL_MS` e 15 segundos.
Abrange cards, detalhe individual, detalhe de grupo e colaboradores do ponto. Cada leitura
autentica novamente e verifica no banco a revisão das fontes. A resposta já contém
a projeção permitida ao usuário. Filtros, divisão, permissões e escopo entram na
chave. Cada consumidor recebe um DTO independente.

O TTL começa quando o cálculo termina. Resultados concluídos e cálculos pendentes
possuem mapas separados: expiração e LRU de resultados não descartam cálculos
em andamento. Cada camada admite até 256 chaves pendentes; ao atingir esse limite,
novas chaves executam sem entrar no cache e sem fila de admissão. As chaves já
admitidas continuam compartilhadas. Limpar o cache não permite que uma execução
antiga republique seu resultado depois da limpeza. Os limites de bytes e entradas
acima continuam aplicados aos resultados concluídos.

### Comparação por camada após a ocorrência de 12/11

A primeira janela em produção mostrou lentidão e melhorou após desativar o cache
e recriar a API às 09h25min54s. A comparação teve tráfego desigual e CPU steal alto;
não demonstra que o cache sozinho causou a ocorrência. A correção local cobre a
duplicação por TTL e por descarte de cálculos pendentes, não encerra o aceite em
produção. Ver [evidência](evidence/performance-production-observation-20261112.json).

Para a próxima comparação **em staging**, configurar explicitamente:

```dotenv
ACOMPANHAMENTO_READ_CACHE_ENABLED=true
ACOMPANHAMENTO_RESPONSE_CACHE_ENABLED=false
ACOMPANHAMENTO_MONTHLY_CACHE_ENABLED=false
ACOMPANHAMENTO_REFERENCE_CACHE_ENABLED=false
ACOMPANHAMENTO_PROGRESS_CACHE_ENABLED=false
```

Os quatro subcontroles têm default `true` para preservar a configuração anterior
quando só o flag principal era informado. O flag principal `false` continua
desligando todas as camadas. Com todas as camadas desligadas, a API também evita
a consulta de revisão. Com qualquer camada interna ligada e respostas desligadas,
a API verifica a revisão, executa o handler e permite compartilhar apenas as
fontes selecionadas.

Recriar a API e medir uma base aquecida; depois testar cada subcontrole isoladamente,
recriando e repetindo o mesmo aquecimento, volume, concorrência, rotas e perfis em
cada fase. Começar por referências, depois mensal, avanço e respostas. Só combinar
as camadas que passarem individualmente. Validar também gravações externas do worker,
ausências, calendário, permissões e igualdade financeira das respostas. Produção
continua com o flag principal desligado durante essa investigação.

Com a coleta HTTP ativa, cada evento inclui `caches` com rótulos fixos `responses`,
`monthly`, `references` e `progress`. O relatório soma `hit`, `miss`, `shared`,
`bypassed`, `expired`, `evicted`, `oversized`, `loadFailed`, `decodeFailed`,
`revisionChanged`, `admissionRejected`, `encodedBytes`, `admissionMs`, `encodeMs`
e `decodeMs`. A etapa `cache.verify`
mede a verificação no banco. `revisionChanged` conta trocas de revisão observadas
pela camada, não identifica tabelas nem representa uma contagem de commits.
Tempos de encode/decode são somas, não percentis; decode inclui a cópia de buffers.
Valores grandes continuam sujeitos aos limites de armazenamento. No mensal,
`admissionRejected` registra uma decisão conservativa anterior ao V8; não é uma
medição exata dos bytes. `bypassed` indica cálculo sem armazenamento/compartilhamento,
inclusive nas leituras seguintes que usam apenas o marcador de tamanho.
Nenhuma chave, revisão, usuário, ID de projeto ou conteúdo entra nessa telemetria.
Requisições abortadas podem encerrar seu registro antes que o cálculo termine;
os tempos de trabalho posteriores ao aborto não entram nesse evento.

As alterações dos marcadores pertencem à mesma transação dos dados; commits fora
de ordem continuam detectáveis, e rollback não altera a versão publicada. Escritores
usam linhas distintas. Não há contador global bloqueado por toda escrita. Sessões,
sondagens de jobs e a telemetria excluída não alimentam os DTOs. Uma falha na
verificação de revisão retorna 503, inclusive se houver resposta antiga em memória.

`ACOMPANHAMENTO_MONTHLY_CACHE_ENABLED` controla o snapshot interno do cálculo mensal.
Cards, detalhe/grupo
e ponto podem reutilizá-lo quando a revisão, importação e escopo/canal coincidem.
Há um limite adicional de oito entradas/8 MiB, até 2 MiB por entrada e 15 s.
Cada consumidor recebe mapas, datas e valores independentes. O formato V8 existe
somente na memória do processo; os contratos HTTP continuam em JSON. Jobs,
escritas e cálculos fora do GET/HEAD verificado não usam esse compartilhamento.
Esta continuação não exige outra migration além da revisão transacional anterior.

A ocorrência de staging em 12/11 mostrou um snapshot mensal de 32.548.590 bytes,
descartado após 561,73 ms somados de encode/decode. O mensal agora verifica a
admissão antes de serializar, com orçamento de 2 MiB, no máximo 50.000 visitas e
64 níveis. Strings, arrays e buffers grandes encerram a verificação cedo;
objetos inesperados ou com getters também seguem sem cache. A estimativa é
conservativa e pode recusar um resultado menor; o limite real do buffer continua
sendo verificado quando há serialização. Nenhum campo, período ou cálculo é cortado
para caber no limite.

O loader mensal constrói um grafo próprio por cálculo. Um resultado recusado vai
somente ao consumidor que o produziu, sem encode/decode pelo cache. Requisições
que já aguardavam esse cálculo executam seus próprios loaders, no contexto de
permissões e revisão de cada uma, para manter Maps, datas e valores independentes.
São mantidos até oito marcadores de chave/prazo, sem o conteúdo do cálculo,
por até 15 s: leituras seguintes seguem imediatamente pelo caminho sem snapshot,
sem repetir a inspeção ou aguardar outra tentativa de admissão. Nova revisão,
expiração ou limpeza permite tentar admitir novamente. Falhas não criam marcadores.
Os snapshots pequenos continuam compartilhados e respeitam os limites anteriores.

Repetir a comparação mensal em staging. Para históricos grandes, esperar
`bypassed` e ausência de `encodedBytes`/`encodeMs`/`decodeMs` do mensal quando a
triagem recusar o snapshot. Comparar também concorrência com a base desligada:
fora do orçamento não há reaproveitamento do cálculo entre requisições. Isso
remove custo inútil do cache, mas não substitui a otimização do cálculo original,
o aceite de p95 nem a investigação de CPU steal no host.

### Comparação controlada em staging — 12/11, 12h09–12h27

Foi executada uma instância HTTP temporária da mesma imagem de staging, com
`BACKGROUND_JOBS_IN_API=false`, pool de oito conexões, 1,5 CPU e 2 GiB de memória.
O backend original continuou ativo, inclusive seus jobs; esta separação não
reproduz integralmente o worker de produção. Não houve alteração persistente no
ambiente, publicação ou reinício dos serviços existentes.

Cada fase teve três passagens de aquecimento por rota. A carga medida intercalou
as quatro rotas com concorrência dois e despacho limitado a duas requisições por
segundo, usando o administrador dedicado de staging. A base e a fase com apenas
respostas concluíram cem leituras por rota. p95 do cliente HTTP interno:

| Rota | Novas camadas desligadas | Apenas cache de respostas |
| --- | ---: | ---: |
| Cards | 2.201,5 ms | 1.173,5 ms |
| Detalhe de projeto | 2.536,1 ms | 851,6 ms |
| Detalhe de grupo | 351,6 ms | 103,8 ms |
| Ponto, resumo | 3.329,9 ms | 1.964,6 ms |

O cache de respostas registrou 350 hits em 400 leituras. As metas aquecidas de
cards e detalhe foram observadas nessa fase e nesse perfil. O CPU steal mediano,
porém, foi diferente: 18,0% na base e 11,0% com respostas. São fases sequenciais,
portanto a diferença de latência não pode ser atribuída integralmente ao cache.
O pool ficou sem fila em 98,24% e 99,11% dos intervalos amostrados, respectivamente;
esses intervalos excluem primeira carga, aquecimento e leitura após gravação.

A fase apenas mensal foi interrompida após 366 leituras por cinco amostras
consecutivas de CPU steal acima de 50%, chegando a 74,3%. Não há p95 de aceite
para essa fase incompleta. Houve 16 recusas antecipadas de snapshot, somando
204,75 ms de inspeção, sem bytes codificados nem encode/decode pelo cache mensal.
A correção evitou esse trabalho de serialização; o cálculo original continuou
necessário. As 1.166 leituras medidas das três fases retornaram 200, sem abortos,
com um único hash de JSON canônico por rota, igual entre as fases.

Depois de expirar o cache de respostas, um pedido adicional de resumo do ponto
foi perfilado, fora da coorte de latência. `addDate` e
`classifyActualWorkforceDays` somaram 387 das 1.418 amostras próprias (27,3%);
coleta de lixo apareceu em 206 (14,5%). O código percorre o intervalo completo
para cada colaborador e recria/converte datas UTC. A próxima otimização local é
preparar e reutilizar o calendário desse cálculo, preservando todas as listas,
conflitos e valores financeiros. Esse perfil isolado não explica todos os bytes
do snapshot nem toda a latência das rotas.

O cache de respostas segue como candidato para validação com outros perfis,
gravações externas e navegação. O mensal não recebeu aceite de latência. A meta
de CPU steal abaixo de 5% na maior parte do tempo permanece pendente, assim como
frio/pós-gravação, LCP, proxy/TLS e observação de 24 h/sete dias em produção.
As sessões de teste foram encerradas e a instância temporária removida; o backend
original manteve imagem e horário de início. Backups e retenção não foram alterados.
Ver [amostras, telemetria, perfil e limites da comparação](evidence/performance-staging-controlled-20261112.json).

### Correção local do calendário e investigação de capacidade — 12/11

A continuação local implementou um calendário UTC preparado uma vez por cálculo
mensal e reutilizado na classificação dos colaboradores. A preparação é adiada
até a primeira classificação, e não há cache entre requisições. Jornadas,
ausências, feriados e arrays de resultado continuam independentes; nenhum dia do
histórico foi removido. A etapa numérica `labor.workforce.days` mede a anotação e
classificação dentro do cálculo mensal.

Cinco pares alternados com Node 22.23.2, em container local de 1,5 CPU/2 GiB:

| Cenário sintético | Mediana anterior | Mediana atual |
| --- | ---: | ---: |
| Classificação de 200 colaboradores, setembro/2026 | 9,95 ms | 2,09 ms |
| Classificação de 200 colaboradores, janeiro/2010–setembro/2026 | 1.662,60 ms | 76,44 ms |
| Cálculo mensal completo, 21 colaboradores, histórico longo | 201,62 ms | 98,40 ms |

O ganho de 51,2% do cálculo completo exclui boot/imports, aquecimento e serialização;
não é ganho percentual do app nem p95 HTTP. Todos os resultados financeiros dos
pares foram iguais. Foram comparadas também 24 respostas HTTP completas contra
`3c2b887e`: administrador/visualizador, quatro rotas e três estados de dados,
incluindo gravação externa e mudança de ausência/calendário, com a candidata ativa.
A suíte de backend passou com 2.923 aprovações e 54 ignorados em Node 24; o grupo
adicional com PostgreSQL/HTTP passou em 21 verificações, e 23 testes focados também
passaram em Node 22. Arquitetura passou. O banco/volume descartável foi removido.
Ver [evidência da correção](evidence/performance-workforce-calendar-20261112.json).

A investigação da VPS foi somente leitura, sem carga HTTP sintética. Há quatro
vCPUs KVM e 43 containers em cinco daemons Docker. Em duas janelas de 45 amostras,
o CPU steal mediano foi 9,68%/16,33%, com máximos de 52,91%/51,47%. Na segunda
janela a API usou somente 0,751 segundo de CPU, enquanto o host ainda registrou
steal elevado. Isso sustenta investigar a disponibilidade de CPU do host;
não identifica um vizinho nem comprova a causa no provedor. O número de containers
isoladamente também não demonstra saturação.

Separadamente, a API tem cota de 1,5 CPU. Na primeira janela, houve throttling em
40 dos 144 períodos ativos de cota (27,8%); na segunda, zero em 26. Essa fração não
representa porcentagem de requisições ou de tempo transcorrido. Não houve OOM nos
cgroups observados do filtroAPP. A interpretação segue a documentação de
[steal no KVM](https://docs.kernel.org/virt/kvm/x86/msr.html#custom-msr-list) e dos
[controles de CPU](https://docs.kernel.org/admin-guide/cgroup-v2.html#cpu-interface-files).
Ver [séries e inventário de capacidade](evidence/performance-vps-capacity-20261112.json).

Próximas ações operacionais: publicar a correção em staging, repetir os cenários
com cache apenas de respostas e comparar novamente CPU/cota; coordenar a janela
com outros builds/deploys da VPS; pedir ao provedor a verificação de capacidade e
agendamento das vCPUs. Reavaliar cotas com a carga já otimizada e completar a série
de 24 h/sete dias. A comparação mensal segue sem aceite, e o carregamento no
navegador ainda precisa ser medido. Nenhum limite, serviço, cron, backup ou
configuração persistente da VPS foi alterado por esta continuação.

Texto preparado para o operador enviar ao provedor, sem envio automático:

> Na VPS com quatro vCPUs KVM, observamos CPU steal mediano de 9,68% e 16,33%,
> com picos de 52,91% e 51,47%, em 12/11/2026, 16:44:32–16:45:20 UTC e
> 16:50:02–16:50:50 UTC. Não geramos carga HTTP de teste nessas janelas. Na segunda,
> a API principal usou apenas 0,751 segundo de CPU e não atingiu sua cota. Solicitamos
> verificar disponibilidade/agendamento das vCPUs físicas e eventual limitação no
> host. Podemos fornecer a série amostrada a cada segundo.

### Validação publicada em staging — `46092546`, 12/11

O backend publicado em staging foi conferido pelo commit, imagem e hashes de quatro
fontes, com Node 22.23.5. As 280 leituras medidas entre tentativas de carga e
verificação funcional retornaram 200 e mantiveram um único JSON canônico por rota.
O ensaio funcional cobriu base, somente mensal e somente respostas, em cards,
projeto, grupo e resumo do ponto. As verificações sem sessão retornaram 401.
O administrador dedicado também navegou por projetos e custo/hora via HTTPS,
com APIs 200 e sem erros de JavaScript ou rede na janela observada. Isso não
substitui o aceite de outros perfis, gravações e atualização entre sessões.

As duas tentativas de carga foram interrompidas por cinco amostras consecutivas
de CPU steal ≥50%: 18 leituras a até duas requisições/s, com pico de 66,83%, e
250 leituras a até uma requisição/s, com pico de 78,99%. Nenhuma rota/configuração
concluiu cem amostras; **não há p95 nem aceite de latência**. Uma verificação 401
intencional terminou seu registro na borda da segunda janela; o coletor a
contabilizou como evento extra. Os 250 clientes e seus 250 eventos autenticados
foram 200. A evidência conserva esse alerta de coleta, separado de erro da API.
Sem carga sintética, a mediana de steal ainda ficou em 13,33%; a API de produção
usou 0,719 segundo de CPU durante os trinta segundos de observação.

No login público, cinco navegações com o perfil móvel original observaram LCP de
5.220/5.236/5.188/5.192/5.192 ms: mediana **5.192 ms**, acima da meta de 2.500 ms.
Não houve erro de JavaScript ou recurso nessa coleta. O viewport foi 390×844,
banda 200.000 B/s, latência 150 ms, CPU 4× e cache desativado.

A investigação confirmou uma diferença na entrega: staging não configurava os
tipos gzip nem a política de cache de assets de produção. Os arquivos principais
de JS e CSS chegaram sem `Content-Encoding` ou `Cache-Control`, com 399.992 e
282.002 bytes. A correção em `deploy/nginx/staging.conf` alinha gzip, assets e HTML
à configuração de produção. Em Nginx 1.27 isolado localmente, JS/CSS/MJS foram
comprimidos e descomprimidos integralmente; os assets receberam a política de
cache e HTML/rota SPA receberam `no-cache`. A redução do payload sintético desse
teste não estima ganho no bundle ou no LCP do app.

**A correção do Nginx precisa de uma nova publicação em staging.** Depois de
atualizar o arquivo pelo processo manual, recriar somente esse serviço para
atualizar também o bind mount:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d --no-deps --force-recreate nginx
```

Conferir `Content-Encoding: gzip` com negociação de gzip nos assets, a política
de cache e repetir as cinco navegações. Retomar as coortes comparáveis com cem
amostras por rota/perfil quando a disponibilidade de CPU permitir. A configuração
publicada e os serviços existentes não foram alterados durante os testes; APIs
temporárias e navegador foram encerrados e as sessões revogadas. Backups e
retenção permaneceram inalterados. Ver [evidência e limites](evidence/performance-staging-calendar-validation-20261112.json).

O pipeline separa referências e relatórios/decisões do mês, e carrega o custo antes
dos metadados de cards/detalhe. Seus tempos aparecem nas etapas `labor.sources.*`,
`cards.sources.*` e `detail.sources.*`; continuam dentro da duração HTTP. Não há
fila de admissão. As novas leituras em lote usam pais/IDs selecionados pelo cliente
protegido. Ausências levam apenas IDs/datas, sem tipos ou observações; seus dados
intermediários não recebem um novo cache entre requisições.

Catálogos de cargos/parâmetros, custos anuais e filtros de categorias também podem
compartilhar leituras entre requisições com revisão verificada.
`ACOMPANHAMENTO_REFERENCE_CACHE_ENABLED` controla esse armazenamento adicional:
16 entradas/4 MiB, até 1 MiB por entrada
e 15 s. Cliente Prisma, escopo/canal e opções do filtro entram na chave. Os
resolvers são reconstruídos a partir de cópias independentes dos dados; funções
e clientes não são armazenados. As seleções de colunas e regras anteriores são preservadas.
As referências mensais também incluem os colaboradores ignorados e o calendário
do intervalo. Falhas não ficam em cache, e uma revisão nova não participa da leitura pendente
da anterior. Sem GET/HEAD verificado, inclusive em escritas, não há esse reuso.

Com `ACOMPANHAMENTO_PROGRESS_CACHE_ENABLED=true`, as fontes normalizadas do avanço
são compartilhadas por projeto entre cards,
detalhe e grupo, preservando os leitores protegidos e sua ordem. Há outro limite
de oito entradas/8 MiB, até 2 MiB por projeto e 15 s, com cópias independentes.
Cliente, escopo/canal, modo de correção e revisão entram na chave. IDs ausentes
continuam ausentes; conjuntos parcialmente sobrepostos consultam apenas os projetos
que faltam. As fontes da própria requisição também separam leituras anteriores
à verificação e versões distintas, inclusive em contextos aninhados.

A revisão do avanço passou a ignorar a ordem de retorno dos serviços realizados
e a ordem das chaves JSON. A primeira leitura após a publicação pode atualizar o
histórico uma vez pelo novo identificador; leituras seguintes mantêm a revisão
quando as mesmas fontes apenas chegam em outra ordem. Os cálculos preservam a
ordem original das entradas.

Novas tabelas de aplicação exigem o mesmo trigger em sua migration. O teste
`derived-read-cache.integration.test.js` compara cobertura com o schema Prisma.
O flag não deve ser habilitado quando esse gate ou a migration falhar.

## Observação HTTP por 24 horas

Configurar em homologação e, posteriormente, na janela de produção aprovada:

```dotenv
HTTP_PERFORMANCE_ENABLED=true
HTTP_PERFORMANCE_WINDOW_MS=86400000
HTTP_PERFORMANCE_SAMPLE_MS=100
```

A janela começa no processo HTTP; reiniciá-lo muda a janela. Não gravar tokens,
URLs com parâmetros, nomes ou payloads nos registros. Os logs normalizam as rotas.
Para gerar o relatório, **rode no servidor**, na raiz do checkout:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml logs --since 24h --no-color backend \
  | docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T backend \
      node scripts/report-performance.js > /tmp/filtro-performance-report.json
```

O comando usa Node no container; o script lê stdin, ignora linhas sem o evento
`[HTTP PERFORMANCE]` e mantém agregados limitados. Não salvar logs brutos junto
das evidências. O p95 só é informado quando todos os tempos da rota couberem no
limite de amostras; um valor `null` não é aceite.

`pool.waitingZeroFraction` usa intervalos globais observados apenas com requisições
ativas. Meta: pelo menos 95% sem fila e nenhuma sequência observada de espera acima
de cinco segundos. A amostragem não mede a espera individual de cada consulta.
Registrar intervalo, total de amostras e tráfego; não comparar máximos por request
com essa fração. Desativar a coleta após a janela e repetir a comparação após sete
dias. A série de infraestrutura deve registrar CPU steal (meta abaixo de 5% na
maior parte do tempo), memória/OOM, event loop, erros e progresso dos jobs.

No benchmark HTTP local, os buckets positivos incluem primeira carga, aquecimento,
carga aquecida e leitura após gravação. As negativas de acesso são verificadas
separadamente. A partir desta rodada, o aquecimento também conserva seu bucket
de intervalos antes do reset; artefatos antigos com dez buckets não incluem esse
trecho e sua fração global não é diretamente comparável à nova série de onze.

## Aceite funcional e de carregamento

- Usar dois navegadores/sessões independentes, incluindo perfis com e sem acesso
  financeiro. Alterar medições, ponto, cargos/parâmetros, despesas e alocações;
  confirmar valores/projeções e atualização na outra sessão em até 15 segundos.
- Cobrir primeiro grupo, projeto individual, divisão, avanço atual/histórico,
  revisão, ponto completo/resumo/conciliação e navegação entre abas.
- Confirmar que a página oculta não faz polling. Abrir os modais adiados e validar
  foco, Escape e a consulta da aba ativa.
- Medir ao menos 100 requisições por rota/perfil para p95: cards abaixo de 2 s;
  detalhe abaixo de 1,5 s. Separar frio, aquecido e após gravação; não aceitar p95
  frio com uma única amostra. Registrar concorrência, pool e volume dos dados.
- Fazer ao menos cinco navegações no login com o perfil móvel original: LCP
  mediano até 2,5 s. Medir conteúdo útil das superfícies autenticadas com o mesmo
  perfil. Rede, TLS, proxy e renderização não são cobertos pelo benchmark Node.

## Retenção exclusiva de JobRun

**Política definida pelo usuário em 11/11/2026: 90 dias.** Não há limpeza de
JobRun no agendamento normal. `--only-job-runs` consulta/altera somente jobs e grava
a auditoria da própria execução; não executa a retenção geral de sessões, tokens,
documentos ou rascunhos. Preserva falhas, execuções em andamento e o último sucesso
de cada nome, incluindo empates. Cada aplicação tem lotes e total de lotes limitados.

Antes/depois da aplicação, medir as linhas criadas por dia UTC e o tamanho da
tabela/índices, **rode no servidor**:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T backend \
  node scripts/report-job-run-volume.js --days=7
```

O relatório usa transação somente de leitura, timeout de cinco segundos por
consulta e janela de 1–90 dias. Emite contagens por dia/status e bytes; nomes de
jobs, payloads e erros individuais não entram no artefato. `estimatedRows` é uma
estimativa do catálogo; a contagem diária é consultada. Falha termina com erro,
sem produzir uma contagem vazia como sucesso.

Na coleta somente leitura de **11/11/2026 às 22:00 UTC**, produção tinha 358.456
JobRuns: 81.035.264 bytes de tabela e 152.887.296 de índices, com cerca de 5.176
linhas/dia nos seis dias completos anteriores. A prévia equivalente ao escopo de
90 dias apontou **7.226 candidatos**, preservando os últimos sucessos/empates.
Esse número é uma observação datada: repetir o preview do CLI atualizado antes de
aplicar. A versão publicada ainda não tinha a migration de revisão nem os flags
da nova coleta/cache. Ver [evidência](evidence/performance-misses-closure-20261111.json).

Com o prazo aprovado de **90 dias**, **rode no servidor** para apenas simular:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T backend \
  node scripts/run-data-retention.js --only-job-runs --job-run-retention-days=90
```

Conferir o preview antes de qualquer exclusão. A aplicação manual usa o mesmo
comando com `--apply --batch-size=500 --max-batches-per-target=20`. Comparar contagem,
linhas criadas por dia e tamanho de JobRun antes/depois. Não combinar esse escopo
com exclusão de rascunhos. O prazo de 90 dias foi aprovado; a aplicação permanece
manual, após conferência do preview, e não altera a política de backups.

## Manutenção dos marcadores de revisão

A tabela contém uma linha por PID escritor e uma linha de época. O crescimento
depende da renovação de conexões. Observar seu tamanho; não confundir esses
metadados com histórico de negócio. A compactação preserva PIDs ativos, exige idade
mínima de 24 h por padrão e processa no máximo 500 marcadores por execução.

Para apenas simular, **rode no servidor**:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T backend \
  node scripts/compact-read-revisions.js
```

Após conferir, `--apply` executa um lote. `--batch-size` aceita 1–5000;
`--min-age-hours` aceita 1–8760. A compactação avança a época na mesma transação
da remoção, impedindo a reutilização acidental de uma versão antiga. Um advisory
lock sem espera evita compactadores concorrentes. Não há novo job agendado.
