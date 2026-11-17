# Recálculo financeiro e envio de JSON — 13/11/2026

Continuação local na worktree `filtroAPP-performance`, branch
`fix/page-loading-performance`, atualizada por fast-forward até a main
`1b46fa52c9626a61b4d712412cf905e093990b77`. As mudanças recentes de avanço manual,
divisões de RDO, assinaturas e Omie foram preservadas. O usuário informou que a
entrega anterior está em produção e aumentou o espaçamento entre backups. Esta
continuação não acessou nem alterou produção, cron, backups ou retenção.

## Implementação mantida

`computeCollaboratorRates()` aceita a opção interna `includeWorkforceDetails`,
com default `true`. O caminho financeiro de `laborCostByProject()` e a listagem
do ponto com `view=summary` passam `false`: quando não há snapshot mensal
compartilhado, deixam de preparar disponibilidade, conflitos e calendários de
exibição que essas projeções não usam. O complemento descrito ao final também
omite as fontes SQL exclusivas dessas anotações. Identidades, histórico de cargos,
ignorados e o motor financeiro continuam preservados. Horas, folgas financeiras,
salários, perfis, parâmetros, rateios, meses, viagens e trilhas não são removidos
ou recalculados por outra regra.

A leitura completa do ponto mantém as anotações. Quando o cache mensal está
habilitado em uma leitura verificada, seu loader **sempre solicita o grafo
completo**, incluindo ignorados e workforce. Isso mantém a chave existente e o
compartilhamento entre custo e ponto, impedindo que o primeiro leitor financeiro
deixe um snapshot incompleto para o próximo leitor. Nesse modo, não há o ganho
de omitir anotações. Os limites e o bypass de snapshots grandes permanecem.

O cache de respostas guarda JSON imutável. Cards, projeto, grupo e colaboradores
do ponto agora podem enviar esse JSON diretamente, preservando autenticação,
projeção e verificação de revisão em cada leitura. Evitam `JSON.parse` e a nova
serialização do mesmo DTO no caminho HTTP. Consumidores que pedem objetos
continuam recebendo DTOs independentes. Configurações próprias do Express para
replacer, indentação ou escaping seguem pelo caminho normal de `res.json`.
Content-Type existente, comprimento, ETag, HEAD e 304 foram testados.

As fontes mensais do ponto passam a ordenar os pais por `createdAt` e `id`.
Antes, um UPDATE podia mover um colaborador na lista sem alterar seus dados de
negócio, fazendo uma resposta em cache divergir de outra leitura. O novo teste
PostgreSQL regrava um valor idêntico e verifica todos os campos e a ordem. A
comparação com a seleção Prisma aninhada usa a mesma ordem definida. Não há novo
índice ou migration.

## Medição do recálculo

Esta medição e a medição HTTP abaixo antecedem o complemento de fontes SQL
condicionais. Seus dados e hashes originais permanecem na evidência da primeira
rodada; os tempos não foram atualizados ou atribuídos ao complemento.

Foram cinco pares alternados por modo/cenário: **30 pares, 60 medições**, com
Node 22.23.2 e PostgreSQL 16 descartáveis, somente dados sintéticos e todos os
caches novos desligados. Node e banco tiveram limite de duas CPUs; o container
Node teve 3 GiB e o banco 1 GiB. Tempo de import/boot, projeção do resultado e
saída JSON ficam fora da medição. O aquecido executa uma leitura anterior;
o modo novo processo usa outro processo Node/Prisma com páginas SQL aquecidas.

| Cenário, 21 colaboradores | Modo | Mediana anterior | Mediana atual | Variação |
| --- | --- | ---: | ---: | ---: |
| Um mês trabalhado em intervalo 2010–2026 | Aquecido | 82,68 ms | **52,34 ms** | **36,70% menor** |
| Um mês trabalhado em intervalo 2010–2026 | Novo processo | 342,78 ms | **269,04 ms** | **21,51% menor** |
| Um mês, intervalo de um mês | Aquecido | 51,43 ms | 47,36 ms | 7,91% menor |
| Um mês, intervalo de um mês | Novo processo | 307,51 ms | 303,27 ms | 1,38% menor |
| 36 meses trabalhados | Aquecido | 268,61 ms | 262,54 ms | 2,26% menor |
| 36 meses trabalhados | Novo processo | 760,67 ms | 776,00 ms | **2,01% maior** |

