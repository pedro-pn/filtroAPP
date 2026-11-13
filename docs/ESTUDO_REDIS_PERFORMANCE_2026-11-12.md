# Comparação do cache de respostas e estudo de Redis — 12/11/2026

**Recomendação: continuar com o cache de respostas em memória e corrigir o custo
dos recálculos antes de acrescentar Redis.** A aplicação tem um processo HTTP e
um worker separado. Redis pode ajudar a compartilhar respostas entre futuras
réplicas HTTP, mas não houve evidência de vantagem em substituir o armazenamento
local nessa topologia. Esta avaliação não implementa Redis no app.

Código avaliado: `44d279a534cd083359dbacbbd89a8352873847dc`, na worktree
`filtroAPP-performance`, branch `fix/page-loading-performance`.

## Comparação no staging publicado

Entre **21h02min46s e 21h17min08s UTC**, quatro APIs descartáveis executaram a
mesma imagem publicada e os mesmos dados de staging. Ordem: sem cache, somente
respostas, somente respostas, sem cache (ABBA). Cada API teve 1,5 CPU, 2 GiB e
pool oito, sem jobs. O cache mensal, o de referências e o de avanço ficaram
desligados nos quatro processos. Os caches legados de 60 s foram mantidos nos
dois modos; o cache novo de respostas usou TTL de 15 s.

Foram **1.200 respostas 200**, cinquenta por rota em cada rodada, totalizando
**cem por rota/modo**, com concorrência máxima dois e até duas requisições/s.
Cada amostra foi associada por identificador numérico a exatamente um evento do
servidor. Três passagens de aquecimento por rodada ficaram fora das medições.
As primeiras navegações estão no artefato, com apenas duas observações por
rota/modo; não constituem p95 frio.

O cliente usou HTTP sem compressão, com conexão nova, pela rede privada Docker.
O experimento mede a API sob carga controlada; **não inclui TLS, Nginx, navegador
ou renderização**. Seus tempos absolutos não são comparáveis ao reteste anterior
por HTTPS. Expirações e eventos lentos estão incluídos na tabela, sem descarte.

| Rota | Mediana sem cache | Mediana somente respostas | p95 sem cache | p95 somente respostas |
| --- | ---: | ---: | ---: | ---: |
| Cards | 33,14 ms | 23,14 ms | 405,02 ms | **499,33 ms** |
| Projeto selecionado | 106,69 ms | 21,15 ms | 1.381,46 ms | **320,94 ms** |
| Grupo selecionado | 126,27 ms | 14,80 ms | 735,03 ms | **229,84 ms** |
| Resumo do ponto | 1.920,04 ms | 22,96 ms | 4.844,40 ms | **2.508,71 ms** |
| Dashboard geral | 950,14 ms | 28,36 ms | 2.306,40 ms | 1.190,20 ms |
| Contagem de pendências | 131,61 ms | 58,38 ms | 3.705,91 ms | 1.468,30 ms |

Os cards melhoraram na mediana, mas **pioraram no p95 nesta coorte**. Não há ganho
uniforme comprovado para todas as rotas. Projeto/grupo atingiram a meta de detalhe
nesse escopo; isso não encerra o aceite em navegador, outros perfis ou produção.
O ponto continua com picos de segundos quando a resposta expira.

Dashboard geral e contador não usam diretamente o leitor de respostas. A melhora
observada nessas rotas acompanha a menor disputa com o cálculo do ponto e a
variação de CPU; não demonstra que passaram a ter cache próprio. O contador
permanece com o caminho numérico publicado em `44d279a5` nos dois modos.

| Indicador | Sem cache | Somente respostas |
| --- | ---: | ---: |
| Requisições medidas | 600 | 600 |
| CPU acumulada da API temporária | 277,78 s | 74,78 s |
| CPU por requisição, média da coorte | 462,97 ms | 124,64 ms |
| Steal mediano do host | 21,96% | 20,04% |
| Pico de steal do host | 81,84% | 65,49% |

O consumo de CPU da API caiu **73,08% na coorte**. O contador de cgroup inclui
logs/health e exclui PostgreSQL, worker e demais apps. Não é medição do consumo
total da VPS. As rodadas tiveram steal mediano de 31,56%, 16,32%, 23,50% e 14,22%,
respectivamente. Uma pausa de 7 s protegeu a última rodada; nenhuma resposta lenta
foi removida. A ordem ABBA reduz o efeito da tendência temporal, mas não isola a
VPS de outros processos ou do hypervisor.

