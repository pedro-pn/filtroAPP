# Plano de implementação de performance — 09/11/2026

O objetivo é reduzir o tempo até o conteúdo útil nas páginas e estabilizar as
requisições interativas conforme o app cresce. A prioridade é o detalhe de projetos
grandes, o carregamento frio, o Gestor e a concorrência dos backups. A
[auditoria em produção](AUDITORIA_PERFORMANCE_PRODUCAO_2026-11-09.md) e as
[amostras estruturadas](evidence/performance-production-20261109.json) fundamentam
a ordem abaixo. A implementação local foi iniciada em `fix/page-loading-performance`.
O estado de cada entrega está registrado ao final; as medições de produção abaixo
continuam sendo o baseline anterior à publicação.

## Escopo e garantias

Preservar regras de cálculo, autorizações, visibilidade de custos, recortes de
projetos, datas, documentos e atualização entre navegadores. Páginas novas devem
herdar os mesmos limites e critérios. Usar a stack existente e manter contratos
compatíveis durante a migração dos consumidores.

Alterações de banco passam por migrations Prisma. A execução de infraestrutura e
publicação segue a operação manual prevista na constitution. O usuário autorizou
implementar o código exclusivamente no ambiente local e adiou qualquer mudança
nos backups. A tarefa T02 está fora da rodada atual; não bloqueia as melhorias de
aplicação. Nenhuma operação de produção ou staging integra esta implementação.
Nenhuma limpeza de histórico nem redução do objetivo de recuperação dos documentos
está autorizada por este plano.

## Metas e como verificar

| Superfície | Critério de aceite | Método |
| --- | --- | --- |
| Cards de projetos | p95 HTTP <2 s com cache aquecido | Tráfego completo da rota, incluindo autenticação e serialização |
| Detalhe individual, incluindo 5719 | p95 HTTP <1,5 s aquecido | Mesmos projeto, permissão e divisão do baseline |
| Grupo e primeira leitura fria | Redução ≥50% no tempo mediano do cenário correspondente | Novos processos diagnósticos; mesmos dados e pool; repetir fora do backup |
| Login público móvel | LCP mediano ≤2,5 s no perfil da auditoria | Cinco ou mais navegações com o mesmo navegador, banda, CPU e cache |
| Efetivo | Cada seção pesada baixada apenas ao ser aberta; sem regressão das consultas rápidas | Manifesto do build e navegação em navegador |
| Atualização | Último RDO e status visíveis em até 15 s com detalhe aberto; sem requisições periódicas da página oculta | Dois contextos de navegador e teste de visibilidade |
| Pool | `waiting=0` em ≥95% das amostras; esperas sustentadas >5 s geram diagnóstico | Amostragem durante a requisição e do pool, além do término |
| Infraestrutura | Zero OOM; acompanhamento de CPU steal com meta <5% na maior parte do tempo | Série de 24 h e comparação após sete dias |

As cinco amostras de serviço desta auditoria não são o p95 HTTP. Para declarar
aceite, medir todas as chamadas das rotas-alvo em janela representativa com pelo
menos 100 requisições por cenário. Se o tráfego natural não atingir esse número,
estender a janela ou validar carga representativa em homologação; não gerar teste
de estresse em produção para completar a amostra. A simulação de login não substitui
medição do conteúdo útil nas telas autenticadas.

## Ordem e dependências

`P0 medição → P1 Gestor → P2 detalhe → P3 carga fria → P4 frontend → P5 histórico e consolidação → P6 aceite`

T02 (backups) está adiada por determinação do usuário. Os scripts, agendamentos,
configurações e documentos operacionais de backup permanecem fora das alterações.

A preparação de P4 pode ocorrer após o baseline, independentemente de P2/P3.
Cada etapa deve ser revisável e publicável separadamente, evitando um único deploy
grande. Não introduzir Redis, novas réplicas ou aumento do pool nesta primeira rodada.

## P0 — Baseline completo e concorrência operacional

### T01 — Medir o caminho completo de cada tela

- Implementar observação configurável de todas as requisições das rotas-alvo em
  uma janela de medição, mantendo logs sem corpo, token, query string ou IDs reais.
- Registrar método, caminho normalizado com o prefixo do módulo, duração, status,
  identificador de correlação e métricas do pool. Separar 200/304 e erros.
- Medir espera máxima do pool, atraso do event loop e etapas de carga/cálculo/
  serialização. Não depender apenas da fotografia do pool no fim da resposta.
- Acrescentar marcas do tempo até o conteúdo útil no Gestor, cards, detalhe e
  seções do Efetivo; diferenciar cache inicial visível de atualização em andamento.
- Produzir p50/p95, contagens, bytes e erros para cenários frios/aquecidos e horários
  com/sem backup, com armazenamento limitado e chave para desativar a coleta.

**Arquivos:** `backend/src/middleware/request-metrics.js`,
`backend/src/lib/performance-logging.js`, `backend/src/lib/prisma.js`,
`backend/src/config/env.js`, observabilidade do frontend e script de relatório.

**Aceite:** um mesmo router montado em módulos diferentes não aparece como `GET /`
indistinguível; percentis usam tráfego completo da janela, com número de amostras.