O cenário denso não mostrou ganho consistente. Os ganhos pequenos ficam próximos
da variabilidade das cinco observações; não são meta de p95. No histórico esparso,
a CPU mediana passou de 117,72 para 110,19 ms no aquecido e de 703,89 para
544,01 ms no novo processo. CPU do processo inclui suas threads e exclui o banco;
não deve ser confundida com tempo de parede ou consumo total do host.

A referência é a implementação da main. O consumidor financeiro não utiliza
`workforceDays`, `workforceConflicts` ou `workforceCalendarRevision`: esses três
campos são retirados **depois da medição**, dos dois resultados comparados. Todos
os demais campos, valores, datas, meses, trilhas e rateios são comparados. Somente
a ordem da lista raiz de colaboradores e das entradas do mapa por ID é
normalizada entre versões, pois a ordem anterior não era garantida. Não há
arredondamento para esconder diferenças financeiras.

Uma tentativa de reaproveitar trilhas diárias e calendários por recorte foi
retirada: sua última comparação regrediu no aquecido. Os resultados desfavoráveis
estão na evidência, e esse código não faz parte da implementação mantida.

## Medição HTTP do JSON já codificado

Quatro APIs novas executaram na ordem referência/candidato/candidato/referência,
somente com cache de respostas ligado. Foram **1.600 respostas 200**, com cem
amostras por rota/perfil/versão, administrador e perfil restrito, concorrência um
e keep-alive. Todos os pedidos medidos foram hits ainda válidos; os dois modos
fizeram **3.800 chamadas ao pool**. Os quatro casos são cards, projeto, grupo e
resumo do ponto. Na medição HTTP, a fixture histórica densa foi mantida junto da
fixture de acesso, tornando o resumo do ponto um DTO de 323.726 bytes.

| Resumo do ponto | Mediana de envio anterior | Mediana de envio atual | p95 HTTP anterior | p95 HTTP atual |
| --- | ---: | ---: | ---: | ---: |
| Administrador | 2,11 ms | **0,51 ms** | 15,67 ms | 10,80 ms |
| Perfil restrito | 2,13 ms | **0,51 ms** | 15,23 ms | 11,62 ms |

O trecho `http.serialize` inclui o envio/ETag síncrono; o novo caminho envia o
texto pronto. Decode passa a preparar o invólucro imutável, sem parse no HTTP
padrão. Todos os campos HTTP coincidiram entre versões; somente a ordem raiz de
`rates` do resumo foi normalizada. Cada versão manteve seu corpo bruto estável
entre rodadas. Não foram normalizadas trilhas, alocações ou valores monetários.

Esse ensaio é local, sem TLS, proxy, compressão ou navegador. Mede hits de cache,
não partida fria, expiração ou escrita. Não prevê o p95 em produção, e as
variações de rede, agendamento, GC e SQL não foram isoladas do tempo total.

## Validação da primeira rodada e publicação

- Backend completo: **3.004 aprovados, 53 ignorados, zero falhas**, Node 24.15.0,
  com outro PostgreSQL descartável migrado e Python do Data Book disponível.
- Bateria Node 22/PostgreSQL/HTTP/snapshots: **30 aprovados, zero ignorados ou
  falhas**. Inclui projeções, valores, históricos de cargos/parâmetros, permissões,
  commits externos, falha de revisão, grafos completos/independentes, contratos
  HTTP e ordem estável depois de UPDATE.
- Arquitetura e whitespace aprovados. A comparação de imports recentes da
  regressão Omni passou a usar timestamps sintéticos explícitos, preservando a
  verificação 960 → 720 minutos sem depender do relógio do banco.
- Containers, volume e bancos descartáveis próprios removidos. Nenhum serviço
  de desenvolvimento existente ou banco publicado foi alterado.