O cache atendeu 80/100 leituras de cards, projeto e grupo e 83/100 do ponto.
As demais refizeram trabalho por expiração/revisão. A média de chamadas a
`Pool.query` caiu de 33,2 para 12,9 no projeto, de 38,6 para 11,5 no grupo e de
22 para 7,23 no ponto. Essas chamadas incluem autenticação/verificação quando
aplicável; não representam somente consultas de cálculo nem cobrem consultas
diretas de transações. Não há evidência para aumentar o pool.

Os hashes canônicos dos **corpos completos das seis rotas** foram idênticos nos
dois modos durante este experimento. As negativas sem autenticação retornaram
401 e as quatro sessões terminaram com logout 204. Não foram exercitadas escritas
ou permissões de outros perfis nesta rodada. A igualdade não resolve a diferença
histórica do dashboard entre as duas publicações anteriores.

Não houve OOM; o pico amostrado das APIs temporárias foi 0,63 GiB. Ao final,
API, worker, PostgreSQL e Nginx publicados estavam saudáveis, sem reinícios e com
as mesmas imagens/horários de início. As APIs descartáveis foram removidas e os
flags publicados continuaram todos desligados. Produção, backups e retenção
permaneceram inalterados.

Dados e verificações: [evidência ABBA](evidence/performance-staging-response-abba-44d279a5-20261112.json).

## O que Redis mudaria neste app

O leitor atual autentica/autoriza e valida parâmetros antes do cache. Também
consulta a revisão comprometida no PostgreSQL antes de reutilizar uma resposta.
A chave inclui usuário, acesso a projetos e variante da consulta. O cache limita
o armazenamento a 32 entradas/16 MiB, com até 2 MiB por entrada, e compartilha
trabalho em andamento no próprio processo.