### T02 — Corrigir a estratégia de backup sem enfraquecer a recuperação

- Conferir com o operador os RPO/RTO atuais de banco e documentos e registrar os
  valores no runbook. O cron horário atual protege ambos; não remover essa proteção
  automaticamente ao mudar para dump somente de banco.
- Manter dumps de banco frequentes. Eliminar a recompressão integral horária dos
  documentos com envio incremental/versionado, ou usar completo diário quando um
  RPO de documentos de até 24 h tiver sido explicitamente aceito.
- Preparar o diff exato do cron e do wrapper considerando UTC e Brasília. Preservar
  lock, prioridade baixa, limite de CPU, retenção e registro do status do backup.
- Se houver arquivo incremental, implementar manifestos/checksums e restauração
  da cadeia antes de trocar o cron. Validar restauração em ambiente isolado.
- Corrigir a recomendação conflitante de backup completo horário em `deploy/BACKUP.md`.

**Arquivos:** `deploy/backup-prod.sh`, `deploy/restore-prod.sh`, `deploy/BACKUP.md`,
`deploy/PRODUCTION.md`; cron e configuração externa sob responsabilidade do operador.

**Aceite:** recuperação comprovada dentro dos RPO/RTO; nenhum completo periódico
no horário comercial, salvo ação excepcional; comparação de latência, CPU e I/O.

### T03 — Confirmar a contribuição da infraestrutura

- Coletar CPU steal, uso real, throttling dos containers, I/O e latência por 24 h
  após o ajuste de backups. Os limites atuais e os 18 índices já estão aplicados.
- Acrescentar healthchecks adequados de Nginx e progresso do worker; um processo
  existente não comprova que os jobs estejam progredindo.
- Se a contenção continuar acima da meta, documentar comparação com CPU dedicada
  ou isolamento da produção. Dimensionar por CPU e I/O, pois há memória disponível.

**Aceite:** decisão de infraestrutura sustentada pela nova série, sem atribuir toda
a lentidão a uma fotografia nem aumentar conexões sem identificar a causa da fila.

## P1 — Recuperar o carregamento por aba no Gestor

### T04 — Reduzir o bootstrap e as consultas iniciais

- Mapear campos necessários por aba e separar badges/contagens leves dos dados
  completos de projetos, colaboradores, usuários e pesquisas.
- Restaurar `enabled` nas consultas de usuários, pendências e cargos conforme seus
  consumidores. Dividir o bootstrap em projeções por necessidade; habilitar o
  bootstrap amplo apenas numa aba ainda dependente dele não elimina seu excesso.
- Manter listagens paginadas, contagens em lote, pesquisa, rolagem acumulada e
  abertura direta pela URL. Preservar cache visível ao voltar de um detalhe.

**Arquivos:** `frontend/src/pages/gestor/GestorPage.tsx`,
`frontend/src/hooks/useBootstrap.ts`, `frontend/src/hooks/useUsers.ts`,
`frontend/src/api/bootstrap.ts`, `backend/src/routes/resources/bootstrap.js`.

**Validação:** navegações frias em Pendentes, Projetos, Equipe, Usuários e NPS.
Pendentes não solicita listas completas de usuários/pesquisas; badges continuam
corretos; comparar requisições, bytes e tempo útil com T01. Testes de contrato das
projeções e comportamento de navegação, sem testes que apenas procurem texto no código.

## P2 — Detalhe e avanço de projetos grandes

### T05 — Otimizar o pacote completo de avanço

- Instrumentar as etapas de seleção, normalização, linha temporal e recortes com a
  fixture equivalente à 5719: 297 linhas, histórico denso e 11 recortes.
- Reutilizar índices de escopo, normalização das fontes e acumulações por data
  entre avanço, histórico e recortes. Evitar reconstruir estruturas invariantes
  para cada data e filtro. Manter a agregação consolidada e as consultas em lote.
- Preservar resultados, pesos, arredondamento, elegibilidade de datas, percentuais
  acima de 100%, correções pós-assinatura e históricos importados/manuais.
- Manter o caminho `currentOnly` leve. A melhoria do completo não pode regredir
  os status Omni já medidos em dezenas/centenas de milissegundos.

**Arquivos:** `backend/src/lib/acompanhamento/avanco.js`,
`progress-groups.js`, `project-detail.js`, `project-detail-groups.js` e testes de avanço.

**Aceite:** paridade exata com as fixtures e snapshot sanitizado; redução inicial
≥50% do pacote completo no mesmo ambiente, seguida de validação da meta HTTP.

### T06 — Compartilhar o resultado e limitar o trabalho de atualização

- Reaproveitar o avanço calculado pelo detalhe na interface, evitando a segunda
  consulta a `/avanco` para os mesmos dados. Fazer evolução aditiva do contrato
  quando necessário e manter o endpoint existente para os outros consumidores.
- Separar o resumo atualizado frequentemente de históricos/recortes caros. Carregar
  os dados adicionais conforme a superfície precisar, com estado de carregamento;
  não retirar gráficos nem atrasar silenciosamente dados já apresentados.
