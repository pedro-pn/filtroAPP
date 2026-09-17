# Auditoria de desempenho de produção — 17/09/2026

## Resumo executivo

A lentidão não tem uma causa única. O maior impacto observado vem da soma de
quatro fatores:

1. telas pesadas eram recalculadas a cada 30 segundos, inclusive com a aba em
   segundo plano;
2. o detalhe de um projeto carregava e processava dados de todos os projetos;
3. backups completos recomprimiam aproximadamente 4,4 GB de relatórios quase
   de hora em hora na mesma VPS;
4. a VPS compartilha somente 2 vCPUs com vários sistemas e apresentou `CPU
   steal` elevado, sinal de contenção no host físico.

O banco tem cerca de 305 MB e cabe confortavelmente na memória disponível. O
problema principal não é o tamanho bruto da base: são consultas globais
repetidas, excesso de transferência banco → Node, concorrência com backups e
ausência de isolamento entre HTTP e jobs.

## Evidências coletadas

### VPS e containers

- 2 vCPUs, 7,8 GiB de RAM e nenhum swap.
- disco de 100 GB com aproximadamente 61% de uso.
- produção, homologação e outros sistemas dividem a mesma VPS.
- `CPU steal` médio próximo de 9,8%, com picos observados de 26%.
- fila de execução chegou a 29 processos e o load chegou a 4,85.
- backend em aproximadamente 1,0–1,2 GiB de RSS, com pico de cgroup de 1,31 GiB.
- containers sem limites explícitos de CPU, memória ou PIDs.

`CPU steal` não é corrigido por otimização de SQL: ele indica que o hypervisor
não está entregando todo o tempo de CPU contratado. As mudanças de aplicação
reduzem a pressão, mas a VPS deve ser reavaliada se o indicador continuar acima
de 5% após o deploy.

### Latência observada

- cards de projetos: 3,5–9,4 s em produção;
- detalhe de projeto: 2,8–6,7 s;
- dashboard: cerca de 4,3 s;
- contagem de pendências de ponto: cerca de 4,1 s;
- geração inicial de algumas páginas de prévia PDF: 26–28 s.

Respostas HTTP `304` não eliminavam o custo: o backend calculava a resposta
completa antes de concluir que o conteúdo não havia mudado.

### Banco e tráfego interno

Em uma janela de 35 segundos foram observados:

- 375 commits;
- aproximadamente 152 MB lidos em blocos;
- 409 mil tuplas retornadas;
- cerca de 192 MB recebidos pelo backend e somente 1,1 MB enviados aos clientes.

As maiores varreduras acumuladas na janela estavam em `OmiePurchase`,
`ReportCollaborator`, `Report`, `ReportService` e `PontoPeriodSummary`.

O PostgreSQL 16.14 estava com 100 conexões máximas, `shared_buffers=128MB`,
`work_mem=4MB`, sem `pg_stat_statements`, sem `track_io_timing` e sem log de
consultas lentas. O backend mantinha 10 conexões: o parâmetro
`connection_limit` era anexado à URL, mas o `pg.Pool` usado pelo adapter não o
interpretava como limite do pool.

### Frontend e arquivos estáticos

- consultas do Acompanhamento usavam intervalo de 30 segundos;
- `refetchIntervalInBackground` mantinha o tráfego com a aba oculta;
- páginas administrativas carregavam bootstrap, usuários, cargos e pendências
  mesmo quando a aba correspondente não estava aberta;
- o bundle inicial JavaScript tinha cerca de 2,55 MB;
- JS e CSS eram entregues sem compressão e sem política de cache imutável.

O tamanho estimado de JS + CSS cai de aproximadamente 2,93 MB para 696 KB com
gzip. O code splitting implementado também tira páginas inteiras do download
inicial.

### Backups e jobs

Havia 23 execuções diárias do backup completo. Cada execução fazia dump do
banco, recomprimia todo o volume de relatórios e calculava checksums. Uma
execução levava cerca de quatro minutos; o backup das 21h coincidiu com uma
requisição de cards de 9,4 s.

Todos os jobs e o servidor HTTP rodavam no mesmo processo Node. Assim,
sincronizações, pós-processamento e trabalho nativo de PDF competiam diretamente
com requisições interativas.

## Correções implementadas nesta branch

### Requisições e frontend

- removido o polling genérico de 30 segundos e o polling em background;
- mantidos refresh por foco da janela, reconexão e invalidações após mutações;
- queries de Gestor e Efetivo agora são habilitadas somente na aba que usa os
  dados;
- páginas foram convertidas para `React.lazy`, gerando chunks por rota;
- gzip foi habilitado no Nginx;
- assets com hash recebem `Cache-Control: public, max-age=31536000, immutable`;
- `index.html` recebe `no-cache`, permitindo publicar uma nova versão sem
  prender o shell antigo no navegador.

### Backend e consultas

- detalhe de projeto passa `projectIds: [projectId]` e não carrega mais os
  agregados Omie/RDO de todos os projetos;