Trocar esse armazenamento por Redis manteria o cálculo completo nos misses, a
verificação de revisão e o custo de converter os dados. Acrescentaria uma chamada
de rede em cada acerto. Uma única instância HTTP já compartilha sua memória entre
as requisições. Redis se torna mais útil quando há múltiplas instâncias aquecendo
as mesmas chaves, cenário descrito na [documentação de cache-aside do Redis](https://redis.io/docs/latest/develop/use-cases/cache-aside/).

O compartilhamento entre usuários continua limitado pelas projeções financeiras
e permissões: instalar Redis não permite remover o usuário/escopo da chave.
Os 80–83% de acertos medidos com um administrador e as mesmas consultas não são
previsão para muitos usuários, filtros e gravações. A revisão de negócio pode
invalidar respostas entre duas leituras; Redis não melhora essa taxa sozinho.

| Alternativa | Benefício possível | Limite neste momento |
| --- | --- | --- |
| Memória no processo atual | Reuso de respostas sem rede; implementação e métricas existentes | Reinício esvazia; réplicas não compartilham entradas |
| Redis na mesma VPS | Entradas comuns entre processos e sobrevivência ao reinício da API | Adiciona serviço/rede; continua disputando a mesma CPU da VPS |
| Redis gerenciado/fora da VPS | Compartilhamento e operação separada | Rede/TLS/custo; o cálculo no Node continua necessário nos misses |
| DTO compacto ou resultado materializado versionado | Reduz trabalho e tamanho reaproveitado por qualquer armazenamento | Exige projeto, paridade, invalidação e medição próprios |

A documentação do Redis também explica que a latência de virtualização e de rede
se soma à operação. Um Redis na mesma VPS **não elimina CPU steal**. Um serviço
externo pode tirar o armazenamento da VPS, mas não tira dela o cálculo que continua
no backend. Ver [diagnóstico oficial de latência](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/).

## Ensaio de Redis isolado

Foram usados containers **locais descartáveis**, sem portas públicas, rede
interna privada e somente dados sintéticos. Redis 7.4.12, cliente oficial
`redis` 6.3.1 e Node 22.23.2; imagens e hashes dos scripts constam da evidência.
Nenhuma dependência do repositório foi adicionada. Nenhum Redis existente de
outros apps foi acessado.

O ensaio comparou o cache real `createDerivedReadCache()` com `GET` no Redis,
seguido de `JSON.parse` e `JSON.stringify` em ambos. Os tamanhos seguem os DTOs
observados no staging; sua estrutura é sintética. Houve três rodadas de cem
leituras por caso/modo, com ordem alternada: **4.800 medições** nos quatro modos,
300 por combinação. As 48 verificações de integridade foram aprovadas.

| DTO sintético | Tamanho | p95 cache atual local | p95 Redis com o mesmo parse/serialize |
| --- | ---: | ---: | ---: |
| Projeto | 7.086 B | 0,074 ms | 0,444 ms |
| Grupo | 12.727 B | 0,181 ms | 0,485 ms |
| Cards | 236.484 B | 2,362 ms | 3,120 ms |
| Ponto | 389.330 B | 4,030 ms | 5,846 ms |

Redis foi mais lento nessa operação de acerto equivalente. O resultado não
antecipa a latência do app com Redis: foi medido em outra máquina, sem consultas
de revisão/autorização, TLS, HTTP, cálculo, concorrência ou pressão da VPS. O TTL
de 60 s apenas evitou expirações no ensaio de componentes; não é proposta de
alteração do TTL de 15 s do app.

Também foram comparadas respostas já codificadas, sem parse/serialize. Para o
ponto, o p95 desse caminho foi aproximadamente 0,0014 ms na memória local e
1,482 ms no Redis. A comparação sugere investigar o envio de JSON já codificado;
o benefício de evitar conversões **não depende de Redis**. Esses números excluem
o envio HTTP e não constituem uma implementação pronta.
Qualquer mudança deve preservar contrato, headers, projeção e isolamento.

Um estresse separado tentou armazenar **32.548.590 B**, tamanho do snapshot
mensal excessivo anteriormente observado. Era apenas uma string grande, não o
grafo real de Maps/Dates. O verificador atual rejeitou a entrada antes de codificar.
Forçar o armazenamento no Redis de 64 MiB produziu recusa `OOM_MAXMEMORY` e
evicções; a mensagem é uma recusa do comando, não um OOM kill do container.
Somente nesse teste descartável, o limite foi elevado a 128 MiB para concluir
três observações exploratórias: mediana de 132,09 ms para codificar JSON,
54,82 ms para buscar bytes e 119,75 ms para buscar/decodificar. Não há p95 válido
nem equivalência com o snapshot mensal real a partir dessas três amostras.

Esse resultado reforça manter o limite de 2 MiB por entrada. Redis precisa de
limite de memória e política de evicção; eles não substituem o controle do tamanho
de cada objeto. Ver [documentação oficial de evicção](https://redis.io/docs/latest/develop/reference/eviction/).
Containers/rede foram removidos. A ausência de persistência se aplicou somente
ao Redis sintético descartável, sem mudança na política de backups do app.

Dados: [evidência do ensaio Redis](evidence/performance-redis-component-study-44d279a5-20261112.json).

## Próximos incrementos recomendados

1. **Homologar somente respostas**, mantendo mensal/referências/avanço desligados.
   Repetir pela interface/HTTPS com perfis financeiros e restritos, divisões e
   atualização em outra sessão após escritas. A comparação atual favorece essa
   camada, mas não autoriza concluir todos os gates funcionais/publicados.
2. **Reduzir recálculo e alocação de objetos do ponto/detalhe.** Uma captura
   exploratória de um miss do ponto teve 435/1.631 amostras no garbage collector
   (26,67% das amostras, incluindo idle). `computeCollaboratorRatesUncached`,
   `classifyProjectHours`, `mergePontoPeriods` e classificação de eixos aparecem
   entre os trechos ativos. Confirmar em novas capturas antes de escolher a
   alteração; não mudar regras de custo nem cortar histórico. Priorizar DTOs
   compactos/reuso de preparação e comprovar paridade em dados esparsos/densos.
3. **Verificar se vale evitar parse/serialize repetido de respostas grandes.**
   Medir o caminho HTTP real, preservar autorização/revisão e conservar o limite
   por entrada. Esse é um trabalho local independente da adoção de Redis.
4. **Continuar a avaliação de CPU com o provedor** e as janelas reais de
   observação de 24 h/sete dias. Sem resolver a variação da VPS, cache não garante
   teto para partida fria, expiração e gravações frequentes.
5. **Reabrir Redis somente com necessidade medida de compartilhamento.**
   Exemplos: duas ou mais réplicas HTTP com trabalho duplicado, muitas partidas
   frias ou resultado compacto reutilizável entre API/worker. Fazer então um
   experimento do app integrado, comparando com o mesmo DTO/codificação local,
   carga e revisão; medir p95 global/hit/miss, CPU, memória, taxa de acertos,
   falhas, invalidação e custo de operação.

Se esse último gatilho ocorrer, a implementação deve começar opt-in, limitada a
respostas compactas, preservando autenticação, projeções e revisão PostgreSQL.
Usar namespace de ambiente/versão do DTO/build, revisão, usuário, escopo e consulta;
TTL sozinho não cobre escritas externas/commit tardio. Prever limites de memória,
timeouts curtos, métricas, falha do Redis e fallback somente após verificar a
atualização. Coordenar cálculos concorrentes entre réplicas se necessário. A
persistência e o compartilhamento com filas/sessões exigem decisões separadas;
não reutilizar o Redis de outro app por conveniência.

Não há nova publicação necessária para esta documentação. Não foram habilitados
flags persistentes, integrados serviços, executadas retenções ou alterados backups.