- Reavaliar o polling global de 15/60 s e as invalidações amplas. Manter o resumo
  leve atualizado e buscar o pacote caro quando suas fontes mudarem ou o usuário
  abrir o painel correspondente. Evitar rajadas sincronizadas entre abas.
- Se a medição ainda exigir cache derivado, definir chave por projeto, divisão,
  canal e permissões, limite de memória, TTL e single-flight. Incluir alterações
  vindas de RDO, escopo, correções, custos, ponto, estoque, agrupamentos e integrações.
  Tratar o worker como processo separado: invalidar sua memória não limpa a API.
- Nenhuma requisição posterior a uma gravação concluída pode reutilizar um cálculo
  anterior como versão nova. Uma chave de versão só pode representar todas as fontes
  relevantes; `Project.updatedAt` isolado é insuficiente.

**Arquivos:** `frontend/src/queryClient.ts`, `frontend/src/api/dataUpdates.ts`,
`frontend/src/components/projects/ProjectDetailDashboard.tsx`,
`frontend/src/api/acompanhamentoComercial.ts`, caches e rotas do Acompanhamento.

**Aceite:** testes com dois navegadores, mutações e jobs; detalhe normal, divisão,
grupo, administrador e usuário sem acesso financeiro; atualização até 15 s sem
refazer todo o histórico a cada ciclo; zero repetição periódica com a aba oculta.

## P3 — Primeira leitura de custos e ponto

### T07 — Reduzir a carga fria compartilhando fontes

- Medir o fan-out e os bytes de `computeCollaboratorRates`, `laborCostByProject`
  e das trilhas do ponto; verificar planos SQL antes de propor novos índices.
- Separar bases reutilizáveis da montagem de cada resposta. Reduzir colunas/JSON e
  leituras globais quando a regra de apropriação permitir; documentar dependências
  entre projetos antes de particionar para não mudar a distribuição dos custos.
- Reutilizar fontes por período e importação com limites e deduplicação. A conferência
  mensal deve compartilhar o contexto do período, sem simplesmente paralelizar todas
  as semanas e transferir a carga para o pool.
- Revalidar cards, primeiro grupo e conferências em processos novos, fora da janela
  de backup e com o mesmo número de conexões do baseline.

**Arquivos:** `backend/src/lib/acompanhamento/labor-cost.js`,
`backend/src/lib/efetivo/allocation-review/read-model.js`, serviços de ponto e caches.

**Aceite:** redução ≥50% no primeiro acesso dos cenários-alvo, valores idênticos e
sem aumento de consultas proporcional ao número de projetos. A conferência mensal
fica nesta etapa após os gargalos comprovados de P1/P2, não como reescrita prioritária.

## P4 — Código, CSS e imagens no navegador

### T08 — Dividir seções e painéis internos

- Converter as seções pesadas do Efetivo para imports dinâmicos: calendário,
  produtividade, conferência, administração e evolução/workflow; dividir seus
  modais grandes quando o manifesto apontar inclusão desnecessária.
- Revisar a divisão das seções do Acompanhamento e painéis do Gestor. Carregar
  visualizadores PDF e editores grandes somente em seus fluxos.
- Medir o conjunto transitivo de dependências de cada rota, incluindo chunks
  compartilhados e CSS, e não somente o tamanho do arquivo que leva seu nome.
- Preservar URL, foco, estados de carregamento, tema e navegação móvel.

**Aceite:** abrir Visão geral do Efetivo não baixa os painéis não utilizados;
redução ≥30% do JS/CSS transferido nesse primeiro acesso; nenhuma consulta de outra
seção é antecipada para esconder o download. Registrar baselines por rota no CI.

### T09 — Reduzir a carga inicial e os arquivos de marca

- Reduzir CSS compartilhado e importações que antecipam componentes de módulos no
  shell público. Preservar as fontes e estilos necessários ao primeiro conteúdo.
- Criar favicon pequeno e variantes de logo dimensionadas ao uso, com nomes
  versionados e dimensões explícitas; conservar os originais para documentos.
- Conferir a prioridade da imagem LCP e eliminar downloads repetidos somente após
  reproduzi-los com cache normal. Verificar a política de cache de nomes sem hash.

**Arquivos:** `frontend/src/main.tsx`, `frontend/src/App.tsx`,
`frontend/src/modules/moduleRoutes.tsx`, `frontend/src/pages/PublicFlowShell.tsx`,
`frontend/src/components/brand/brandAssets.ts`, `frontend/index.html`, estilos,
pipeline de assets e `deploy/nginx/default.conf`.

**Aceite:** login dentro da meta LCP no perfil reproduzível; JS/CSS e imagens com
orçamentos separados, sem regressão visual da marca nem downloads de documentos no login.

## P5 — Crescimento dos jobs e cobertura de regressões

### T10 — Limitar o crescimento de `JobRun`

- Diferenciar execução com trabalho de sondagem sem itens. Agregar ou amostrar as
  sondagens bem-sucedidas, preservando último sucesso, falhas e evidência operacional.
- Definir política de retenção aprovada, preview/dry-run e exclusão em lotes pequenos
  por meio do serviço de retenção existente. Preservar execuções em andamento e dados
  necessários à investigação; não excluir documentos, assinaturas ou suas auditorias.
