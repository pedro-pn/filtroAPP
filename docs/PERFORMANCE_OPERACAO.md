# Operação e aceite das melhorias de performance

Este roteiro prepara a publicação manual da branch `fix/page-loading-performance`.
Não registra uma publicação realizada. Backups permanecem adiados pelo usuário;
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
   funcional, definir `true` em `backend/.env.production` e recriar o serviço HTTP
   pelo processo de publicação. `restart` não atualiza o ambiente do container.
4. Para desativar, restaurar `false` e recriar o serviço HTTP. A migration pode
   permanecer: não depende do flag e não exige reversão destrutiva do schema.

O cache é local ao processo, limitado a 32 entradas, 16 MiB de respostas concluídas
e 2 MiB por resposta. O TTL é o menor entre `DASHBOARD_CACHE_TTL_MS` e 15 segundos.
Abrange cards, detalhe individual, detalhe de grupo e colaboradores do ponto. Cada leitura
autentica novamente e verifica no banco a revisão das fontes. A resposta já contém
a projeção permitida ao usuário. Filtros, divisão, permissões e escopo entram na
chave. Cada consumidor recebe um DTO independente.

As alterações dos marcadores pertencem à mesma transação dos dados; commits fora
de ordem continuam detectáveis, e rollback não altera a versão publicada. Escritores
usam linhas distintas. Não há contador global bloqueado por toda escrita. Sessões,
sondagens de jobs e a telemetria excluída não alimentam os DTOs. Uma falha na
verificação de revisão retorna 503, inclusive se houver resposta antiga em memória.

O mesmo flag também habilita o snapshot interno do cálculo mensal. Cards, detalhe/grupo
e ponto podem reutilizá-lo quando a revisão, importação e escopo/canal coincidem.
Há um limite adicional de oito entradas/8 MiB, até 2 MiB por entrada e 15 s.
Cada consumidor recebe mapas, datas e valores independentes. O formato V8 existe
somente na memória do processo; os contratos HTTP continuam em JSON. Jobs,
escritas e cálculos fora do GET/HEAD verificado não usam esse compartilhamento.
Esta continuação não exige outra migration além da revisão transacional anterior.

Catálogos de cargos/parâmetros, custos anuais e filtros de categorias também podem
compartilhar leituras entre requisições com revisão verificada. O mesmo flag
controla esse armazenamento adicional: 16 entradas/4 MiB, até 1 MiB por entrada
e 15 s. Cliente Prisma, escopo/canal e opções do filtro entram na chave. Os
resolvers são reconstruídos a partir de cópias independentes dos dados; funções
e clientes não são armazenados. As seleções de colunas e regras anteriores são preservadas.
As referências mensais também incluem os colaboradores ignorados e o calendário
do intervalo. Falhas não ficam em cache, e uma revisão nova não participa da leitura pendente
da anterior. Sem GET/HEAD verificado, inclusive em escritas, não há esse reuso.

As fontes normalizadas do avanço são compartilhadas por projeto entre cards,
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
  | node backend/scripts/report-performance.js > /tmp/filtro-performance-report.json
```

O comando requer Node no host; o script lê stdin, ignora linhas sem o evento
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
