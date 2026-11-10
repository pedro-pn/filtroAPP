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
Abrange detalhe individual, detalhe de grupo e colaboradores do ponto. Cada leitura
autentica novamente e verifica no banco a revisão das fontes. A resposta já contém
a projeção permitida ao usuário. Filtros, divisão, permissões e escopo entram na
chave. Cada consumidor recebe um DTO independente.

As alterações dos marcadores pertencem à mesma transação dos dados; commits fora
de ordem continuam detectáveis, e rollback não altera a versão publicada. Escritores
usam linhas distintas. Não há contador global bloqueado por toda escrita. Sessões,
sondagens de jobs e a telemetria excluída não alimentam os três DTOs. Uma falha na
verificação de revisão retorna 503, inclusive se houver resposta antiga em memória.

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

Não existe prazo padrão nem limpeza de JobRun no agendamento normal. Definir a
política antes da aplicação. `--only-job-runs` consulta/altera somente jobs e grava
a auditoria da própria execução; não executa a retenção geral de sessões, tokens,
documentos ou rascunhos. Preserva falhas, execuções em andamento e o último sucesso
de cada nome, incluindo empates. Cada aplicação tem lotes e total de lotes limitados.

Após definir `JOB_RETENTION_DAYS` com o inteiro aprovado entre 1 e 3650,
**rode no servidor** para apenas simular:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T backend \
  node scripts/run-data-retention.js --only-job-runs --job-run-retention-days="${JOB_RETENTION_DAYS:?Defina o prazo aprovado}"
```

Conferir o preview antes de qualquer exclusão. A aplicação manual usa o mesmo
comando com `--apply --batch-size=500 --max-batches-per-target=20`. Comparar contagem,
linhas criadas por dia e tamanho de JobRun antes/depois. Não combinar esse escopo
com exclusão de rascunhos. Este documento não escolhe um prazo nem agenda limpeza.

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