- Medir linhas criadas/dia e impacto nos dumps. A exclusão de linhas não garante
  redução imediata do arquivo físico: avaliar manutenção com o operador, sem planejar
  `VACUUM FULL` ou locks pesados no horário de uso.

**Arquivos:** `backend/src/lib/jobs/runner.js`,
`backend/src/lib/assinaturas/jobs.js`, `backend/src/lib/data-retention.js`, status
operacional e testes de retenção. Migration apenas se os índices necessários faltarem.

### T11 — Impedir o retorno das regressões

- Adicionar verificações comportamentais de requisições por aba e do detalhe aberto,
  incluindo visibilidade, mudança entre navegadores e invalidação após gravação.
- Manter regressões de paridade do avanço e de consultas em lote. Usar fixtures
  densas e orçamento relativo para sinalizar custo; tempos absolutos de CI não são
  substitutos de produção e devem tolerar variação do runner.
- Adicionar orçamento de tamanho comprimido por rota e dependências transitivas,
  com atualização explícita do baseline quando uma função nova justificar crescimento.
- Registrar no padrão de módulos que rotas, seções e consultas novas devem passar
  pelas mesmas verificações de carga, cache e atualização.

**Aceite:** CI detecta a reintrodução de bootstrap amplo em Pendentes, cálculo
duplicado no detalhe, download antecipado das seções e crescimento não revisado do bundle.

## P6 — Publicação, comparação e fechamento

### T12 — Homologar e publicar por etapa

- Executar os testes relevantes de cada mudança e o build. Na homologação, validar
  cálculos, autorizações e navegação com volume equivalente aos projetos grandes.
- Preparar notas e comandos para execução manual pelo operador. Registrar versões,
  variáveis, eventual migration e alteração de cron separadas das mudanças de interface.
- Comparar os mesmos cenários após publicação, por 24 h e sete dias; manter série
  do pool, event loop, CPU steal, memória, backups e tamanho do banco.
- Publicar p50/p95 e contagens de todas as requisições da janela. Manter resultados
  de cache frio/aquecido e laboratório/navegador/HTTP em colunas distintas.
- Marcar a etapa concluída somente com suas evidências e gates funcionais atendidos.

**Rollback:** manter imagens anteriores; desabilitar a observação adicional por
configuração; restaurar o consumidor/contrato anterior de forma compatível. Se houver
mudança de backup, preservar a última cadeia válida até testar a nova restauração.
Uma eventual migration precisa ser compatível com a versão anterior da aplicação;
não depender de reverter ou apagar dados para reverter o código.

## Checklist de execução

- [ ] T01 Coleta HTTP e marcas de conteúdo útil implementadas localmente; janela publicada pendente.
- [ ] T02 Adiada pelo usuário: estratégia de backup e recuperação.
- [ ] T03 Healthchecks de Nginx/progresso do worker implementados localmente; série publicada pendente.
- [x] T04 Consultas do Gestor por necessidade da aba, verificadas localmente.
- [x] T05 Pacote completo de avanço otimizado com paridade, verificado localmente.
- [ ] T06 Implementação local: projeção de avanço elimina leituras alheias ao histórico; aceite multicliente/HTTP pendente.
- [ ] T07 Parcial: fontes mensais/globais compartilhadas; meta da primeira carga em processo novo e aceite HTTP pendentes.
- [ ] T08 Seções/modais e painéis do Gestor adiados localmente; aceite publicado pendente.
- [ ] T09 Imagens otimizadas e CSS exclusivo da administração extraído; aceite LCP publicado pendente.
- [ ] T10 Sondagens vazias agregadas e retenção opt-in validada localmente; política e aplicação pendentes.
- [x] T11 Gates de tamanho, paridade, consultas, navegador e padrões de novos módulos integrados ao CI, verificados localmente.
- [ ] T12 Comparação em produção, 24 h e sete dias, e aceite registrado.

## Entregas locais e próximos incrementos