**Não há variável obrigatória, migration ou Redis novo.** O caminho financeiro
reduzido funciona com o cache principal desligado. O envio do JSON pronto usa os
flags de respostas já existentes e continua sujeito à homologação antes de
ativação em produção. Mensal/referências/avanço permanecem decisões separadas;
esta implementação não altera flags publicados.

O próximo aceite é publicar em staging, comparar resumo com a visão completa,
validar alertas/perfis/divisões e atualizações nas duas sessões, primeiro com cache
desligado e depois somente respostas. Depois do deploy aprovado, repetir as
medições reais e as séries de 24 h/sete dias. A capacidade da VPS, retenção manual
de JobRun e as demais pendências operacionais continuam no planejamento.

Dados, hashes, amostras e tentativas anteriores:
[evidência](evidence/performance-recalc-json-20261113.json).

## Complemento: fontes SQL condicionais — 13/11

A opção interna `includeWorkforceDetails` agora chega aos loaders de períodos e
referências. No caminho reduzido, a consulta de identidades preserva colaboradores
e histórico de cargos, mas omite a subconsulta de `CollaboratorAbsence` e retorna
ausências vazias. A consulta de referências preserva os ignorados, incluindo nomes
quando solicitados, mas omite `WorkforceHoliday` e `WorkforceCalendarState`; seu
calendário é `null`. O resolver de feriados também deixa de executar nesse caminho.
São três fontes exclusivas das anotações de disponibilidade, sem alteração das
fontes ou regras financeiras.

As chaves de referências incluem a variante completa/reduzida, tanto na cache da
requisição quanto na cache versionada entre requisições. Os testes alternam as
duas ordens de leitura e verificam nova revisão. Falhas de leitura dos ignorados
continuam sendo erros, e períodos invertidos continuam inválidos. A seleção dos
IDs e das datas permanece parametrizada por Prisma, inclusive com IDs contendo
aspas; não há interpolação de identificadores recebidos como texto SQL.

O padrão permanece completo. O snapshot mensal verificado continua solicitando
`includeWorkforceDetails: true`, mesmo se o primeiro consumidor for financeiro.
Assim, o ganho de fontes condicionais se aplica ao cálculo sem esse snapshot,
inclusive quando o cache principal está desligado. A tela completa conserva
ausências, feriados, revisão do calendário e alertas.

Uma captura adicional em Node 22.23.2/PostgreSQL 16 descartável usou 21 pessoas,
cinco ausências no período, uma excluída, uma fora do período, histórico de cargo,
um feriado manual e um ignorado. Os planos `EXPLAIN (ANALYZE, BUFFERS)` das duas
consultas de pacotes contêm as três tabelas no modo completo e nenhuma delas no
modo reduzido. Colaboradores, cargos e ignorados continuam presentes. O JSON dos
pacotes SQL decodificados passou de **5.484 para 4.329 bytes**. Isso exclui a
consulta inalterada de `PontoPeriodSummary`: permanecem duas consultas de pacotes,
com menos subconsultas e dados, sem alegação de menos viagens ao banco ou de
ganho de latência HTTP. O resultado financeiro completo coincidiu após remover
somente os três campos de anotação, sem normalizar valores, datas ou ordem.

Validação final do complemento:

- **3.009 testes de backend aprovados, 53 ignorados e zero falhas**, Node 24.15.0,
  PostgreSQL descartável migrado e Python do Data Book disponível.
- **39 verificações Node 22/PostgreSQL/HTTP/caches aprovadas**, sem ignorados ou
  falhas, e **39 testes unitários focados aprovados**. Incluem paridade com
  ausências/histórico reais da fixture, SQL reduzido, calendário completo,
  isolamento de referências, snapshots, permissões e atualizações externas.
- Arquitetura aprovada. Container e volume próprios de PostgreSQL removidos.
  Nenhum serviço existente ou ambiente publicado foi alterado.

Não há nova variável, migration ou serviço para este complemento. O próximo
aceite permanece a homologação em staging descrita acima. A evidência histórica
da primeira rodada foi preservada; fontes, planos, contagens e validações deste
complemento estão na
[evidência das fontes condicionais](evidence/performance-workforce-source-projection-20261113.json).