- dashboard, cards e custo de mão de obra usam caches locais limitados, com TTL
  e single-flight para deduplicar requisições concorrentes;
- mutações relevantes limpam os caches derivados imediatamente;
- o cache sem chave também passou a deduplicar loaders concorrentes;
- foram acrescentados índices compostos e de chaves estrangeiras respaldados
  pelos filtros observados;
- existe um script concorrente para criar os índices antes da migration em
  produção, reduzindo risco de bloqueio de escrita.

### Conexão e observabilidade

- o backend agora cria explicitamente o `pg.Pool`;
- limites e timeouts de conexão, statement, lock e transação ociosa são
  configuráveis e têm defaults seguros;
- logs de operações HTTP lentas incluem `total`, `idle`, `waiting` e `max` do
  pool;
- o compose de produção habilita consultas e operações lentas a partir de 1 s.
- PostgreSQL passa a carregar `pg_stat_statements`, medir tempo de I/O e usar
  parâmetros de memória proporcionais ao limite do container.

### Jobs, PDF e infraestrutura

- jobs recorrentes foram movidos para um processo `worker` separado em
  produção;
- backend, worker, PostgreSQL e Nginx receberam limites de recursos e
  healthchecks;
- o worker usa pool próprio de 2 conexões e o backend, 8 por padrão;
- renderizações de prévia PDF têm single-flight e concorrência global limitada;
- prévias autenticadas podem ser armazenadas apenas em cache privado e exigem
  revalidação antes de cada reutilização;
- o cron recomendado mantém dumps frequentes do banco, mas arquiva relatórios e
  certificados somente no backup completo diário/mensal;
- compressão de backup roda com prioridade baixa e o container de arquivo tem
  CPU limitada.

## Redis: usar agora ou não?

Não é recomendada a introdução de Redis como primeira resposta à lentidão.

Nesta topologia há um único processo HTTP. Um cache local limitado é mais
simples, mais rápido e não adiciona rede, serialização, custo operacional nem um
novo ponto de falha. Redis também não corrige as leituras globais, o polling, o
backup concorrente ou o `CPU steal`.

Redis passa a ser recomendável quando ocorrer uma destas condições:

- duas ou mais réplicas do backend precisarem compartilhar cache/invalidação;
- jobs forem convertidos para uma fila durável, por exemplo BullMQ;
- for necessário preservar fila, retries e agendamentos após reinício;
- medições demonstrarem que o cache local ainda deixa carga repetida relevante.

Se adotado, deve haver uma instância/banco lógico dedicado ao Filtrovali, com
autenticação, política de memória e persistência definidas. Não reutilizar o
Redis de outros sistemas da VPS. Redis deve começar pela fila de jobs; não por
cache indiscriminado de respostas.

## Plano de implantação

### Etapa 1 — homologação

1. aplicar a migration e confirmar todos os índices;
2. subir `postgres`, `backend`, `worker` e `nginx` pelo compose atualizado;
3. confirmar que somente o worker registra inicialização dos jobs;
4. navegar pelas abas de Gestor, Efetivo e Acompanhamento;
5. validar criação/edição de projeto, RDO, custos e cronograma para confirmar as
   invalidações de cache;
6. testar upload e visualização de PDF grande;
7. executar um backup somente de banco e um backup completo;
8. manter homologação em observação por pelo menos um ciclo de sincronização.

### Etapa 2 — produção em janela controlada

1. registrar baseline de p50/p95 das rotas, CPU, memória, `CPU steal`, pool e
   conexões do PostgreSQL;
2. executar `deploy/create-performance-indexes-concurrently.sql`;
3. fazer build das imagens de backend, worker e nginx;
4. aplicar migrations;
5. subir a stack e verificar healthchecks;
6. alterar o cron para os exemplos de `deploy/BACKUP.md`;
7. acompanhar logs lentos, erros e reinícios por 60 minutos;
8. comparar os mesmos indicadores após 24 horas e sete dias.

### Metas de aceite

- cards: p95 abaixo de 2 s após aquecimento;
- detalhe individual: p95 abaixo de 1,5 s após aquecimento;
- nenhuma repetição automática a cada 30 segundos com a aba em background;
- `dbPool.waiting` normalmente zero;
- nenhum restart por OOM;
- ausência de backup completo durante horário comercial;
- `CPU steal` abaixo de 5% na maior parte do tempo.

Se as metas de aplicação forem atingidas e o `CPU steal` continuar alto, mover a
produção para VPS com CPU dedicada ou separar PostgreSQL/produção dos demais
sistemas é a próxima ação. Aumentar apenas RAM não resolve contenção de CPU.

## Rollback

- manter a imagem/tag anterior disponível;
- em caso de problema funcional, reverter backend, worker e nginx juntos;
- restaurar temporariamente `BACKGROUND_JOBS_IN_API=true` somente se o serviço
  worker não puder ser iniciado, garantindo que apenas um processo execute jobs;
- índices adicionais podem permanecer durante rollback;
- voltar ao cron antigo apenas se houver requisito explícito de recuperação que
  não seja atendido pelos backups de banco frequentes + backup completo diário.