| Tarefa | Entrega nesta rodada | Trabalho restante |
| --- | --- | --- |
| T01 | Coleta HTTP opt-in e marcas de conteúdo útil no Gestor, cards, resumo do detalhe e oito seções do Efetivo; cache e refresh separados, com buffers/relatórios limitados | Janela completa de HTTP/conteúdo útil após publicação |
| T03 | Healthchecks locais do Nginx e de progresso do worker, incluindo filas de aprovação/e-mail/Data Book | Publicação manual e série de 24 h/sete dias |
| T04 | Bootstrap projetado por seção, cache separado por seção e usuário, consultas condicionais, tratamento de carga/falha no upload manual e compatibilidade do contrato anterior | Aceite HTTP em ambiente publicado |
| T05 | Associação das medições e preparo do escopo reutilizados dentro de cada cálculo; curvas não montam grupos de exibição descartados; resultado completo comparado com o anterior | Aceite HTTP em ambiente publicado |
| T06 | Avanço atual a cada 15 s; histórico/recortes por revisão; projeção exclusiva de avanço evita repetir custos, ponto, equipe e equipamentos; fonte comercial em lote nos grupos | Concorrência autenticada e p95 no ambiente publicado |
| T07 | Conferência mensal compartilha fontes; cálculo global reutiliza projetos/RDOs, lê custos anuais em lote e evita consultar alocações de planejamento no contexto realizado, sem novo cache entre requisições | Atingir a meta da primeira carga em processo novo, verificar planos SQL conforme medição e validar HTTP |
| T08 | Seções do Efetivo/Acompanhamento, cinco modais de workflow e painéis do Gestor sob demanda; visão geral estatística separada dos overlays | Aceite das superfícies autenticadas no ambiente publicado |
| T09 | Variantes lossless, favicon/hash/prioridade do login e CSS da administração de credenciais separado do shell, preservando a camada legacy | Aceite LCP publicado; outros estilos globais podem ser divididos conforme medição |
| T10 | Uma linha por janela de 15 min para sondagens vazias de finalização/quarentena; trabalho e falhas individuais; preview/retenção em lotes sem prazo padrão | Aprovar prazo/política antes de aplicação manual; medir linhas/dia publicado |
| T11 | Orçamentos, paridade, projeções HTTP/PostgreSQL e cenários de navegador no CI; padrões de carga/cache/atualização em PADRAO_MODULO.md | Execução dos gates no PR após envio; validação publicada permanece em T12 |

Os aceites publicados, a política/aplicação de retenção e o restante da meta fria de T07 permanecem pendentes. As regras de apropriação
de custos foram preservadas. Não houve exclusão de histórico, alteração de backup
ou execução em servidores nesta implementação local.

### Comparação reproduzida localmente

A referência foi o commit `3db7e76f`, com as mesmas dependências. O cenário denso
tem 297 linhas de escopo, 133 serviços, 63 datas e 11 recortes. Após um aquecimento,
cinco pares de execuções tiveram mediana de **347,5 ms antes e 85,7 ms depois**:
redução de **75,3%**, com igualdade do objeto completo em todas as comparações.
O teste guarda também o SHA256 do resultado anterior desse cenário sintético.

| Entrada e dependências estáticas, gzip | Antes | Depois | Redução |
| --- | ---: | ---: | ---: |
| Efetivo, incluindo a seção Visão geral | 552.299 B | 294.229 B | 46,7% |
| Acompanhamento, incluindo o Dashboard | 482.235 B | 284.253 B | 41,1% |

Esses tamanhos incluem o shell, JS e CSS; excluem imagens, fontes e dados da API.
O shell continua em aproximadamente 206 KB e o Gestor em 450 KB nesse critério.
O ganho do Gestor nesta etapa está nas consultas e payloads por aba.

O logo do login passou de 92.170 B para 23.826 B, o símbolo de 85.430 B para
13.880 B e o favicon tem 3.680 B. Os originais usados nos documentos foram preservados.
No preview local com o perfil móvel da auditoria, cinco navegações tiveram LCP
entre 2.060 e 2.140 ms, mediana de 2.108 ms. Isso não comprova o p95 ou o LCP em
produção, cuja rede e carga são diferentes. Ver
[evidências locais](evidence/performance-local-20261109.json).

### Continuação local: conferência mensal e modais de workflow

A conferência mensal compartilha trilhas do ponto, RDOs, alocações, ajustes,
ausências, calendário, semanas salvas, colaboradores, projetos e responsáveis.
Os filtros de vínculo, dados dos sete dias vizinhos, feriados e projetos
referenciados continuam sendo aplicados a cada semana. As leituras não são
paralelizadas por semana e nenhuma fonte fica em cache entre requisições.

Na fixture de seis semanas, as chamadas às fontes/cadastros passaram de **55 para
10** (81,8% a menos). São chamadas às dependências do read-model, não uma contagem
de SQL: algumas dependências executam várias consultas. A resposta completa foi
idêntica à anterior em meses de quatro, cinco e seis semanas, incluindo virada de
ano, admissões, desligamentos, feriados e viagens. Uma comparação adicional contra
PostgreSQL 16 local descartável, com todas as migrations, confirmou paridade exata.
O teste também verifica que um RDO novo aparece na requisição seguinte.

Nos builds pareados que diferem apenas pelo carregamento dos modais, a seção
**Evolução** passou de **528.134 B para 307.261 B gzip** com JS, CSS e dependências
estáticas: redução de **41,8%**. O build do workspace mede 307.015 B pelo mesmo
critério. O orçamento de 320 KB e a garantia de que os cinco modais ficam fora da
carga inicial agora são verificados pelo gate já ligado ao CI.

A validação desta continuação teve **2.740 testes de backend aprovados, 37
ignorados por configuração e nenhuma falha**, **889 de frontend aprovados**,
cinco cenários de encerramento/pesquisa no navegador e uma navegação móvel que
confirmou zero carregamento antecipado dos modais, abertura, fechamento,
reabertura e Escape sem erros de página. Build, lint e arquitetura passaram.
Os testes de navegador usaram API simulada; as medidas continuam locais.

As leituras alheias ao avanço foram removidas no incremento seguinte de T06.
Os próximos incrementos são aprofundar a partida fria dos custos (restante de T07),
dividir os painéis do Gestor e reduzir o CSS do shell (T08/T09). T01 e T11 ainda precisam das
marcas de conteúdo útil e das asserções de requisições por aba no CI. Uma versão
para o detalhe precisa cobrir todas as fontes e mudanças feitas pelo worker;
`Project.updatedAt` isolado continua insuficiente. T02 segue adiada pelo usuário.

### Continuação local: atualização do detalhe por revisão das fontes

As rotas de detalhe individual e de agrupamento aceitam agora `progress=current`,
`history` e `full`, validados com Zod. A ausência do parâmetro conserva a resposta
completa anterior. O resumo usa `current` a cada 15 s: calcula o avanço sem montar
curvas ou recortes. A linha de metas semanais recebe `history`, com suas curvas e
sem recortes. `full` só é necessário ao abrir o avanço, o avanço diário ou manter
um filtro que também altera o indicador do resumo. Agrupamentos deixam de montar
os recortes individuais que sua resposta consolidada não usa.

A revisão deriva das fontes lidas no banco, com correções nativas/históricas,
escopo, identificações dos sistemas, histórico manual e datas relevantes. Mudanças
da mão de obra ou de campos do projeto que não alteram o avanço medido não
reconstroem o histórico. O avanço manual conserva a data que ancora seus pontos.
O grupo inclui seus membros e pesos. Não foi criado cache derivado no backend;
escritas de outro processo são percebidas pela próxima leitura das fontes.

O frontend guarda histórico/recortes por revisão. Invalidações amplas de custos e
notas preservam uma revisão concluída; primeiras leituras canceladas ainda podem
reiniciar. Revisões inativas são removidas após 60 s. Se uma gravação terminar
entre o resumo e o histórico, a interface confirma o resumo novamente e só usa
histórico da mesma revisão. Há carregamento explícito, erro e nova tentativa;
um recorte selecionado continua correto com o painel fechado. A aba oculta não
executa polling. Respostas antigas e cópias congeladas continuam utilizáveis.

Na fixture densa, cinco pares aquecidos tiveram medianas de **78,3 ms no completo,
12,5 ms no histórico sem recortes e 2,4 ms no avanço atual**, com paridade exata.
Essas são medidas de cálculo local, não p95 HTTP. No navegador, dois ciclos sem
alteração produziram três leituras do resumo, uma do histórico e nenhuma dos
recortes. O roteiro também verificou agrupamento, revisão nova, aba oculta,
falha/nova tentativa, gravação concorrente, filtro mantido e contrato antigo.

O teste HTTP com PostgreSQL local cobre projeto, divisão, grupo, permissões
financeiras e escrita direta na medição sem tocar em `Project.updatedAt`. Ele foi
adicionado ao job PostgreSQL existente no CI. Duas regressões do frontend cobrem
invalidação ampla e cancelamento da primeira leitura.

Validação: **891 testes de frontend aprovados**; conjunto de **2.746 testes de
backend aprovado e 34 ignorados**. Na suíte ampla houve `ECONNRESET` em um caso de
simulação de escrita HTTP e seu teste pai; os 15 testes desse arquivo passaram na
reexecução isolada. Após a revisão, os cinco testes de fontes/projeções HTTP e os
34 de atualização/cache passaram novamente. Build, lint, arquitetura e orçamentos
passaram. A infraestrutura de teste foi local e descartável.

A abertura inicial faz duas leituras: resumo e histórico necessário às metas.
A repetição dos outros dados na segunda leitura foi resolvida pelo incremento
abaixo. O aceite autenticado com clientes concorrentes e a comparação HTTP
publicada continuam pendentes.

### Continuação local: projeção exclusiva de avanço e fontes globais de custos

A interface solicita agora `fields=progress` nas leituras adicionais de histórico
e recortes. O backend usa o mesmo construtor de avanço, ritmo e revisão do detalhe
completo, mas retorna somente esses campos e evita recarregar compras, ponto,
equipe, plano de horas e equipamentos. O metadado comercial já obtido pelo resumo
é compartilhado pelo cache existente. Nos grupos, esse metadado é lido em lote
para todas as missões. O teste de duas missões confirmou uma única leitura de
propostas para resumo mais histórico.

O contrato completo continua como padrão, e os testes HTTP verificam paridade de
revisão/valores em projeto, divisão e grupo, incluindo usuário sem permissão
financeira. No cenário pequeno do teste, o histórico individual passou de 5.519 B
para 1.932 B e o do grupo de 5.490 B para 1.092 B, em JSON sem compressão. Um gate
falha se a segunda leitura tentar consultar novamente as fontes de custos,
ponto ou equipe. O navegador foi repetido com respostas que omitem de fato os
campos alheios ao avanço, preservando filtros, retry, revisão e contrato antigo.

Em `computeCollaboratorRates`, a configuração do projeto passa a ser associada
aos relatórios a partir do catálogo já carregado para o período. A seleção dos
relatórios deixa de trazer essa configuração em cada registro. Os RDOs já lidos
também alimentam a elegibilidade anual offshore; a consulta anual complementar
mantém os outros tipos de relatório, inclusive sem horas ou fora do mês do ponto.
As evidências históricas para as janelas legadas foram preservadas. Não houve
alteração das fórmulas financeiras, da abrangência de permissões ou introdução
de cache de cálculo entre requisições.

A referência foi o commit `3db7e76f`, em PostgreSQL 16 local descartável, com as
mesmas dependências. A fixture tem 1.200 RDOs, um relatório técnico anual sem horas,
21 colaboradores com perfil de custo, uma importação mensal e 500 preferências
no projeto offshore. Todos os valores da folha, rateio e trilhas foram idênticos.

| Medição local do cálculo global | Antes | Depois | Redução |
| --- | ---: | ---: | ---: |
| Sem cache do cálculo, cinco pares após aquecimento | 195,9 ms | 62,8 ms | 67,9% |
| Processo Node novo, três pares | 476,4 ms | 332,7 ms | 30,2% |
| Processo novo após uma leitura de sessão, três pares | 371,0 ms | 212,2 ms | 42,8% |

São medianas do cálculo, com páginas do banco aquecidas; não são p95 HTTP nem
medições de produção. A terceira linha simula a leitura que precede o cálculo
numa requisição autenticada, sem executar autenticação HTTP. A representação JSON
dos resultados das consultas, incluindo o catálogo compartilhado, passou de
29.107.545 B para 333.357 B (98,9%); esse número não é uma captura de tráfego SQL.
A meta de reduzir em pelo menos 50% a primeira carga em processo novo ainda não
foi atingida nessa fixture, por isso T07 continua parcial.

Validação desta etapa: suíte completa com **2.750 testes de backend aprovados,
34 ignorados e nenhuma falha**, **891 de frontend aprovados**, e 33 verificações
direcionadas após a revisão, incluindo pesos manuais do grupo, projeção HTTP e
fontes de custos. Build, lint, arquitetura e orçamentos passaram. O PostgreSQL e
o navegador de teste foram locais e descartáveis. Ver os dados completos em
[evidências locais](evidence/performance-local-20261109.json).

Continuam pendentes a medição publicada e concorrente, a meta de partida fria,
os painéis do Gestor, o CSS do shell, as marcas de conteúdo útil e os gates de
navegador ainda não integrados. A estratégia de jobs requer a política de
histórico/retenção prevista em T10. Backups seguem adiados pelo usuário; não houve
publicação nem manutenção em produção/staging.

### Continuação local: carregamento do Gestor, observação e crescimento dos jobs

Os painéis de estatísticas, NPS, cargos, DDS, edição de projeto e histórico de cargo,
upload antigo, assinatura física e reemissão agora têm fronteiras próprias de
carregamento. A visão geral de estatísticas não importa os overlays detalhados.
Os serviços históricos só são montados na primeira abertura de sua aba e conservam
o formulário ao alternar com PDFs; o envio em lote também adia seu diálogo.
Os fallbacks dos diálogos permitem fechar/Escape enquanto o módulo é baixado.
Os visualizadores PDF já utilizavam imports dinâmicos nos fluxos revisados.

A carga estática do Gestor passou de **450.845 B para 406.097 B gzip** (9,9% a
menos), contando shell, JS, CSS e dependências. Estatísticas soma 414.390 B sem
baixar os overlays. Ambos têm orçamentos e exclusões verificadas no CI. Os
16.197 B de CSS fonte exclusivos de credenciais saíram do shell e acompanham sua
rota na camada `legacy`. O shell total mede 205.323 B gzip; a instrumentação também
entra nessa conta. Outros blocos do CSS global permanecem candidatos a divisão
conforme as próximas medições; não se atribui todo o ganho do bundle ao CSS.

A coleta de conteúdo útil é opt-in por sessão, tem janela de 15 minutos e buffer
de 200 amostras. Registra apenas rótulo fixo, fase, origem cache/rede, atualização
em andamento e duração. Não envia dados automaticamente. Duas oportunidades de
frame separam commit e registro; conteúdo oculto não é marcado como visível.
Navegações novas são registradas mesmo quando reutilizam a mesma consulta/cache.
A atualização observada pelo componente é uma fase diferente do primeiro conteúdo;
estas durações não substituem o tempo HTTP. O relatório não publica percentis com
menos de cem amostras por cenário nem quando houve truncamento do buffer.

O Nginx ganhou `/nginx-health`, verificado por HTTP em container local sem rede
nem portas publicadas. O worker grava um snapshot atômico local a cada 15 s, com
inícios/fins de jobs e scans das filas de aprovação, e-mail e Data Book. O comando
`node scripts/check-worker-health.js` verifica o PID, a idade do snapshot (45 s),
a ausência de progresso (120 s, após o grace inicial) e rotinas além do prazo
configurado mais 45 s. Uma rotina pode terminar com erro e ainda demonstrar que o
processo progrediu; falhas de negócio continuam no status operacional. Os
healthchecks foram adicionados apenas aos arquivos locais do Compose de produção.

Sondagens vazias de finalização/quarentena verificam retries e recuperação usando
os mesmos predicados dos processadores, sob o lock existente. Elas atualizam um
registro por janela de 15 min/processo, com contagem e início/fim da janela. O
`startedAt` da linha representa a verificação mais recente, preservando a consulta
indexada do status. Trabalho real mantém o registro RUNNING antes da execução;
falhas e disputas de lock mantêm registros individuais. Nenhuma linha histórica
foi removida. Com verificações a cada minuto e sem trabalho, isso representa até
96 linhas/dia por família/processo, em vez de 1.440, fora reinícios e disputas.

A retenção de JobRun não tem prazo padrão e não entra na execução agendada sem
parâmetro. O preview e a aplicação explícita reutilizam lotes/transações do serviço
existente; preservam todos os FAILED, RUNNING e o último COMPLETED por nome,
inclusive empates. O teste PostgreSQL isolado valida o preview, a ausência de
exclusões por padrão, os lotes e as exceções, além dos predicados de recuperação.
A escolha do prazo/política e qualquer aplicação em ambiente publicado permanecem
pendentes. O teste apagou somente suas próprias fixtures no banco descartável.

O cálculo de custos também passou a obter as três configurações anuais em uma
leitura e não consulta alocações que o contexto ACTUAL_REPORT não utiliza. Ausências,
feriados, revisão do calendário, regras financeiras e planejamento foram preservados.
Cinco comparações pareadas, isoladas das suítes, em PostgreSQL local com uma CPU,
1.201 relatórios e 21 colaboradores deram estas medianas:

| Cálculo sem cache | Antes do plano (3db7e76f) | Commit acd2a2ba | Atual |
| --- | ---: | ---: | ---: |
| Após aquecimento | 216,1 ms | 71,8 ms | 64,3 ms |
| Processo Node/Prisma novo | 493,9 ms | 344,8 ms | 314,3 ms |
| Processo novo após uma leitura de sessão | 367,6 ms | 248,4 ms | 218,6 ms |

Houve paridade exata dos objetos completos. São cálculos locais com páginas do
banco aquecidas, não autenticação HTTP nem produção. A redução fria acumulada é
**36,4%**; o ganho incremental desta rodada é **8,9%**. A meta de 50% continua
pendente. Não foram criados novos índices, caches derivados nem aumentado o pool.
As amostras constam nas [evidências locais](evidence/performance-local-20261109.json).

Validação final desta continuação: **2.755 testes de backend aprovados, 38
ignorados e nenhuma falha**, **895 de frontend aprovados**, oito cenários de
navegador (sete na execução completa e o upload histórico na direcionada) e 15
verificações de jobs/health/status/PostgreSQL após a revisão. Build, lint,
arquitetura e os seis orçamentos passaram. O CI incorpora esses cenários e os
padrões de novos módulos foram atualizados. A infraestrutura descartável foi
local; não houve publicação, limpeza de histórico existente ou mudança de backups.

### Uso local das ferramentas de medição

A coleta detalhada fica desativada por padrão. Para uma sessão local de 15 minutos,
usar no ambiente do backend `HTTP_PERFORMANCE_ENABLED=true`,
`HTTP_PERFORMANCE_WINDOW_MS=900000` e `HTTP_PERFORMANCE_SAMPLE_MS=100`. O prazo é
contado desde a criação do middleware. Leituras rápidas, 304 e erros também são
registrados; o logger lento anterior continua disponível.

Os eventos `[HTTP PERFORMANCE]` são JSON em uma linha. Para analisar um arquivo já
capturado, a partir da raiz do repositório:

```bash
node backend/scripts/report-performance.js < /tmp/http-performance.log
npm --prefix frontend run build
npm --prefix frontend run performance:check
```

O relatório separa método, rota, status e respostas interrompidas. Não publica p95
quando o limite de amostras é excedido e sinaliza quando há menos de 100 amostras.
As etapas podem se sobrepor em operações concorrentes; sua soma não é a duração
HTTP. Rotas sem correspondência e segmentos de montagem desconhecidos são
anonimizados, sem registrar URL bruta, parâmetros, corpos ou credenciais.

Para observar conteúdo útil, habilitar na sessão do navegador e recarregar:

```js
sessionStorage.setItem('filtro:page-performance', 'true');
location.reload();
// Depois de navegar nos cenários escolhidos:
filtroPagePerformance.read();
filtroPagePerformance.report();
// Encerrar a coleta e limpar as amostras:
sessionStorage.removeItem('filtro:page-performance');
filtroPagePerformance.clear();
```

Para a prévia de JobRun, o operador deve fornecer o prazo aprovado como
`--job-run-retention-days=<dias>` ao script de retenção existente, que permanece
em dry-run sem `--apply`. Sem esse parâmetro, JobRun não participa da rotina.
O preview também mostra os outros alvos já existentes do serviço; a aplicação não
é uma rotina exclusiva de jobs. Nenhum prazo nem aplicação foi definido nesta rodada.

Na publicação manual, atualizar backend/worker e Nginx a partir da mesma revisão;
os comandos de healthcheck dependem do script e da localização HTTP novos. Em
rollback para imagens anteriores, restaurar também a definição anterior do Compose,
pois a imagem antiga do worker não contém `scripts/check-worker-health.js`.
Não há migration nova nesta continuação. A comparação publicada ainda deve separar
primeira carga, cache aquecido, laboratório e HTTP, mantendo T02 (backups) adiada.
