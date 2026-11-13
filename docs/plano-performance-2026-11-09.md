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
aplicação. A implementação continua local; medições posteriores em produção e
staging foram autorizadas separadamente e estão registradas nas evidências.
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

- [ ] T01 Coleta HTTP e conteúdo útil implementados; p95 observacional de 500 leituras em staging coletado; concorrência/outros perfis e janela de produção pendentes.
- [ ] T02 Adiada pelo usuário: estratégia de backup e recuperação.
- [ ] T03 Healthchecks de Nginx/progresso do worker implementados localmente; série publicada pendente.
- [x] T04 Consultas do Gestor por necessidade da aba, verificadas localmente.
- [x] T05 Pacote completo de avanço otimizado com paridade, verificado localmente.
- [ ] T06 Implementação local: projeções, grupos em lote, cards verificados, catálogos entre leituras verificadas, snapshot mensal e revisão estável; pool aquecido aprovado localmente, meta global com frio/refresh e aceite publicado pendentes.
- [ ] T07 Parcial: fontes compartilhadas, catálogos em lote, intervalos por período, calendário antecipado e conciliação sem motor de custos; meta fria geral e aceite HTTP pendentes.
- [ ] T08 Seções/modais e painéis do Gestor carregados sob demanda localmente; aceite publicado pendente.
- [ ] T09 Imagens otimizadas e CSS exclusivo da administração extraído; login de staging atingiu LCP mediano de 2.044 ms no perfil emulado; aceite em produção pendente.
- [ ] T10 Sondagens vazias agregadas e retenção exclusiva de JobRun com preview/lotes validadas localmente; política de 90 dias aprovada em 11/11; aplicação manual e medição publicadas pendentes.
- [x] T11 Gates de tamanho, paridade, consultas, navegador e padrões de novos módulos integrados ao CI, verificados localmente.
- [ ] T12 Comparação em produção, 24 h e sete dias, e aceite registrado.

### Atualização de homologação — 12/11/2026

Após a correção de admissão do snapshot mensal (`3c2b887e`), uma comparação
autorizada usou a mesma imagem de staging em um HTTP temporário: jobs desativados
nesse processo, pool oito, 1,5 CPU e 2 GiB. O backend original e seus jobs
continuaram ativos. As configurações persistentes não foram modificadas.

Base e cache somente de respostas tiveram cem leituras aquecidas por rota,
concorrência dois e limite de duas requisições por segundo. O p95 do cliente
HTTP interno foi de 2.201,5 → 1.173,5 ms em cards, 2.536,1 → 851,6 ms no detalhe,
351,6 → 103,8 ms no grupo e 3.329,9 → 1.964,6 ms no resumo do ponto. Houve 350
hits em 400 leituras na fase de respostas. O CPU steal mediano também caiu entre
as fases, de 18,0% para 11,0%; não se atribui todo o ganho ao cache.

A fase mensal foi interrompida em 366 leituras por CPU steal sustentado acima
de 50%, com pico de 74,3%. Seu p95 de aceite permanece indisponível. Foram
observadas 16 recusas de snapshot antes do codec, sem encode/decode mensal.
As 1.166 respostas medidas foram 200 e mantiveram o mesmo JSON canônico por rota.
Isso cobre somente o administrador dedicado e os mesmos projeto/grupo, sem
gravações de negócio ou teste de invalidação entre sessões nessa rodada.

Um perfil separado de um resumo do ponto após expiração do cache atribuiu 27,3%
das amostras próprias a `addDate`/`classifyActualWorkforceDays`, que recriam datas
ao percorrer o intervalo completo de cada colaborador. A próxima implementação
local deve reutilizar a preparação de calendário por cálculo e comprovar paridade
das listas de dias, conflitos e valores financeiros, inclusive em históricos longos.

Permanecem pendentes: investigar a capacidade da VPS/CPU steal; repetir a comparação
mensal em condições estáveis; cobrir outros perfis, recortes, frio e pós-gravação;
validar navegador/LCP e observar produção por 24 h/sete dias. As metas aquecidas
observadas nesse administrador e a fração sem fila no trecho medido não encerram
T01/T06/T07/T12. A retenção continua manual e backups seguem adiados.
Ver [evidência completa](evidence/performance-staging-controlled-20261112.json) e
[condições operacionais](PERFORMANCE_OPERACAO.md).

### Continuação local de T06/T07 e diagnóstico de T12 — 12/11

A preparação do calendário de dias realizados agora é reutilizada uma vez por
cálculo mensal, mantendo jornadas/conflitos e resultados próprios de cada
colaborador. A preparação é adiada para evitar trabalho em listas vazias. Não há
compartilhamento entre requisições nem corte de dados. A etapa numérica
`labor.workforce.days` permite acompanhar esse trecho após a publicação.

Em cinco pares sintéticos alternados, Node 22.23.2 com 1,5 CPU/2 GiB, a
classificação de 200 colaboradores no intervalo 2010–2026 caiu de 1.662,60 para
76,44 ms; o cálculo mensal completo da fixture de 21 colaboradores caiu de
201,62 para 98,40 ms (51,2%). Os resultados financeiros completos foram iguais.
Esses tempos excluem boot/aquecimento/serialização e não são p95 HTTP nem ganho
percentual do app. As 24 comparações HTTP com a fonte anterior cobriram dois
perfis, quatro rotas e três estados, incluindo alterações de ponto, ausência e
calendário com a candidata ativa. Passaram 2.923 testes de backend (54 ignorados),
o grupo adicional de 21 verificações com PostgreSQL/HTTP, 23 testes focados em
Node 22 e arquitetura. Ver [evidência](evidence/performance-workforce-calendar-20261112.json).

Na VPS, a investigação somente leitura identificou quatro vCPUs e 43 containers.
Em duas janelas curtas sem carga sintética, o CPU steal mediano ficou em
9,68%/16,33%, com picos acima de 51%; a segunda manteve steal alto com a API quase
ociosa e sem throttling próprio. Na primeira janela, a API atingiu sua cota de
1,5 CPU em 40/144 períodos ativos. As duas restrições são distintas; não se
atribui toda a lentidão ao cálculo nem a um serviço vizinho específico. As
[evidências de capacidade](evidence/performance-vps-capacity-20261112.json) e o
texto para verificação pelo provedor estão no roteiro operacional.

Restam publicar/testar esta correção em staging; comparar o cache de respostas
com demais perfis/recortes e navegador; investigar a disponibilidade de CPU com
o provedor e completar a observação de 24 h/sete dias. A camada mensal segue
sem aceite de latência. Não houve mudança de código/configuração em servidor,
aplicação de retenção ou alteração de backups nesta continuação.

### Reteste de staging após `46092546` — 12/11

A publicação foi confirmada pelo código em execução. Passaram a paridade das
280 leituras medidas, as quatro rotas nas três configurações e a navegação HTTPS
do administrador em projetos e custo/hora. Os acessos sem sessão foram bloqueados.
As coortes a duas/uma requisição por segundo pararam em 18/250 leituras por CPU
steal sustentado, com pico de 78,99%; nenhuma rota/configuração atingiu cem
amostras. O p95 de aceite continua indisponível.

O login emulado móvel teve LCP mediano de 5.192 ms em cinco navegações. Staging
entregava JS/CSS sem gzip ou política de cache, diferentemente de produção. A
configuração de staging foi corrigida localmente e validada em HTTP com Nginx
isolado, incluindo integridade do conteúdo e cache de HTML/SPA/assets. Esse ajuste
precisa ser publicado para repetir o LCP. A disponibilidade de CPU, os outros
perfis, a invalidação por gravação e a observação de 24 h/sete dias continuam
pendentes. Nenhuma configuração publicada, backup ou retenção foi alterada pelos
testes. Ver [evidência](evidence/performance-staging-calendar-validation-20261112.json)
e [procedimento de atualização do Nginx](PERFORMANCE_OPERACAO.md).

O operador publicou `fd05b29d` e recriou o Nginx. No reteste com o mesmo Chromium,
script e perfil móvel, o login observou LCP mediano de **2.044 ms**, ante 5.192 ms,
em cinco navegações sem cache do navegador. Gzip e políticas de cache foram
conferidos nos headers; os recursos transferidos caíram de 930.886 para 313.566 B,
sem erros observados. A meta de 2.500 ms foi atingida **em staging**. O CPU steal
mediano de 16,39% no host ainda impede encerrar a meta de infraestrutura; p95 das
APIs, demais perfis e observação/aceite de produção permanecem pendentes.
Ver [evidência da entrega estática](evidence/performance-staging-static-delivery-20261112.json).

### Avaliação pendente de CPU/APIs concluída — 12/11

Foram coletadas **500 respostas 200**, sem descarte, com cem amostras por caso no
HTTPS público de staging: cards, projeto do grupo, grupo, resumo do ponto e o
projeto de referência 5719. A carga foi de 0,5 requisição/s, concorrência um,
administrador e conexões HTTP/1.1 novas. O p95 foi **2.225,98 ms em cards**,
**773,63 ms no projeto selecionado**, **1.556,20 ms no projeto 5719**,
**481,82 ms no grupo** e **3.532,74 ms no ponto**. Assim, cards e o projeto de
referência ficaram acima das metas nessa coorte; a diferença de 56 ms no 5719
deve considerar o protocolo de conexão e a variação do host. Não há aceite global
de concorrência/perfis ou de produção a partir desse ensaio leve.

O steal mediano durante as quatro rotas foi 22,60%, chegando a 79,15%. Mesmo sem
carga sintética de API e com a compactação inicialmente observada já ausente, a
janela posterior manteve mediana de 17,90%. A disponibilidade de CPU permanece
pendente com o provedor. O staging usa API sem limites de CPU/RAM e jobs no mesmo
processo, enquanto produção usa 1,5 CPU/2 GiB e worker separado. O cgroup de staging
atingiu 2,20 GiB no ensaio; a paridade operacional deve preceder o aceite de memória.

Os próximos passos são verificar vCPU com o provedor; alinhar staging/worker e
orçamentos sem alterar backups; comparar somente cache de respostas com protocolo
e carga equivalentes; com CPU estável, perfilar os misses de cards/ponto. Outros
perfis, concorrência, pós-gravação e observação de 24 h/sete dias continuam em T12.
Os acumulados SQL de backup foram separados das consultas de navegação e nenhuma
configuração ou dado de negócio foi alterado. Ver [evidência](evidence/performance-api-capacity-assessment-20261112.json)
e [roteiro operacional](PERFORMANCE_OPERACAO.md).

### Paridade operacional preparada localmente — 12/11

Com o plano KVM 4 confirmado pelo usuário, o roteiro operacional passou a incluir
as perguntas e os horários UTC/Brasília para a Hostinger verificar créditos,
restrições efetivas e disponibilidade de CPU no nó. A documentação oficial tem
percentuais divergentes; o estado da VPS deve ser confirmado pelo suporte/hPanel.
Nenhuma mensagem foi enviada ao provedor.

O Compose de staging agora define os mesmos orçamentos, pools, parâmetros de
PostgreSQL e healthchecks de produção. O worker foi separado, com pool dois,
0,75 CPU/1,5 GiB; a API usa pool oito, 1,5 CPU/2 GiB e jobs internos desligados.
A sincronização de staging para também o worker antes da restauração, builda
sua imagem e só reinicia os serviços após migrations e sanitização. Foram
validados os caminhos de sucesso, ambiente parado e falhas na parada, restore,
migration e sanitização. Os 33 testes focados, a validação do Compose/Bash e o
ensaio Docker do proxy passaram. Publicação e reavaliação da memória/latência
permanecem manuais; nenhuma configuração publicada foi alterada nesta etapa.

Também foi concluída uma comparação em APIs temporárias, mesmas fontes, pool oito,
1,5 CPU/2 GiB e jobs desligados: **800 respostas 200**, cem por rota/modo, com
paridade integral dos quatro JSONs. Somente respostas teve 353 hits/47 misses,
p95 de cards **1.672,71 → 1.023,92 ms**, projeto **1.385,80 → 522,49 ms**, grupo
**167,51 → 122,10 ms** e ponto **2.214,31 → 1.523,58 ms**. A memória amostrada
ficou abaixo de 1 GiB nos dois modos, sem OOM. A rede foi HTTP Docker, sem
TLS/Nginx/browser; os limites do banco de staging ainda não foram aplicados.
Steal mediano de 11,50%/15,03% e ordem fixa impedem uma atribuição causal completa.
Um miss adicional do ponto após expiração levou 4.230,61 ms e o perfil apontou GC
e trabalho no cálculo mensal; uma nova otimização exige repetição sob CPU estável.
T12 permanece aberto para a topologia publicada, concorrência, outros perfis,
pós-gravação e produção. Ver [evidência](evidence/performance-staging-response-comparison-20261112.json).

## Entregas locais e próximos incrementos

### Topologia validada em staging e contador corrigido localmente — 12/11

O usuário publicou `345f4892` e relatou navegação normal. A avaliação confirmou
API, worker, PostgreSQL e Nginx saudáveis, limites/pools corretos, progresso do
worker, estatísticas SQL disponíveis e ausência de reinícios/OOM. Foram **600
respostas 200 no HTTPS público**, cem por caso, carga sequencial de até uma
requisição/s, com cache novo desligado e caches legados de 60 s. O p95 foi
1.818,64 ms em cards, 621,30 ms no projeto selecionado, 401,40 ms no grupo,
510,32 ms no dashboard, 2.065,25 ms no contador e 4.042,21 ms no ponto. Cards e
detalhe atingiram as metas nesta coorte leve; isso não encerra o aceite global.

Os logs da entrada inicial ainda mostraram dashboard/contador em 6,56/6,60 s,
com uma amostra por caso. O contador carregava o conjunto completo de pendências
da integração para usar apenas o total de colaboradores. A correção local agora
consulta somente históricos bem-sucedidos, vínculos e ignorados, preservando
histórico, deduplicação, permissões e os demais campos do contrato. Cinco pares
somente leitura no staging mantiveram o mesmo resultado, reduzindo esse trecho
de 22 para três consultas e de mediana 1.236,95 para 27,62 ms; não é uma medição
do endpoint inteiro. A correção ainda não foi publicada.

Passaram **2.934 testes de backend** (54 ignorados) e os três do gate
PostgreSQL/HTTP, incluindo paridade e atualização do contador. O pico da API na
coorte foi 0,60 GiB, sem OOM. O relatório acumulado teve 96,59% das observações
ativas sem fila, incluindo acessos fora da coorte. Steal mediano de 37,30% sem
carga sintética e 18,60% durante a coleta mantém a investigação com o provedor.
Permanecem em T12: publicação da correção e reteste da entrada/contador, comparação
de respostas isoladas na nova topologia, recálculo do ponto, concorrência,
outros perfis/divisões e séries de 24 h/sete dias. Backups/retenção inalterados.
Ver [evidência](evidence/performance-staging-postdeploy-345f4892-20261112.json).

### Correção do contador validada em staging — 12/11, `44d279a5`

A versão publicada e as fontes de API/worker foram conferidas. A repetição das
mesmas seis rotas produziu **600 respostas 200**, cem por caso, concorrência um,
até uma requisição/s e cache novo desligado. O contador conservou o mesmo JSON da
referência: mediana **999,21 → 138,67 ms**, p95 **2.065,25 → 288,81 ms**. A consulta
mensal da integração removida não teve novas chamadas durante a coorte. Cinco
pares dos métodos publicados, em transação somente leitura, mantiveram o resultado
com 22/três consultas. O aceite do contador está concluído nesse escopo.

O p95 foi 389,73 ms nos cards, 476,37 ms no dashboard, 995,07 ms no grupo,
**1.539,20 ms no projeto** e **2.894,67 ms no ponto**. O detalhe ficou ligeiramente
acima de 1,5 s; seus piores eventos gastaram 1.519–3.315 ms na fonte de mão de obra,
sem fila observada nesses pedidos. O recálculo mensal/cache legado de 60 s continua
como alvo, sem evidência para ampliar o pool. Steal mediano de 12,36% e pico de
77,94% mantêm a investigação de infraestrutura; diferenças de latência entre
janelas não são atribuídas integralmente à correção.

Os quatro serviços ficaram saudáveis, sem reinícios/OOM ou erros observados,
com pico da API de 0,61 GiB e 98,34% de 781 observações ativas sem fila. Nenhum
flag, fonte publicada, serviço, backup ou retenção foi alterado no reteste. A
próxima etapa de T12 é comparar respostas isoladas na topologia atual; permanecem
os recálculos, concorrência/perfis/divisões e as séries de produção de 24 h/sete
dias. O corpo do dashboard diferiu entre janelas, com fontes verificadas e
inalteradas; não se afirma paridade integral das seis rotas a partir dos hashes.
Ver [evidência do reteste](evidence/performance-staging-pendency-validation-44d279a5-20261112.json).

### Respostas isoladas comparadas e Redis avaliado — 12/11, `44d279a5`

A comparação ABBA na imagem publicada concluiu **1.200 respostas 200**, cem por
rota/modo, com concorrência máxima dois. Somente master/respostas foram habilitados
nas APIs descartáveis; mensal/referências/avanço ficaram desligados. Os corpos
completos das seis rotas coincidiram entre os modos durante a janela testada.

O p95 do projeto caiu de **1.381,46 para 320,94 ms**, grupo de **735,03 para
229,84 ms** e ponto de **4.844,40 para 2.508,71 ms**. Nos cards, o p95 subiu de
405,02 para 499,33 ms, embora a mediana tenha melhorado. A CPU da API temporária
passou de **277,78 para 74,78 s** por 600 leituras; o steal e a carga da VPS
variaram. O transporte HTTP privado não inclui TLS/Nginx/navegador e não deve
ser comparado em valores absolutos ao reteste HTTPS anterior. Não há aceite frio
ou de escritas/outros perfis a partir dessa comparação.

O ensaio local de Redis teve **4.800 medições sintéticas** e foi mais lento que
a memória do processo no caminho de acerto com conversões equivalentes. A decisão
é **não adicionar Redis agora**: há um processo HTTP, e os misses/objetos grandes
continuam exigindo cálculo/codificação. Reconsiderar com réplicas HTTP ou reuso
entre processos comprovado. O estudo detalha custos, limites e condições do piloto.

O comparativo de respostas fica concluído nesse escopo de T12. Permanecem a
homologação HTTPS/interface de respostas isoladas, perfis/divisões/escritas,
recálculos de ponto/detalhe, capacidade da VPS e observações de 24 h/sete dias.
As APIs publicadas continuaram saudáveis e com todos os flags de cache novo
desligados. Não houve deploy, mudança de backup ou aplicação de retenção.
Ver [estudo e próximos incrementos](ESTUDO_REDIS_PERFORMANCE_2026-11-12.md),
[evidência ABBA](evidence/performance-staging-response-abba-44d279a5-20261112.json)
e [ensaio Redis](evidence/performance-redis-component-study-44d279a5-20261112.json).

### Continuação local após produção — 13/11, base `1b46fa52`

O usuário informou a publicação anterior em produção e aumentou o espaçamento
dos backups. Esta continuação permaneceu na worktree, atualizada com a main
remota por fast-forward; não acessou nem alterou produção, backup ou retenção.

As duas frentes de código do estudo de Redis receberam implementação local:
o caminho financeiro/resumo omite anotações de workforce que não utiliza quando
não pede snapshot mensal; a leitura completa e os snapshots compartilhados mantêm
essas anotações. O motor de custo, horas, folgas financeiras, meses, cargos,
rateios e trilhas permanece igual. O HTTP de respostas em cache também passa a
enviar o JSON imutável pronto, com fallback para opções próprias do Express.
As fontes do ponto ganharam ordem determinística por criação/ID, corrigindo
divergências de posição após UPDATE.

No histórico esparso sintético, o recálculo passou de **82,68 para 52,34 ms**
aquecido e de **342,78 para 269,04 ms** em novo processo. No mês isolado, o ganho
aquecido foi 7,91%. O cenário denso de 36 meses variou perto de zero e ficou
2,01% mais lento no novo processo; não há ganho geral comprovado para todo volume.
São cinco pares por modo, sem p95 de aceite. O experimento de reuso de trilhas
com regressão no aquecido foi retirado e está preservado na evidência.

O HTTP local concluiu **1.600 respostas 200**, cem por rota/perfil/versão, todas
hits, com igualdade dos campos após normalizar somente a ordem do roster do
resumo. O envio do DTO de ponto de 323.726 B passou de mediana 2,11–2,13 para
0,51 ms. Não inclui TLS/proxy/browser nem mede expiração. Passaram **3.004 testes
do backend** (53 ignorados) e **30 da bateria Node 22/PostgreSQL/HTTP/snapshots**,
sem falhas finais. Não há nova variável, migration ou Redis.

Permanecem o aceite de staging/produção, os recálculos fora desses cenários,
perfis/divisões/escritas, métricas reais de navegador e as séries de 24 h/sete dias.
Esta entrega não encerra os aceites publicados de T06/T07/T12. Ver
[implementação e limites](OTIMIZACOES_RECALCULO_JSON_2026-11-13.md) e
[evidência](evidence/performance-recalc-json-20261113.json).

**Complemento local de 13/11:** os leitores financeiros/resumo sem snapshot mensal
também omitem do SQL `CollaboratorAbsence`, `WorkforceHoliday` e
`WorkforceCalendarState`. Identidades, histórico de cargos e ignorados continuam
carregados nas duas consultas de pacotes; não se trata de duas viagens a menos
ao banco. O cache de referências agora separa as variantes completa/reduzida,
mantendo o padrão completo e o snapshot mensal compartilhado completos. A
comparação financeira com ausências e cargos reais da fixture PostgreSQL passou,
assim como **39 verificações Node 22/PostgreSQL/HTTP/caches**, sem ignorados ou
falhas. A bateria final do backend aprovou **3.009 testes** (53 ignorados), sem
falhas. Os planos SQL confirmam a remoção das três fontes na variante reduzida;
os números de latência da primeira rodada permanecem históricos e não representam
um benchmark desse complemento. Ver
[evidência das fontes condicionais](evidence/performance-workforce-source-projection-20261113.json).

| Tarefa | Entrega nesta rodada | Trabalho restante |
| --- | --- | --- |
| T01 | Coleta HTTP opt-in, marcas de conteúdo útil e benchmark HTTP local com sessões reais, concorrência e amostragem do pool; cache e refresh separados | Janela completa de HTTP/conteúdo útil após publicação |
| T03 | Healthchecks locais do Nginx e de progresso do worker, incluindo filas de aprovação/e-mail/Data Book | Publicação manual e série de 24 h/sete dias |
| T04 | Bootstrap projetado por seção, cache separado por seção e usuário, consultas condicionais, tratamento de carga/falha no upload manual e compatibilidade do contrato anterior | Aceite HTTP em ambiente publicado |
| T05 | Associação das medições e preparo do escopo reutilizados dentro de cada cálculo; curvas não montam grupos de exibição descartados; resultado completo comparado com o anterior | Aceite HTTP em ambiente publicado |
| T06 | Pipeline com tempos por etapa; fontes de horas previstas em lote; custo mensal antes dos metadados; cache verificado, projeções e atualização preservados. Meta local do pool atingida: **95,72–95,86%** incluindo frio/aquecimento/refresh; aquecido 100% | Concorrência/p95 e atualização no ambiente publicado, em T12 |
| T07 | Períodos, identidades e ausências selecionadas em lote; ajustes/conferências com IDs de projetos protegidos; referências e relatórios em etapas; datas reutilizadas por cálculo; missões vazias sem consultar alocações. Meta local fria atingida nas duas repetições: **50,81–51,49% esparso e 52,14–54,27% denso** | Validar latência publicada em T12; benchmark usa preparação física idêntica das fixtures |
| T08 | Seções do Efetivo/Acompanhamento, cinco modais de workflow e painéis do Gestor sob demanda; visão geral estatística separada dos overlays | Aceite das superfícies autenticadas no ambiente publicado |
| T09 | Variantes lossless, favicon/hash/prioridade do login e CSS da administração de credenciais separado do shell, preservando a camada legacy | Aceite LCP publicado; outros estilos globais podem ser divididos conforme medição |
| T10 | Política manual de 90 dias validada; volume e prévia coletados em produção, somente leitura: **358.456 linhas, 7.226 elegíveis**, às 22:00 UTC de 11/11; relatório e aplicação exclusiva com lotes/auditoria prontos | Aplicação manual do CLI atualizado após publicação; comparar crescimento posterior |
| T11 | Orçamentos, paridade, PostgreSQL/HTTP e navegador no CI; main `245ebd00` integrada sem conflito; contratos dos novos lotes no gate; limpeza física das fixtures antes de cada coorte; **11 jobs aprovados em `e5d8f37b`** | Aceite publicado em T12 |

As metas locais de T06/T07 estão atingidas nas coortes controladas. Os aceites
publicados e a aplicação manual da retenção de 90 dias permanecem pendentes. As regras de apropriação
de custos foram preservadas. Não houve exclusão de histórico, alteração de backup
ou execução em servidores nesta implementação local.

### Pendências após o fechamento local das metas — 11/11

1. **Publicação e aceite — T01/T03/T04/T05/T06/T08/T09/T12:** a leitura de produção
   encontrou a main `245ebd00`, Node 22.23.4, sem a migration de revisão nem os
   flags de coleta/cache configurados. O código desta branch ainda precisa ser
   publicado e a migration aplicada antes de habilitar o cache. Validar p95 HTTP,
   conteúdo útil/LCP, dois navegadores/perfis, divisões, atualização por worker em
   até 15 s e página oculta sem polling. O roteiro contém ativação e rollback.
2. **Operação — T03/T11/T12:** o [CI final de `e5d8f37b`](https://github.com/pedro-pn/filtroAPP/actions/runs/43111440702)
   aprovou os 11 jobs. Publicar pelo processo existente
   e comparar 24 h/sete dias de pool, event loop, CPU steal, memória/OOM, erros e
   progresso dos jobs. O CI anterior `8edae733` aprovou dez jobs, mas ficou preso
   na instalação do Hunspell antes dos testes de backend; foi substituído pela
   nova execução. Com limite de cinco minutos, a instalação passou e o novo CI
   terminou integralmente, sem retirar nenhum teste ou ampliar orçamento.
3. **Retenção — T10:** os **90 dias foram aprovados pelo usuário**. A coleta de
   11/11 às 22:00 UTC registrou **7.226 candidatos** e cerca de **5.176 linhas/dia**
   nos seis dias completos anteriores. Aplicar manualmente o CLI exclusivo da
   versão atualizada, após conferir novamente o preview; preservar falhas, em
   andamento, últimos sucessos e empates. A coleta foi somente leitura.

**T02 (backups) permanece adiada pelo usuário.** Não há pendência adicional de
código para as duas metas locais; os resultados não são aceite de produção.
A preparação física do benchmark foi corrigida após diagnosticar acúmulo de
páginas das fixtures excluídas. Todos os ensaios anteriores, inclusive os abaixo
da meta, estão preservados na [evidência final](evidence/performance-misses-closure-20261111.json).
As novas coortes usam `VACUUM ANALYZE` antes de semear o banco descartável vazio e
`ANALYZE` depois da carga, igualmente para ambas as versões. Não houve vacuum em
produção, mudança de pool, fila de admissão, índice novo ou alteração de regra.
Ver [operação e aceite](PERFORMANCE_OPERACAO.md).

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

### Continuação local em 10/11: intervalos dos RDOs e calendário na primeira carga

O commit `9721c798`, que reúne a continuação anterior, foi enviado para
`origin/fix/page-loading-performance`. As mudanças descritas nesta seção foram
feitas localmente depois desse envio.

A fonte de relatórios deixou de trazer os horários dos serviços filhos de RDOs:
seus minutos registrados já são a fonte utilizada pelo cálculo, inclusive quando
zerados. Os intervalos dos outros tipos continuam disponíveis para o fallback de
horas. O filtro atua somente nos filhos, mantendo o recorte dos relatórios pais,
a evidência histórica, a elegibilidade offshore anual e a montagem dos rateios.
As leituras do ponto e dos funcionários ignorados também começam antes das demais
fontes; assim, a busca de ausências, feriados e revisão do calendário pode ocorrer
enquanto relatórios, cargos e projetos ainda carregam. Não há cache novo,
migration, índice, aumento de pool ou mudança de fórmula nesta etapa.

Cinco pares por cenário compararam `9721c798` com o código local, alternando a
ordem de execução. O PostgreSQL 16 descartável teve uma CPU e 768 MiB; o pool
manteve oito conexões. São tempos do cálculo do serviço com páginas do banco
aquecidas. Cada amostra fria usa processo Node/Prisma novo; o tempo não inclui
o boot/importação do processo. A leitura de sessão é um SELECT prévio, sem
autenticação ou requisição HTTP.

| Relatórios / serviços sintéticos | Após aquecimento, antes → depois | Processo novo, antes → depois | Processo novo após leitura de sessão, antes → depois |
| --- | ---: | ---: | ---: |
| 1.203 / 2 | 61,2 → 58,1 ms (5,1%) | 313,4 → 308,1 ms (1,7%) | 202,2 → 208,3 ms (−3,0%) |
| 1.203 / 4.802 | 65,4 → 57,3 ms (12,4%) | 294,7 → 267,8 ms (9,1%) | 203,0 → 205,4 ms (−1,2%) |
| 6.003 / 24.002 | 181,2 → 154,6 ms (14,7%) | 469,9 → 414,8 ms (11,7%) | 415,7 → 288,1 ms (30,7%) |

Os percentuais são reduções das medianas de cinco amostras; valores negativos
representam aumento. Todos os cenários mantêm 21 colaboradores e 500 preferências
no projeto. Cada par conferiu igualdade exata do resultado completo, incluindo
Map e Set. No cenário com 4.802 serviços, a representação JSON da consulta
principal de relatórios caiu de **583.421 B para 392.582 B (32,7%)**. Os perfis
separados contaram **18 operações Prisma** antes e depois; essa contagem não é
uma contagem de comandos SQL, e o tamanho JSON não é tráfego de rede.

O ganho cresce no cenário com mais serviços, mas não é uniforme: após a leitura
de sessão, os dois cenários menores ficaram ligeiramente mais lentos. A meta de
50% em T07 continua pendente. Estes números incrementais não devem ser compostos
com os 36,4% da rodada anterior, pois os cenários e as execuções são diferentes.
As amostras e os perfis estão nas
[evidências de 10/11](evidence/performance-local-20261110.json).

A regressão com PostgreSQL real compara as fontes antigas/atuais e o cálculo
completo, verifica o fallback dos relatórios de serviço e a atualização após
gravar uma ausência. Os testes unitários verificam a sobreposição das leituras
e a recuperação na requisição seguinte após falha da disponibilidade. A suíte
completa de backend passou com **2.758 aprovados, 38 ignorados e nenhuma falha**.
O novo teste PostgreSQL tem uma etapa própria no CI para evitar que sua importação
sintética influencie as outras provas de detalhe que usam o ponto vigente.

O benchmark reproduzível está em
`backend/scripts/benchmark-labor-performance.js`. Ele aceita somente PostgreSQL
em loopback com nome de banco terminado em `_test`, cria IDs sintéticos próprios
e remove a fixture ao terminar. Com um banco descartável local já migrado e sua
URL em `DATABASE_URL`, preparar a referência e executar:

```bash
PERF_BASELINE_DIR=$(mktemp -d /tmp/filtro-labor-baseline.XXXXXX)
git archive 9721c798 backend/src backend/package.json backend/prisma/schema.prisma shared | tar -x -C "$PERF_BASELINE_DIR"
ln -s "$PWD/backend/node_modules" "$PERF_BASELINE_DIR/backend/node_modules"
NODE_ENV=test DATABASE_CONNECTION_LIMIT=8 node backend/scripts/benchmark-labor-performance.js \
  --baseline-root="$PERF_BASELINE_DIR/backend" --rounds=5 \
  --reports=1200 --services-per-rdo=4 --profile \
  --output=/tmp/filtro-labor-comparison.json
```

As opções `--reports=6000` e `--services-per-rdo=0` reproduzem os outros volumes.
Perfis são chamadas extras instrumentadas, fora das amostras cronometradas.
O próximo incremento deve separar o custo de inicialização do runtime/Prisma
das leituras efetivamente dominantes e medir os planos SQL antes de decidir
novos índices ou mudanças no recorte global. Também permanecem o aceite HTTP
concorrente, LCP/conteúdo útil, volumes/perfis autenticados e as janelas publicadas
de 24 h/sete dias. A política/aplicação de retenção continua pendente; backups
permanecem adiados pelo usuário.

### Continuação local em 10/11: catálogo de parâmetros e planos SQL

Os perfis de cargos e os modelos-base agora compartilham uma leitura do catálogo
de parâmetros versionados. A associação ao cargo ocorre pelo ID, preservando o
nome, o modelo-base escolhido, o fallback, a vigência e os desempates das versões.
Os cargos sem perfil continuam sem custo configurado. O consumidor da API de
custo/hora, as estimativas de relatórios e as trilhas usam o mesmo resolvedor.

A leitura global dos horários passou a consultar diretamente os serviços dentro
do período, vinculados a relatórios ativos de tipo diferente de RDO. O resultado
é associado aos mesmos relatórios pais, cuja consulta e ordem foram preservadas.
Isso conserva o número escolhido quando dois RDOs têm as mesmas horas, a evidência
histórica, o fallback por intervalos e a elegibilidade offshore anual.
A consulta de horários passou de **1.204 para quatro parâmetros** com 1.203
relatórios, e de **6.004 para quatro** com 6.003 relatórios.

O conjunto medido passou de **35 para 33 SELECTs**, embora as chamadas Prisma
tenham passado de 18 para 19: a nova leitura direta substitui a consulta SQL que
antes era gerada pela relação aninhada, e o catálogo elimina duas consultas SQL
duplicadas. Essas contagens são da fixture local; permanecem constantes ao variar
seu volume. As listas das outras relações continuam candidatas a análise.
O escopo de acesso por projeto também se aplica ao modelo ReportService.

Cinco pares por modo compararam esta etapa com um snapshot do código local da
seção anterior, mantendo banco descartável, limites, pool e dados iguais dentro
de cada comparação. A referência incremental é um snapshot intermediário sem
commit separado; os hashes dos arquivos estão nas
[evidências desta continuação](evidence/performance-cold-costs-20261110.json).

| Relatórios / serviços | Aquecido, antes → depois | Processo novo, antes → depois | Após leitura de sessão, antes → depois |
| --- | ---: | ---: | ---: |
| 1.203 / 2 | 90,9 → 77,8 ms (14,4%) | 302,3 → 313,8 ms (−3,8%) | 239,5 → 208,2 ms (13,1%) |
| 1.203 / 4.802 | 68,6 → 64,4 ms (6,1%) | 322,1 → 285,2 ms (11,5%) | 202,7 → 188,8 ms (6,9%) |
| 6.003 / 24.002 | 159,7 → 144,4 ms (9,6%) | 415,4 → 388,8 ms (6,4%) | 311,0 → 275,3 ms (11,5%) |

Os percentuais são reduções das medianas; o resultado negativo registra aumento.
O cenário menor com poucos serviços não demonstrou melhora incremental na partida
fria. As execuções variam com o ambiente local; não há ganho universal confirmado.
Todas as comparações verificaram igualdade exata do cálculo completo.

Também foi repetida a comparação direta com o código anterior ao planejamento,
`3db7e76f`, usando os mesmos dados dentro de cada par. A primeira execução em
processo novo passou de **528,9 para 314,0 ms (40,6%)** no cenário com dois serviços,
e de **574,5 para 286,9 ms (50,1%)** no cenário com 4.802 serviços. O resultado
denso fica próximo do limiar; a meta permanece parcial, pois o cenário com poucos
serviços e o aceite HTTP ainda não a atingiram. Esses ganhos foram medidos
diretamente; não são a composição dos percentuais das rodadas anteriores.

O benchmark com `--profile` também captura chamadas do pool e repete os SELECTs
com `EXPLAIN (ANALYZE, BUFFERS)` depois das amostras. Os planos locais não
justificaram índice novo. A duração observada no pool inclui espera e atrasos do
event loop, e pode se sobrepor às demais chamadas; sua soma não mede latência HTTP.
O replay dos planos usa páginas aquecidas e não reproduz sozinho a primeira carga.

Um diagnóstico adicional, em processos separados, divide importação do módulo
Prisma, `$connect` e dois `SELECT 1`. Na fixture menor, as medianas do candidato
foram **190,1 ms, 84,0 ms, 24,5 ms e 1,9 ms**, respectivamente. A importação é
medida após carregar as dependências do diagnóstico e não entra no cronômetro
do cálculo. Os três processos de diagnóstico não aquecem as amostras medidas;
essas durações não medem o boot completo nem representam autenticação HTTP.

A regressão PostgreSQL usa 120 RDOs, inclui alterações de salário/modelo no mês
e verifica paridade das fontes e do cálculo, atualização após gravar horário ou
ausência e menos de dez parâmetros na consulta de horários. Os testes unitários
cobrem empate de RDOs, intervalo noturno, limite do período, cargo sem perfil,
fallback de modelo e recuperação após falha de leitura.

Validação final: **2.761 testes de backend aprovados, 38 ignorados e nenhuma
falha**, incluindo a regressão PostgreSQL, além de arquitetura, consistência das
evidências e configuração do CI verificadas. O banco descartável foi removido
após as medições e os testes.

O cenário HTTP local autenticado e concorrente previsto nesta etapa foi
implementado na continuação abaixo. A aceitação publicada de HTTP/conteúdo
útil/LCP e de 24 h/sete dias permanece em T12. A política de retenção continua
pendente; backups seguem adiados.

### Continuação local: HTTP autenticado, concorrência e atualização entre processos

O commit `bd1816dd` foi enviado para `origin/fix/page-loading-performance` antes
desta continuação. O código da aplicação medido é o desse commit; esta etapa
acrescenta ferramentas de medição, testes e configuração de CI locais.

`npm --prefix backend run performance:http` prepara dados sintéticos em um banco
PostgreSQL exclusivo e sobe a aplicação Express real em processos separados,
escutando somente em loopback. O comando aceita apenas uma URL PostgreSQL local
com nome terminado em `_test`, sem parâmetros que sobrescrevam a conexão, e
verifica a ausência de dados operacionais antes da fixture. Os dois centros
internos criados pelas migrations são preservados. O preparo executa `ANALYZE`
no banco descartável antes de medir. A API sobe sem iniciar o worker ou enviar
erros para webhook; os arquivos temporários e a fixture própria são removidos.

Há duas sessões persistidas para administrador e duas para o visualizador do
Acompanhamento. A autenticação passa pelo `requireAuth`, incluindo leitura e
validação do hash da sessão. O login por senha não integra o ensaio. As respostas
verificam a visibilidade de projetos restritos e a remoção de faturamento/impostos
para o visualizador. Os custos de mão de obra continuam visíveis conforme a
permissão atual do módulo. Oito leituras adicionais verificam 401 sem sessão e
403 sem papel do módulo, depois de aquecer os caches.

A fixture final contém três projetos sintéticos, grupo com dois membros, 1.203
relatórios, 4.802 serviços, 21 colaboradores, 297 linhas de escopo e 11 divisões.
O PostgreSQL 16 foi limitado a uma CPU e 768 MiB; a API usou pool de oito
conexões e concorrência global de quatro requisições, misturando rotas e perfis.

Foram coletadas **800 respostas aquecidas**, cem por rota/perfil, além de 24
primeiras respostas em processos novos, oito aquecimentos e 16 leituras após
gravação. As **848 respostas medidas foram 200**, sem interrupções. As oito
negativas esperadas ficam em um conjunto separado. As medianas frias usam três
amostras por rota/perfil; seu p95 permanece indisponível. O comando permite até
cem rodadas frias quando essa estatística for necessária.

| Rota | p95 cliente, administrador | p95 cliente, visualizador | Maior corpo JSON | Chamadas medianas ao banco |
| --- | ---: | ---: | ---: | ---: |
| Cards | 272,8 ms | 148,9 ms | 7.026 B | 11 |
| Detalhe individual | 397,5 ms | 487,1 ms | 467.018 B | 46–47 |
| Grupo | 712,4 ms | 816,6 ms | 453.475 B | 62–64 |
| Ponto | 586,1 ms | 512,5 ms | 738.561 B | 40 |

O cronômetro cliente inclui o recebimento do corpo. O cronômetro da API inclui
autenticação e serialização; os maiores p95 do servidor foram **244,4 ms para
cards** e **480,9 ms para detalhe**. São resultados locais, com páginas do banco
aquecidas, sem Nginx, TLS, renderização ou navegação de navegador. A fase aquecida
usa processo persistente e conserva as expirações normais dos caches.

Durante requisições ativas, a amostragem a cada 10 ms observou **673 de 3.024
amostras sem espera (22,3%)**, pico de 47 consultas na fila e maior sequência
observada com fila de 759,8 ms. Não houve sequência observada acima de cinco
segundos. São observações do pool, sujeitas ao atraso do event loop, e não medidas
individuais de espera das consultas. A meta de 95% sem fila continua pendente.

O processo que prepara a fixture também altera um serviço realizado e um resumo
do ponto, usando outro Prisma/pool e sem limpar a memória da API. O timestamp do
projeto permanece igual. As duas sessões de cada perfil observaram o novo avanço
individual/do grupo e as novas horas do ponto; a rodada de verificação terminou
em até **1.334,9 ms**, contados após confirmar as gravações e preparar a coleta.
Os cards são novamente
validados quanto a permissões, sem afirmar atualização imediata de seu cache.
Isso verifica endpoints; o polling e o comportamento com aba oculta continuam
dependendo dos testes de navegador e do aceite publicado.

Uma tentativa exploratória anterior recebeu timeout PostgreSQL em uma leitura
de `ReportCollaborator` com junções de acesso a projeto. O replay com estimativas
desatualizadas escolheu Nested Loop e mediu 6,3 ms; após `ANALYZE`, escolheu
Hash Join e mediu 1,7 ms. O replay **não reproduziu o timeout**, portanto não
estabelece sua causa. A rodada completa final, com estatísticas preparadas,
terminou sem erros. Falhas futuras geram artefato marcado como incompleto,
incluindo respostas recebidas e contagem de tentativas, e o comando termina com
erro. O incidente permanece registrado nas evidências.

Os dados por rota/perfil/fase, as amostras numéricas e os planos do replay estão
nas [evidências HTTP locais](evidence/performance-http-local-20261110.json).
O CI ganhou um job PostgreSQL isolado para os contratos de concorrência,
permissões, privacidade dos traces e atualização entre processos. Os testes de
relatório verificam separação por status/fase, supressão de p95 abaixo de cem
amostras e contagem do pool somente durante atividade.

Validação desta etapa: **seis testes aprovados, sem falhas**, incluindo PostgreSQL,
execução da CLI que preserva dados operacionais existentes e grava um artefato
incompleto, além de arquitetura e configuração do CI verificadas. Os contratos
da aplicação mantêm o código do commit medido; não houve nova alteração em
`backend/src` ou `frontend/src`.

Com um banco descartável local migrado, sem dados operacionais e com sua URL em
`DATABASE_URL`, executar:

```bash
NODE_ENV=test npm --prefix backend run performance:http -- \
  --requests=100 --cold-rounds=3 --reports=1200 --scopes=297 \
  --concurrency=4 --pool-limit=8 --output=/tmp/filtro-http-performance.json
```

O incremento de consultas/volume de ponto e grupos foi implementado na
continuação abaixo. Os aceites publicados, a redução fria geral de 50%, a
política de retenção e as séries operacionais continuam pendentes. Backups
permanecem adiados.

### Continuação local: leituras de ponto por finalidade e custos dos grupos em lote

O ensaio HTTP anterior foi consolidado no commit local `edd393bb`
(`perf: adicionar ensaio HTTP autenticado e concorrente`), sem push nesta rodada.
Esta continuação modifica a aplicação apenas no código local.

A aba de importação usava somente os nomes não vinculados da resposta completa
de colaboradores. Agora pede `view=reconciliation`: lê os metadados do ponto
vigente, os nomes não vinculados e as exclusões, sem calcular custos nem consultar
o histórico de RDOs. A tabela de custos pede `view=summary`, com identidade,
horas, valores, ociosidade e todos os meses necessários ao filtro. Os dados de
apropriação e as trilhas permanecem disponíveis no contrato completo padrão
(`view=full` ou sem parâmetro) e nas rotas de auditoria existentes. As duas
consultas do frontend possuem caches distintos e continuam sendo invalidadas
pelo prefixo compartilhado `ponto-colaboradores` após alterações.

O detalhe de grupo agora lê de uma vez categorias, somas financeiras do Omie,
equipamentos, consumo de estoque e custos manuais dos membros. As somas continuam
no PostgreSQL, sem novo somatório em JavaScript. O catálogo de custos/cargos
usado no fallback de horas dos RDOs é carregado uma vez, sob demanda, dentro da
requisição. Não foi acrescentado cache entre requisições nem ampliado o pool.
A projeção exclusiva de avanço não carrega essas fontes. O reaproveitamento
exige mesmo projeto, escopo de acesso e opção de categorias administrativas;
divisões continuam usando suas próprias leituras com o recorte correspondente.

A regressão com PostgreSQL real compara o objeto completo de cada membro e do
grupo com a montagem anterior, incluindo centavos, categoria administrativa,
membro sem despesas Omie, colaborador sem ponto, custos manuais e divisão.
Também verifica custos atualizados na próxima requisição, equivalência de cada
campo/mês do resumo com o contrato completo, conciliação sem leitura de RDO,
401/403 e acesso do visualizador. No frontend, um teste executa os clientes reais
e o QueryClient para verificar parâmetros, separação dos caches e invalidação.

Foram executadas três coortes sequenciais com o mesmo volume e configuração:
referência `edd393bb` com resposta completa; candidato com tabela resumida;
candidato com conciliação. A ferramenta aceita `--source-root` para medir o
código arquivado da referência e `--ponto-view` para selecionar o consumidor.
As dependências são as mesmas. Cada coorte usa dados sintéticos equivalentes:
1.203 relatórios, 4.802 serviços, 21 colaboradores, 297 linhas de escopo e grupo
com dois membros; PostgreSQL 16 com uma CPU/768 MiB, pool oito e concorrência
quatro. Foram cem respostas aquecidas por rota/perfil, totalizando 800, mais
oito primeiras respostas em processos novos, oito aquecimentos e 16 leituras
após gravação: **832 respostas medidas 200 por coorte**, além das oito negativas
esperadas. Não houve interrupção ou erro inesperado.

| Superfície aquecida | Antes: chamadas medianas / maior JSON | Depois: chamadas medianas / maior JSON |
| --- | ---: | ---: |
| Grupo, administrador | 62 / 453.475 B | 49 / 453.475 B |
| Grupo, visualizador | 64 / 452.068 B | 50 / 452.068 B |
| Tabela de custos do ponto | 40 / 738.561 B | 40 / 21.167 B |
| Conciliação da importação | 40 / 738.561 B | 8 / 240 B |

A tabela de custos transfere **97,1% menos JSON**. A conciliação realiza **80%
menos chamadas ao banco**; ela tem finalidade diferente da tabela de custos e
não substitui o cálculo quando os valores são necessários. Os grupos reduzem
suas chamadas em aproximadamente 21–22%, com igualdade dos resultados completos.

| p95 do cliente, aquecido | Referência completa | Candidato com tabela | Candidato com conciliação |
| --- | ---: | ---: | ---: |
| Cards, administrador / visualizador | 229,8 / 118,7 ms | 198,5 / 117,8 ms | 157,4 / 127,5 ms |
| Detalhe individual, administrador / visualizador | 284,1 / 430,2 ms | 297,0 / 349,4 ms | 237,2 / 323,2 ms |
| Grupo, administrador / visualizador | 574,5 / 650,9 ms | 432,1 / 593,5 ms | 422,4 / 437,5 ms |
| Ponto, administrador / visualizador | 501,9 / 392,0 ms | 391,0 / 331,7 ms | 266,6 / 202,6 ms |

As latências são observações de coortes sequenciais, sem pares aleatorizados
ou repetição estatística da comparação HTTP. Não demonstram ganho universal:
o detalhe individual do administrador ficou cerca de 4,5% mais lento na coorte
com tabela resumida. As medições não incluem Nginx, TLS ou navegador. A única
amostra fria de cada rota/perfil não permite p95 nem fecha o aceite frio geral.

| Pool durante atividade aquecida | Referência completa | Candidato com tabela | Candidato com conciliação |
| --- | ---: | ---: | ---: |
| Amostras sem fila / total | 615 / 2.745 | 556 / 2.232 | 540 / 1.818 |
| Proporção sem fila | 22,4% | 24,9% | 29,7% |
| Pico de consultas esperando | 43 | 43 | 44 |
| Maior sequência observada com fila | 1.146,3 ms | 480,4 ms | 339,6 ms |

**A meta de 95% sem fila continua pendente**, e o pico de fila não caiu. A
amostragem a cada 10 ms depende do event loop e não mede espera individual de
consulta; não houve sequência observada acima de cinco segundos. Após gravação
por outro processo, a coorte de conciliação verificou as leituras em até 906,5 ms,
contados após confirmar a escrita e preparar a coleta. Os cards continuam sujeitos
à expiração normal de seu cache; não se afirma atualização imediata dessa rota.

Os dados numéricos das três coortes, o código medido e a validação estão nas
[evidências de ponto/grupos](evidence/performance-point-groups-20261110.json).
O CI executa a regressão PostgreSQL em etapa separada do ensaio HTTP para não
semear duas fixtures simultaneamente no banco exclusivo do job.

Validação: **2.765 testes de backend aprovados e 42 ignorados**, **896 testes
de frontend aprovados**, além dos dois testes específicos de DTO/paridade com
PostgreSQL real. Build TypeScript/Vite, ESLint, seis orçamentos de tamanho,
arquitetura e configuração do CI passaram. Na primeira execução simultânea
das suítes, o teste existente de isolamento em PostgreSQL WASM excedeu 30 s;
passou sozinho em 5,5 s e na repetição completa do backend, sem alterar timeout
ou código desse teste. O banco descartável foi removido ao concluir a validação.

O próximo incremento local é reduzir as leituras restantes dos grupos e da
tabela de custos sem alterar regras de apropriação ou atualização. Permanecem
também a meta fria geral de T07, os aceites publicados de conteúdo útil/LCP/HTTP,
as séries de 24 h/sete dias e a política de retenção. Backups seguem adiados;
não houve execução em servidores ou migration nova.

### Continuação local: catálogo de cargos e horas dos RDOs reutilizados

A etapa anterior foi consolidada no commit local `d194dad8`
(`perf: reduzir leituras do ponto e custos dos grupos`). Não houve push nesta
rodada. Esta continuação altera somente backend, testes e evidências locais.

O motor de custos agora usa os cargos que já carregou para resolver também
o cargo atual e o histórico dos colaboradores do ponto. O catálogo inclui
cargos sem perfil de custo e é reconstruído a cada cálculo, preservando a
vigência das mudanças e a atualização de nomes. A interface pública de
`getRoleParamsResolver` continua a mesma. Na regressão PostgreSQL com histórico,
as consultas à tabela `JobRole` passaram de três para uma.

O detalhe individual, de grupo e de divisão reaproveita as horas diurnas e
noturnas da leitura principal de relatórios ao calcular o consumo por cargo.
Isso remove a leitura aninhada de `Report` na consulta da equipe, que vinculava
novamente os IDs dos relatórios históricos. As consultas principais de relatórios
e de equipe mantêm filtros e ordem anteriores; não foi reunida a leitura dos
RDOs dos membros nem alterada a seleção de fontes, nomes ou snapshots de cargo.
Não há novo cache entre requisições, migration ou aumento de pool.

Foi arquivado o backend de `d194dad8` e comparado com o candidato em processos
separados, com as mesmas dependências e exatamente os mesmos dados PostgreSQL.
Os cinco resultados completos — ponto, detalhe individual, grupo, divisão e
grupo sem custos individuais/categorias administrativas — foram iguais antes
e depois de gravações de cargo, salário e horas. A fixture inclui histórico de
cargos, cargo sem perfil, pessoa sem ponto, equipe em ambos os membros, plano
de horas por cargo e turnos diurno/noturno. Os hashes e contadores dessa
comparação estão nas evidências; são distintos dos cenários HTTP abaixo.

Dois ensaios HTTP sequenciais mediram referência e candidato, ambos usando
`--ponto-view=summary`, PostgreSQL 16 com uma CPU/768 MiB, pool oito, concorrência
quatro e o mesmo volume: 1.203 relatórios, 4.802 serviços, 21 colaboradores,
297 linhas de escopo e grupo com dois membros. Cada coorte teve cem respostas
aquecidas por rota/perfil (800), oito primeiras respostas em processos novos,
oito aquecimentos e 16 leituras após gravação. As **832 respostas medidas por
coorte foram 200**, além de oito negativas esperadas; não houve interrupções.

| Rota aquecida | Chamadas medianas antes → depois | p95 cliente administrador antes → depois | p95 cliente visualizador antes → depois |
| --- | ---: | ---: | ---: |
| Cards | 11 → 11 | 155,1 → 150,8 ms | 73,4 → 73,7 ms |
| Detalhe individual | 46–47 → 45–46 | 238,0 → 236,8 ms | 267,2 → 247,0 ms |
| Grupo | 49–50 → 47–48 | 352,2 → 324,3 ms | 432,3 → 416,2 ms |
| Tabela de custos do ponto | 40 → 38 | 304,8 → 284,1 ms | 243,9 → 233,1 ms |

Os maiores corpos permaneceram iguais: 7.026 B nos cards, 467.018 B no detalhe,
453.475 B no grupo e 21.167 B na tabela de custos. A conciliação não foi medida
novamente nesta rodada, pois seu caminho não executa os cálculos alterados.

| Pool durante atividade aquecida | Referência | Candidato |
| --- | ---: | ---: |
| Amostras sem fila / total | 526 / 2.000 | 480 / 1.916 |
| Proporção sem fila | 26,3% | 25,1% |
| Pico de consultas esperando | 44 | 39 |
| Maior sequência observada com fila | 365,5 ms | 402,1 ms |

**Não se observou melhora na proporção sem fila**, e a meta de 95% continua
aberta. O pico caiu, mas a maior sequência observada aumentou; não houve
sequência acima de cinco segundos. São amostras intervalares dependentes do
event loop. Os p95 são observações de duas coortes sequenciais, sem pares
aleatorizados ou repetição estatística; não permitem atribuir ganho universal
nem regressão causal de fila. A única amostra fria de cada rota/perfil não
fecha p95 ou a meta fria geral de 50%. Não foram medidos Nginx, TLS, navegação
ou renderização. No candidato, as leituras após escrita terminaram em até
771,9 ms após confirmação e preparo da coleta; os cards conservam sua política
de expiração, sem afirmação de atualização imediata.

As [evidências desta continuação](evidence/performance-reused-sources-20261110.json)
guardam as amostras numéricas, hashes do código e resultados da comparação.
As regressões permanentes verificam uma única consulta de cargos com histórico,
perfis ausentes, nome atualizado no cálculo seguinte, ausência da releitura
aninhada de relatórios e totais por cargo com os dois turnos. Os jobs PostgreSQL
existentes do CI já executam esses testes, sem mudança no workflow.

Validação final: **2.765 testes de backend aprovados e 42 ignorados**, sem
falhas; **seis testes com PostgreSQL real aprovados**, nas três execuções
específicas de motor, ponto/grupos e projeções HTTP. Os 71 testes unitários
focados também passaram, assim como sintaxe, arquitetura, consistência das
amostras e hashes do código. Não houve alteração de frontend nesta rodada;
build, lint, orçamentos e seus 896 testes já haviam passado na etapa de
`d194dad8`. O banco descartável foi removido ao concluir a validação.

Para reproduzir o ensaio após arquivar a referência e disponibilizar suas
dependências, em banco local exclusivo e migrado com URL em `DATABASE_URL`:

```bash
NODE_ENV=test npm --prefix backend run performance:http -- \
  --source-root=/caminho/do/backend-arquivado \
  --ponto-view=summary --requests=100 --cold-rounds=1 \
  --reports=1200 --scopes=297 --concurrency=4 --pool-limit=8 \
  --output=/tmp/filtro-http-referencia.json
NODE_ENV=test npm --prefix backend run performance:http -- \
  --ponto-view=summary --requests=100 --cold-rounds=1 \
  --reports=1200 --scopes=297 --concurrency=4 --pool-limit=8 \
  --output=/tmp/filtro-http-candidato.json
```

Os próximos incrementos continuam sendo o compartilhamento de metadados da
equipe dos grupos e a redução da pressão concorrente das fontes, com medição
de espera total e paridade das regras. Permanecem os aceites publicados, a
meta fria geral, as séries de 24 h/sete dias e a política de retenção. Backups
seguem adiados; não houve execução em servidores.

### Continuação local: equipe compartilhada nos grupos e medição das rajadas SQL

A etapa de cargos e horas dos RDOs foi consolidada no commit local `81f183a3`
(`perf: reutilizar cargos do ponto e horas dos RDOs`), sem push nesta rodada.
Esta continuação atua apenas no código, testes e medições locais.

Os grupos agora carregam nomes e cargos atuais em um catálogo por requisição,
restrito às pessoas dos relatórios não excluídos de seus membros. A carga começa assim
que a primeira equipe chega, em paralelo às outras fontes; grupos sem equipe e
projeções exclusivas de avanço não fazem essa leitura. As consultas de vínculos
continuam individuais por membro, com filtros, snapshots e ordem preservados.
O compartilhamento permanece condicionado a projeto, escopo de acesso e opção
de categorias administrativas iguais; divisões usam suas leituras próprias.

O fallback de custo para pessoa sem apropriação do ponto também passa por uma
leitura compartilhada dentro da requisição. Pedidos no mesmo turno do event loop
são reunidos; IDs repetidos reutilizam o resultado ou a leitura em andamento,
mesmo quando os membros terminam em momentos diferentes. Campos de histórico de
cargo e exclusão manual de simulação são preservados. Erros rejeitam todos os
consumidores afetados e removem as entradas com falha para permitir outra leitura;
pessoas ausentes são lembradas somente durante aquela requisição. Não existe
cache novo entre requisições, aumento do pool ou limitação artificial de consultas.

A regressão com PostgreSQL confirmou um catálogo de identidade e uma busca de
custo para a mesma pessoa nos dois membros, inclusive em leituras sequenciais.
Ela verifica exclusão de pessoas presentes apenas em outro projeto, rejeição de
fontes de outro escopo, divisão, categorias administrativas e atualização do nome
e da exclusão de simulação na requisição seguinte. Os testes do carregador cobrem
pedidos simultâneos, repetidos/em andamento, ausência de pessoa, requisições
separadas e falha com nova tentativa.

Uma comparação direta com o backend arquivado de `81f183a3`, usando exatamente
o mesmo banco em processos separados, manteve iguais os cinco resultados
completos: ponto, detalhe individual, grupo, divisão e grupo sem custos
individuais/categorias administrativas. A comparação foi repetida após mudar
cargo, salário e horas. No cenário adicional com pessoas sem ponto nos dois
membros, o grupo passou de **71 para 65 consultas**, e a variante sem custos
individuais de **61 para 59**. Esses contadores são distintos do ensaio HTTP.

Para exercitar ambos os membros, o benchmark ganhou `--distribute-group-reports`.
A opção, desligada por padrão, redistribui os mesmos RDOs em blocos de vinte,
mantendo pessoas em comum, três projetos, 1.203 relatórios, 4.802 serviços,
21 colaboradores, 297 linhas de escopo e 11 divisões. O RDO usado na alteração
do worker permanece no primeiro membro. A limpeza inclui agora os relatórios
próprios deslocados, antes de remover os projetos secundários. Referência e
candidato usam a mesma distribuição; **essa fixture não é comparável diretamente
às rodadas anteriores com carga concentrada em uma missão**.

O processo de medição agora registra `databaseQueriesPeak`: maior número de
chamadas a `pg.Pool.query` submetidas e ainda não concluídas dentro da requisição.
O valor inclui consultas na fila do pool; não representa conexões ou SQLs
efetivamente executando ao mesmo tempo. A instrumentação fica somente no servidor
do benchmark, mantém as interfaces por Promise/callback e não limita o trabalho.
Relatórios antigos sem essa informação continuam legíveis.

Foram executadas duas coortes sequenciais, com PostgreSQL 16 limitado a uma CPU
e 768 MiB, pool oito, concorrência quatro e `view=summary` para o ponto.
Cada coorte contém 800 respostas aquecidas (cem por rota/perfil), oito primeiras
respostas em processos novos, oito aquecimentos e 16 leituras após escrita.
As **832 respostas medidas por coorte foram 200**, além das oito negativas
esperadas; não houve interrupções ou erros inesperados.

| Rota aquecida | Consultas medianas antes → depois | p95 cliente administrador antes → depois | p95 cliente visualizador antes → depois |
| --- | ---: | ---: | ---: |
| Cards | 11 → 11 | 144,9 → 124,7 ms | 71,4 → 72,1 ms |
| Detalhe individual | 53–54 → 53–54 | 246,6 → 243,6 ms | 267,2 → 274,1 ms |
| Grupo | 59–60 → 53–54 | 339,5 → 325,1 ms | 394,8 → 388,9 ms |
| Tabela de custos do ponto | 38 → 38 | 245,1 → 225,0 ms | 218,0 → 205,4 ms |

Os grupos reduzem aproximadamente **10% das consultas**, mantendo os corpos
completos: 442.319 B para administrador e 440.912 B para visualizador. As demais
superfícies conservaram seus tamanhos: máximo de 7.021 B nos cards, 302.068 B no
detalhe e 20.447 B no ponto. As latências são observações de duas coortes
sequenciais, sem pares aleatorizados ou repetição estatística. Não houve ganho
uniforme: o detalhe do visualizador ficou cerca de 2,6% mais lento nesta coleta.
Não se atribui melhoria direta ao ponto, cujo caminho de cálculo não foi alterado.

| Pool durante atividade aquecida | Referência | Candidato |
| --- | ---: | ---: |
| Amostras sem fila / total | 516 / 2.075 | 545 / 1.990 |
| Proporção sem fila | 24,9% | 27,4% |
| Pico de consultas esperando | 36 | 42 |
| Maior sequência observada com fila | 311,1 ms | 316,9 ms |

**A meta de 95% sem fila permanece pendente.** A proporção observada aumentou,
mas o pico e a maior sequência de fila também aumentaram; não houve sequência
observada acima de cinco segundos. A medição de rajadas encontrou, nas duas
versões, máximos por requisição de três consultas pendentes nos cards, 18 no
detalhe, 14 no grupo e 17 no ponto. Os grupos reduziram o volume total sem reduzir
esse máximo. A próxima investigação local deve priorizar a sobreposição das
fontes no detalhe/ponto, medir a duração HTTP completa e contabilizar qualquer
espera introduzida na aplicação, antes de definir coordenação de concorrência.

As leituras após escrita terminaram em até 733,8 ms no candidato, contados após
confirmar as gravações e preparar a coleta. Os cards mantêm sua política de
expiração; não se afirma atualização imediata. A coleta não inclui Nginx, TLS,
navegação ou renderização; uma amostra fria por rota/perfil não permite p95
nem fecha a meta fria geral de 50%.

Os hashes do código, as amostras e a comparação completa estão nas
[evidências de equipe/rajadas](evidence/performance-group-collaborators-20261110.json).
Os jobs PostgreSQL existentes executam as regressões atualizadas; o ensaio curto
de CI também usa RDOs distribuídos e verifica a métrica de rajadas, permissões,
privacidade e atualização por outro processo.

Validação final: **2.768 testes de backend aprovados e 42 ignorados**, sem
falhas. Também passaram a regressão PostgreSQL de ponto/grupos, os quatro
testes de projeções com PostgreSQL e os seis contratos do ensaio HTTP, além
dos três testes do carregador, sintaxe, arquitetura e consistência/privacidade
das evidências. Os cinco resultados completos foram comparados com a referência
nas duas fases de dados. Não houve alteração de frontend; sua última validação
de testes, build, lint e orçamentos foi a etapa de `d194dad8`. O banco descartável
foi removido ao concluir a validação.

Para repetir a comparação local, usar os comandos da seção anterior acrescentando
`--distribute-group-reports` em ambas as versões e arquivando o backend de
`81f183a3` como referência. Permanecem pendentes as rajadas/fila do pool, a meta
fria geral, os aceites publicados de HTTP/conteúdo útil/LCP, as séries de
24 h/sete dias e a política de retenção. Backups continuam adiados; não houve
execução em servidores.

### Continuação local: comparação das rajadas e reutilização de metadados do ponto

A etapa anterior foi consolidada no commit `e5a1fa52`
(`perf: compartilhar equipe dos grupos e medir rajadas SQL`) e enviada para
`origin/fix/page-loading-performance`, junto com os três commits locais anteriores.
O CI foi disparado manualmente para esse SHA, pois o workflow automático desta
branch depende de PR para `main`. Os **11 jobs terminaram com sucesso**, incluindo
backend, frontend, orçamentos, navegador, PostgreSQL e Docker:
[execução do CI](https://github.com/pedro-pn/filtroAPP/actions/runs/42870528167).
Esse resultado valida o commit enviado; as mudanças descritas a seguir continuam
locais e precisam de novo CI após seu envio.

Foram avaliadas três políticas locais de agendamento de fontes: três fontes no
ponto/detalhe começando por relatórios/equipe no detalhe, três em ambos antecipando fontes críticas,
e três no ponto/seis no detalhe com antecipação. A instrumentação registrou
`labor.sources.queue` e `detail.sources.queue`, além do HTTP completo. A soma dos
tempos de espera de várias fontes pode se sobrepor e ultrapassar o tempo HTTP;
ela não representa uma duração exclusiva da requisição.

| Variante exploratória | p95 do detalhe, administrador / visualizador | p95 do ponto, administrador / visualizador | Decisão |
| --- | ---: | ---: | --- |
| Referência `e5a1fa52` | 230,9 / 257,2 ms | 220,5 / 195,6 ms | Controle inicial |
| Três fontes, relatórios/equipe primeiro no detalhe | 477,7 / 472,6 ms | 235,9 / 179,8 ms | Descartada: grande piora no detalhe |
| Três fontes, fontes críticas primeiro | 289,5 / 309,7 ms | 158,1 / 140,0 ms | Descartada: melhora no ponto, piora no detalhe |
| Três no ponto/seis no detalhe, fontes críticas primeiro | 241,2 / 256,3 ms | 247,6 / 215,7 ms | Descartada: sem ganho HTTP consistente |

Os limites reduziram picos de consultas submetidas ainda não concluídas, mas
introduziram espera na aplicação. **Nenhum desses limites foi mantido no código
da aplicação.** O detalhe e o módulo de medição de requisições voltaram exatamente
ao conteúdo do commit enviado; `Promise.all` permanece no motor. O
[patch exploratório](evidence/source-scheduling-rejected-20261110.patch), aplicável
somente a um checkout de `e5a1fa52`, preserva a última variante para reprodução.
O relatório do benchmark agora entende os tempos de espera presentes nos traces
dessas experiências e continua compatível com traces anteriores.

A melhoria efetivamente mantida retira duas leituras redundantes:

- As datas `createdAt` das importações já carregadas no escopo são anexadas aos
  períodos, eliminando a segunda leitura de `PontoImport`. Isso abrange o cálculo
  financeiro, a carga de horas alocadas usada no Efetivo e o diagnóstico mensal.
  A escolha da planilha que prevalece continua baseada na criação da importação,
  inclusive quando a ordem de criação das linhas de resumo é diferente.
- A listagem completa/resumida pede ao cálculo os nomes da mesma lista de
  funcionários ignorados que ele já consulta por ID. A rota reutiliza essa
  leitura ao filtrar pendências, sem buscar a lista novamente. Os dados extras
  são internos e não entram no JSON público; chamadas ao motor sem essa opção
  mantêm o contrato anterior. A conciliação conserva seu caminho independente.

Não há cache novo entre requisições, mudança de pool, índice, migration ou regra
financeira. A próxima requisição relê importações e marcações de ignorados.
A regressão PostgreSQL inclui duas importações sobrepostas com ordens de criação
contrárias, valida a hora adicional da planilha mais recente e a leitura explícita
da importação anterior. As três funções reutilizam as datas; a opção de metadados
é comparada com o cálculo completo padrão. Outra regressão conta uma única busca
de ignorados, verifica sua atualização nas três projeções e confirma que a
resposta pública não contém os metadados internos.

Também foram comparados oito resultados completos com o backend arquivado de
`e5a1fa52`, em processos separados e exatamente no mesmo banco: cálculo por import,
cálculo consolidado, horas alocadas, diagnóstico mensal, detalhe individual,
grupo, divisão e grupo sem custos individuais/categorias administrativas. A
igualdade foi mantida nas duas fases, antes e depois de alterar cargo, salário
e horas. Nas leituras diretas, a data reutilizada retirou uma consulta por cálculo
de ponto/horas/diagnóstico; a segunda redução ocorre na montagem HTTP da listagem.

O ensaio aceito foi repetido com o cenário distribuído entre membros, pool oito,
concorrência quatro e PostgreSQL 16 com uma CPU/768 MiB. Cada coorte teve 800
respostas aquecidas (cem por rota/perfil), oito primeiras respostas em processos
novos, oito aquecimentos e 16 leituras após escrita. As **832 respostas de cada
coorte foram 200**, com oito negativas esperadas separadas, sem interrupções.

| Superfície aquecida | Referência → continuação local: consultas medianas | Maior JSON nas duas versões |
| --- | ---: | ---: |
| Cards | 11 → 11 | 7.021 B |
| Detalhe individual | 53–54 → 53–54 | 302.068 B |
| Grupo | 53–54 → 53–54 | 442.319 B |
| Tabela de custos do ponto | 38 → 36 | 20.447 B |

A redução verificável do ponto é de **duas consultas por resposta (5,3%)**,
confirmada nas duas coortes do candidato. Na repetição final, foram observados:

| p95 cliente aquecido, administrador / visualizador | Referência | Continuação local |
| --- | ---: | ---: |
| Detalhe individual | 293,9 / 342,6 ms | 330,9 / 328,0 ms |
| Grupo | 442,7 / 531,6 ms | 383,8 / 447,6 ms |
| Ponto | 307,9 / 254,7 ms | 244,2 / 212,1 ms |

As latências variaram entre coortes. Uma referência anterior da mesma rodada
observou p95 de 1.026,0/1.391,1 ms no detalhe e 1.140,8/770,0 ms no ponto;
os dados foram preservados. O host da API não foi isolado. As medições sequenciais
não permitem atribuir as diferenças de p95 às duas consultas removidas, nem
afirmar melhora uniforme: o detalhe do administrador ficou mais lento na repetição
final. Não há novo aceite geral de latência ou comparação estatística pareada.

| Pool aquecido na repetição final | Referência | Continuação local |
| --- | ---: | ---: |
| Amostras sem fila / total | 616 / 2.319 | 621 / 2.131 |
| Proporção sem fila | 26,6% | 29,1% |
| Pico de consultas esperando | 41 | 43 |
| Maior sequência observada com fila | 453,2 ms | 337,4 ms |

**A meta de 95% sem fila continua pendente.** Não houve sequência observada acima
de cinco segundos. No candidato, o máximo por requisição permaneceu em 18 no
detalhe e 14 no grupo; no ponto, passou de 17 para 16. São consultas submetidas,
incluindo espera no pool. As leituras após escrita terminaram em até 898,6 ms,
contados após confirmação e preparo da coleta; os cards mantêm sua expiração
normal. A coleta não inclui Nginx, TLS, navegador ou produção; uma amostra fria
por rota/perfil não permite p95 nem fecha a redução fria geral de 50%.

As [evidências da continuação e das experiências descartadas](evidence/performance-point-metadata-20261110.json)
guardam todas as coortes, amostras numéricas, configurações e hashes do código.
Validação local final: **2.769 testes de backend aprovados e 42 ignorados**, sem
falhas ou cancelamentos, com quatro processos de teste para limitar a carga no
host. Também passaram os seis contratos do ensaio HTTP, a regressão de ponto/grupos,
a regressão de motor/importações sobrepostas e os quatro testes de projeções com
PostgreSQL real. Sintaxe, arquitetura, aplicação do patch exploratório somente
à referência e consistência/privacidade das evidências foram verificadas.
O banco descartável foi removido ao concluir a validação. Não houve alteração
de frontend; o CI de `e5a1fa52` já aprovou testes, build, lint, orçamentos e navegador.

Os próximos passos permanecem a redução do trabalho/caminho crítico sem piorar
o HTTP, a meta fria geral, o aceite publicado e as séries de 24 h/sete dias.
A política de retenção está pendente e backups seguem adiados. Não houve
execução em produção ou mudança na estratégia de backup.

### Catálogo de cargos e worktree de performance — continuação local de 10/11

O trabalho anterior foi registrado em **`be1fad15`**
(`perf: reutilizar metadados de importações e exclusões do ponto`) e enviado para
`origin/fix/page-loading-performance`. O CI desse commit foi disparado manualmente
e seus **11 jobs passaram**, incluindo navegador, orçamentos, PostgreSQL e Docker:
[execução do CI](https://github.com/pedro-pn/filtroAPP/actions/runs/42877088168).

A branch passou para `/home/relat/apps/filtroAPP-performance`; a pasta original
`/home/relat/apps/filtroAPP-main` voltou para `main`, em `3db7e76f`.
Os arquivos locais preexistentes e as alterações de outra frente que surgiram na
`main` durante a continuação foram preservados. As dependências de backend e o
cliente Prisma foram instalados/gerados dentro da nova worktree, com diretório
`node_modules` independente. A implementação desta seção foi posteriormente
registrada em **`61010fcd`**, ainda local e sem push. O CI acima valida somente
`be1fad15`; `61010fcd` e sua continuação precisam de novo CI após o envio.

A próxima retirada de trabalho redundante reutiliza o catálogo de cargos que o
resolvedor de parâmetros de custo já carrega:

- O custo estimado de RDO, tanto individual quanto compartilhado nos grupos,
  busca os IDs do cargo atual e do histórico e resolve seus nomes pelo mesmo
  catálogo. Duas leituras relacionais repetidas de `JobRole` são eliminadas.
- A carga de horas alocadas usada no Efetivo e o diagnóstico mensal fazem o
  mesmo reaproveitamento. Cada um passa de três para uma consulta de `JobRole`.
- Um helper puro compartilhado preserva datas de vigência, ordem do histórico,
  nomes de cargos sem perfil de custo e a exclusão manual da simulação. Relações
  fornecidas por adaptadores antigos continuam aceitas quando não há ID; uma
  linha sem identificador no catálogo não substitui o cargo desse adaptador.
  Os objetos de entrada não são alterados.
- O cálculo principal do ponto, que já fazia esse reaproveitamento, usa o mesmo
  helper. A listagem mantém suas 36 consultas. O catálogo dos grupos continua
  sob demanda e pertence a uma única requisição, com as mesmas verificações
  de projeto, acesso, categorias e divisão.

Não houve mudança de fórmula financeira, ordem de seleção dos relatórios/equipe,
cache entre requisições, limite de concorrência, pool, índice ou migration.

Foram comparados oito resultados completos normalizados com o backend arquivado
de `be1fad15`, em processos separados lendo exatamente as mesmas linhas no
PostgreSQL: ponto por importação, ponto consolidado, horas alocadas, diagnóstico
mensal, detalhe individual, grupo, divisão e grupo sem custos individuais ou
categorias administrativas. A igualdade foi mantida antes e depois de alterar
nome de cargo, salário e horas de RDO. O cenário inclui histórico sem perfil,
importações sobrepostas, pessoa fora do ponto, horas planejadas e turnos diurno
e noturno. Nas leituras diretas, horas alocadas passaram de 27 para 25 consultas;
diagnóstico, de 31 para 29; detalhe/grupo/divisão também retiraram duas consultas.
Os outros três fluxos mantiveram a contagem anterior.

O ensaio HTTP foi repetido nas ordens referência → candidato e candidato →
referência, sem testes ou outro benchmark desta tarefa em paralelo à medição.
O host da API não foi isolado. O PostgreSQL 16 descartável teve uma CPU/768 MiB;
a API usou pool oito e concorrência quatro. O cenário distribui 1.203 relatórios
e 4.802 serviços entre os projetos, com 21 colaboradores, 297 linhas de escopo
e quatro sessões autenticadas.

Cada coorte teve **832 respostas 200**, sem interrupções: 800 aquecidas, oito
primeiras respostas em processos novos, oito aquecimentos e 16 leituras após
escrita. Houve oito negativas de autenticação/módulo esperadas por coorte,
separadas dessas respostas. As quatro coortes totalizam **3.328 respostas
medidas**, preservadas nas evidências.

| Superfície aquecida | Referência → continuação local: consultas medianas | Maior JSON nas duas versões |
| --- | ---: | ---: |
| Cards | 11 → 11 | 7.021 B |
| Detalhe individual | 53–54 → 51–52 | 302.068 B |
| Grupo | 53–54 → 51–52 | 442.319 B |
| Tabela de custos do ponto | 36 → 36 | 20.447 B |

A redução de **duas consultas por resposta de detalhe/grupo (3,7–3,8%)** foi
confirmada nas duas coortes do candidato. Os tamanhos máximos das respostas
permaneceram iguais. As latências observadas foram:

| p95 cliente aquecido, administrador / visualizador | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Detalhe individual | 286,6 / 352,4 ms | 336,5 / 379,4 ms | 350,9 / 357,6 ms | 439,4 / 479,8 ms |
| Grupo | 386,0 / 451,4 ms | 459,8 / 539,1 ms | 472,2 / 602,7 ms | 596,8 / 640,2 ms |
| Ponto | 298,3 / 229,0 ms | 367,8 / 284,7 ms | 371,6 / 315,4 ms | 350,2 / 301,6 ms |

O primeiro par apresentou latências maiores no candidato, inclusive nas rotas sem
alteração de consultas; no segundo, detalhe e grupo ficaram mais rápidos que a
referência posterior. Isso não demonstra ganho causal nem uma regressão isolada
da alteração. **Não há novo aceite de p95**: o ganho comprovado é a retirada de
leituras redundantes com paridade completa dos resultados.

| Pool aquecido | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Amostras sem fila / total | 654 / 2.257 | 662 / 2.369 | 682 / 2.408 | 725 / 2.542 |
| Proporção sem fila | 29,0% | 27,9% | 28,3% | 28,5% |
| Pico de consultas esperando | 42 | 44 | 36 | 41 |
| Maior sequência observada com fila | 311,5 ms | 318,2 ms | 395,8 ms | 540,6 ms |

A meta de **95% sem fila permanece pendente**. Nenhuma coorte observou sequência
com fila acima de cinco segundos. Os picos por requisição permaneceram em 18 no
detalhe, 14 no grupo e 16 no ponto, contando consultas submetidas e ainda não
concluídas, inclusive espera no pool. No candidato, as leituras após escrita
terminaram em até 1.025,4 ms, a partir da confirmação/preparo da coleta; os cards
mantêm a expiração normal. Uma amostra por rota/perfil em processo novo não
permite p95 frio nem fecha a redução fria geral. Não foram medidos proxy, TLS,
renderização ou produção nesta continuação.

As [evidências do catálogo de cargos](evidence/performance-role-catalog-20261110.json)
guardam as quatro coortes com todas as amostras numéricas, resultados da paridade,
configuração e hashes dos arquivos. A validação final teve **2.770 testes de
backend aprovados e 42 ignorados**, sem falhas ou cancelamentos. Também passaram
os seis contratos HTTP, a regressão de ponto/grupos, a regressão de motor com
importações sobrepostas e os quatro testes de projeção com PostgreSQL real.
Os testes focados iniciais aprovaram 25 casos; o caso final do adaptador sem ID
também passou na suíte completa. Sintaxe, arquitetura, diff e integridade das
evidências foram verificados. O banco descartável foi removido após a validação.

Continuam pendentes a pressão do pool/caminho crítico, a meta fria geral, os
aceites publicados e as séries de 24 h/sete dias. Retenção depende de política
aprovada; **backups seguem adiados**. A próxima rodada local deve priorizar o
trabalho redundante restante nas 36 consultas do ponto e nas 51–52 do detalhe,
medindo o HTTP completo sem adotar os limites de fontes já rejeitados.

### Fontes oficiais do Efetivo sob demanda — continuação local de 10/11

A etapa anterior foi registrada no commit **`61010fcd`**
(`perf: compartilhar cargos no custeio de RDO e horas alocadas`), na worktree
`/home/relat/apps/filtroAPP-performance`. A etapa das fontes oficiais descrita
nesta seção foi posteriormente registrada em **`ae2caee9`**, também local e sem
push. A pasta original e suas alterações de outra frente não foram modificadas
por esta tarefa.

O perfil SQL da referência mostrou seis consultas para montar as fontes oficiais
do Efetivo: alocações, ciclos individuais, missões relacionadas, ciclos gerais,
planos e outra leitura de missões para excluir suas janelas legadas. Mesmo sem
alocações, o Prisma emitia as consultas relacionais vazias. O contexto de custos
passa a carregar alocações e o catálogo completo de missões confirmadas uma vez,
com o mesmo filtro de plano oficial ativo e registros não excluídos. Os ciclos
e o estado real dos planos são lidos em lotes somente para as alocações retornadas.

O conjunto usado para excluir janelas legadas continua incluindo **missões
confirmadas sem nenhuma alocação**. Os ciclos individuais, ciclos gerais
herdados, datas individuais, pausas e finais abertos seguem para as funções
existentes que decidem sua precedência. Planos são efetivamente consultados;
seu estado não é presumido a partir do filtro inicial. A ausência de missão ou
plano entre leituras não fabrica uma janela elegível, e falhas na consulta de
ciclos rejeitam a carga completa. Uma nova requisição relê as fontes.

O leitor exportado usado pela conferência semanal mantém a mesma seleção e
contrato; somente o predicado passa a ser compartilhado. Não há mudança de
fórmula financeira, API pública, cache entre requisições, limite de fontes,
pool, índice ou migration. O reaproveitamento abrange o cálculo de custos,
a carga de horas alocadas do Efetivo e o diagnóstico mensal.

Os oito resultados completos normalizados foram comparados com o backend
arquivado de `61010fcd`, em processos separados lendo exatamente as mesmas
linhas no PostgreSQL. As cinco fases foram: cenário inicial, alterações de
cargo/salário/horas, inclusão das alocações oficiais, alterações de ciclos e
cancelamento de missão, e desativação do plano oficial. Os **40 pares de
resultados permaneceram idênticos**. Os testes também cobrem alocações/missões
excluídas, missão em rascunho, cenário, plano inativo, missão sem alocações e
atualização dos dados na próxima leitura.

| Cálculo direto | Sem alocações oficiais: referência → candidato | Com alocações oficiais: referência → candidato |
| --- | ---: | ---: |
| Custos por importação ou consolidados | 30 → 26 | 30 → 29 |
| Horas alocadas | 25 → 21 | 25 → 24 |
| Diagnóstico mensal | 29 → 25 | 29 → 28 |
| Primeiro detalhe com cálculo de custos | 90 → 86 | 90 → 89 |

Os demais detalhes de grupo/divisão na comparação direta usam o cache normal
de custos já preenchido pelo primeiro detalhe; suas contagens não mudaram.
Os números acima são chamadas de banco do serviço, sem autenticação HTTP.

O ensaio HTTP usou PostgreSQL 16 descartável com uma CPU/768 MiB, pool oito,
concorrência quatro, RDOs distribuídos nos dois membros e projeção resumida do
ponto. A ordem referência → candidato foi repetida como candidato → referência,
sem testes ou outro benchmark desta tarefa durante a medição. Cada coorte teve
832 respostas 200, sem interrupções: 800 aquecidas, oito primeiras respostas
em processos novos, oito aquecimentos e 16 leituras após escrita. O total foi
de **3.328 respostas medidas**, com oito negativas de acesso esperadas separadas
por coorte. O host da API não foi isolado.

| Superfície HTTP aquecida | Referência → candidato: consultas medianas | Maior JSON nas duas versões |
| --- | ---: | ---: |
| Cards | 11 → 11 | 7.021 B |
| Detalhe individual | 51–52 → 51–52 | 302.068 B |
| Grupo | 51–52 → 51–52 | 442.319 B |
| Tabela de custos do ponto | 36 → 32 | 20.447 B |

A redução de **quatro consultas por resposta do ponto (11,1%)** foi confirmada
nas duas coortes do candidato. Esse fixture HTTP não tem alocações oficiais;
o ganho com alocações ativas foi verificado separadamente por paridade e contagem
no PostgreSQL, como uma consulta por cálculo. Os tamanhos máximos das respostas
permaneceram iguais. Não se atribui a redução de quatro consultas a todos os
cenários do app.

| p95 cliente aquecido, administrador / visualizador | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Detalhe individual | 241,2 / 283,0 ms | 223,1 / 256,4 ms | 218,3 / 274,9 ms | 243,3 / 284,1 ms |
| Grupo | 338,0 / 388,3 ms | 324,8 / 398,3 ms | 330,5 / 406,1 ms | 333,2 / 401,8 ms |
| Ponto | 261,6 / 227,4 ms | 264,9 / 218,1 ms | 277,7 / 227,8 ms | 272,4 / 231,1 ms |

Houve variação nos dois sentidos: o detalhe ficou mais rápido nessas coortes,
mas o ponto do administrador e o grupo do visualizador não mostraram redução
uniforme. Não há comparação estatística pareada ou novo aceite geral de p95;
o ganho comprovado é a retirada de trabalho redundante, preservando os resultados.

| Pool aquecido | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Amostras sem fila / total | 582 / 2.055 | 619 / 2.020 | 614 / 2.007 | 574 / 2.053 |
| Proporção sem fila | 28,3% | 30,6% | 30,6% | 28,0% |
| Pico de consultas esperando | 44 | 42 | 35 | 41 |
| Maior sequência observada com fila | 325,8 ms | 329,7 ms | 306,8 ms | 307,8 ms |

A meta de **95% sem fila permanece pendente**. Nenhuma coorte observou sequência
com fila acima de cinco segundos. O pico por requisição no ponto passou de
16 para 15 consultas submetidas e ainda não concluídas, incluindo espera no
pool; os máximos de detalhe/grupo permaneceram em 18/14. No candidato, as
leituras após escrita terminaram em até 743,7 ms, contados após confirmação e
preparo da coleta. Cards mantêm a expiração normal. A coleta não inclui proxy,
TLS, renderização ou produção; uma amostra fria por rota/perfil não permite
p95 nem o aceite da redução fria geral de 50%.

As [evidências das fontes oficiais](evidence/performance-effective-sources-20261110.json)
preservam as quatro coortes, todas as amostras numéricas, as cinco fases de
paridade e os hashes dos seis arquivos de implementação/fixture/testes.
Validação final: **2.773 testes de backend aprovados e 42 ignorados**, sem falhas
ou cancelamentos. A execução serial com PostgreSQL real aprovou os 12 testes
de contratos HTTP, projeções, ponto/grupos e motor/fontes. Sintaxe, arquitetura,
diff e integridade/privacidade das evidências foram verificados. O banco
descartável e seus volumes foram removidos após a validação.

Os próximos passos continuam sendo o trabalho/caminho crítico restantes da
tabela de custos e do detalhe, a pressão do pool, a meta fria geral e os
aceites publicados. O novo commit e a continuação precisam de CI após envio;
o último CI remoto verificado continua sendo o de `be1fad15`. Retenção depende
da política aprovada; **backups permanecem adiados**. Não houve publicação ou
alteração em produção.

### Classificação dos eixos de custo — continuação local de 10/11

A etapa das fontes oficiais foi registrada em **`ae2caee9`**
(`perf: carregar fontes oficiais do Efetivo sob demanda`). A implementação
continua exclusivamente em `/home/relat/apps/filtroAPP-performance`, na branch
`fix/page-loading-performance`. A etapa desta seção foi posteriormente registrada
em **`3d4971eb`**, também local e sem push.

O cálculo executava novamente a classificação das mesmas horas para os eixos
contábil e analítico dentro de cada segmento de mês/cargo/parâmetros. A nova
função monta o par e reutiliza o resultado completo da primeira classificação
quando todas as decisões são iguais entre os eixos. Os consumidores leem esse
resultado; os mapas e trilhas de entrada não são alterados.

Três decisões exigem pesos diferentes: execução compartilhada, divisão manual
entre projetos e divisão confirmada na conferência semanal. Se qualquer dia do
segmento tiver uma delas, o segmento inteiro conserva as duas classificações,
incluindo seu contexto original de vizinhos para viagem. A classificação de
auditoria do período continua independente; ela não é reaproveitada em outros
recortes de mês, cargo ou vigência dos parâmetros. As fórmulas de custo de cada
eixo permanecem separadas.

O teste focado verifica o resultado completo dos dois eixos e confirma uma única
resolução de etiquetas/vizinhos nos casos equivalentes. Também cobre múltiplas
etiquetas normais com rateio, consolidação no projeto principal, pendências,
dias vazios e folga conferida. No PostgreSQL real, a execução compartilhada,
a divisão manual e a divisão confirmada preservam soma dos pesos contábeis
igual a um e soma dos pesos analíticos igual a dois para os dois projetos.

Foram comparados oito resultados completos normalizados com o backend arquivado
de `ae2caee9`, em processos separados lendo exatamente as mesmas linhas: ponto
explícito/consolidado, horas alocadas, diagnóstico, detalhe, grupo, divisão e grupo
sem custos individuais/categorias administrativas. As nove fases incluem as
alterações de cargo/salário/horas, alocações oficiais/ciclos, cancelamento,
desativação de plano, execução compartilhada, ajustes manuais, conferência e
consolidação. Os **72 pares de resultados permaneceram idênticos**.

O benchmark de serviço agora registra `process.cpuUsage()` na janela de cada
cálculo, além do tempo de parede. São observações do processo Node/Prisma,
incluindo trabalho em segundo plano executado nessa janela; não medem CPU do
PostgreSQL nem atribuem todo o consumo à classificação. A janela começa depois
dos imports explícitos. A soma de CPU pode superar a duração de parede quando
threads trabalham ao mesmo tempo. A leitura anterior de sessão continua sendo
um `SELECT`, sem autenticação HTTP.

Foram executados cinco pares por modo/cenário, alternando a ordem dos backends
nos mesmos dados, com 1.203 relatórios, 21 colaboradores, 500 preferências de
projeto e dois ou 4.802 serviços. Houve comparações separadas contra `ae2caee9`
e contra o início do plano (`3db7e76f`): **60 pares completos iguais**, totalizando
120 cálculos medidos. Não houve testes ou outro benchmark desta tarefa durante
essas medições; o host da API não foi isolado.

| Serviço: referência `ae2caee9` → continuação | Parede mediana | CPU mediana do processo |
| --- | ---: | ---: |
| Poucos serviços, aquecido | 62,2 → 67,9 ms | 100,3 → 108,8 ms |
| Poucos serviços, processo novo | 299,1 → 306,7 ms | 661,9 → 661,1 ms |
| Poucos serviços, após SELECT de sessão | 211,5 → 197,6 ms | 416,9 → 401,1 ms |
| Denso, aquecido | 74,3 → 65,4 ms | 118,8 → 107,1 ms |
| Denso, processo novo | 308,9 → 306,8 ms | 711,0 → 703,7 ms |
| Denso, após SELECT de sessão | 192,2 → 204,7 ms | 416,4 → 424,7 ms |

Não há redução uniforme de CPU ou latência nesses ensaios. O ganho comprovado
é eliminar uma segunda passagem de classificação nos segmentos equivalentes,
com resultados preservados. A nova comparação cumulativa de serviço frio foi:

| Cenário em processo novo | Início do plano `3db7e76f` | Continuação local | Redução observada |
| --- | ---: | ---: | ---: |
| Poucos serviços | 535,5 ms | 315,8 ms | 41,0% |
| Denso | 609,7 ms | 326,7 ms | 46,4% |

A meta fria geral de **50% continua pendente**. A comparação anterior havia
observado 40,6%/50,1%; as coortes e a inicialização variam, sem evidência para
atribuir essa diferença a uma alteração isolada. Essas medições são de serviço,
com páginas do banco aquecidas e imports/boot fora da duração, sem aceite HTTP
publicado.

O ensaio HTTP usou o mesmo cenário distribuído entre membros, PostgreSQL 16
descartável com uma CPU/768 MiB, pool oito e concorrência quatro. A ordem
referência → candidato foi repetida como candidato → referência. Cada coorte
teve 832 respostas 200: 800 aquecidas, oito primeiras respostas em processos
novos, oito aquecimentos e 16 leituras após escrita. Houve oito negativas de
acesso esperadas por coorte, separadas das **3.328 respostas medidas**, sem
interrupções. Consultas e JSON permaneceram iguais: cards com 11 chamadas e
máximo 7.021 B; detalhe/grupo com 51–52 chamadas e 302.068/442.319 B; ponto
resumido com 32 chamadas e 20.447 B no fixture sem alocações oficiais.

| p95 cliente aquecido, administrador / visualizador | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Detalhe individual | 260,3 / 272,7 ms | 240,5 / 253,2 ms | 210,8 / 280,3 ms | 232,0 / 256,3 ms |
| Grupo | 333,3 / 400,5 ms | 328,1 / 412,5 ms | 347,2 / 392,0 ms | 325,3 / 388,6 ms |
| Ponto | 266,7 / 235,9 ms | 266,9 / 235,1 ms | 272,5 / 251,6 ms | 264,7 / 229,7 ms |

O detalhe do administrador ficou mais rápido nessas coortes, mas houve variação
nos demais casos, incluindo maior p95 do ponto na ordem inversa. Não há novo
aceite geral nem afirmação de ganho causal de latência.

| Pool aquecido | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Amostras sem fila / total | 610 / 2.032 | 622 / 2.057 | 613 / 2.020 | 626 / 2.031 |
| Proporção sem fila | 30,0% | 30,2% | 30,3% | 30,8% |
| Pico de consultas esperando | 44 | 41 | 36 | 41 |
| Maior sequência observada com fila | 313,6 ms | 290,5 ms | 320,7 ms | 328,7 ms |

A meta de **95% sem fila permanece pendente**. Não houve sequência observada
com fila acima de cinco segundos; os picos por requisição seguiram em 18 no
detalhe, 14 no grupo e 15 no ponto, incluindo consultas esperando no pool.
No candidato, as leituras após escrita terminaram em até 826,1 ms, a partir da
confirmação/preparo da coleta; cards mantêm sua expiração normal. Não foram
medidos proxy, TLS, renderização ou produção; uma amostra fria por rota/perfil
não permite p95.

As [evidências dos eixos de custo](evidence/performance-cost-axes-20261110.json)
guardam as quatro coortes HTTP com todas as amostras numéricas, os quatro
ensaios de serviço/CPU, as nove fases de paridade e hashes dos quatro arquivos
de implementação/benchmark/testes. Validação final: **2.776 testes de backend
aprovados e 42 ignorados**, sem falhas ou cancelamentos; também passaram os
12 contratos/regressões HTTP/PostgreSQL e os 70 testes focados. Sintaxe,
arquitetura, diff e integridade/privacidade das evidências foram verificados.
O banco descartável e seus volumes foram removidos após a validação.

Continuam pendentes o trabalho/caminho crítico e a pressão do pool, a meta fria
geral, o envio/CI dos commits locais e os aceites publicados de HTTP/conteúdo
útil/LCP e séries de 24 h/sete dias. O último CI remoto verificado ainda é o
de `be1fad15`. Retenção depende de política aprovada; **backups seguem adiados**.
Não houve publicação ou alteração em produção.

### Vínculos nominais dos relatórios — continuação local de 10/11

A etapa dos eixos de custo foi registrada em **`3d4971eb`**
(`perf: reutilizar classificações equivalentes dos eixos de custo`). A continuação
desta seção foi registrada em **`5a82aa25`** e enviada com os três commits anteriores
pela worktree `filtroAPP-performance`, branch `fix/page-loading-performance`.
Os 11 jobs do [CI dessa revisão](https://github.com/pedro-pn/filtroAPP/actions/runs/42902936906)
foram aprovados. Os resultados abaixo pertencem àquela etapa; a seção de leituras
versionadas registra a continuação mais recente.

As fontes do custo liam os colaboradores vinculados aos relatórios duas vezes:
na seleção do período/RDOs históricos e na seleção anual offshore. A nova leitura
reúne os IDs retornados por essas duas consultas e busca os vínculos uma vez,
com `reportId = ANY(array parametrizado::text[])`. O SQL tem **um parâmetro**,
em lugar de até 1.203 no cenário denso; o tamanho dos dados enviados no array
continua proporcional ao histórico selecionado. Os IDs são valores vinculados,
sem concatenação em SQL, e vêm das consultas de pais protegidas pelas regras
de acesso a projetos. Fontes vazias dispensam a consulta dos vínculos.

As duas consultas de pais mantêm os predicados e a ordem anteriores; o SQL da
consulta principal de custos tem o mesmo hash da referência em todas as fases
de paridade. Promessas nativas compartilham cada execução Prisma uma vez. A
leitura dos vínculos começa quando ambos os conjuntos de pais estão disponíveis,
em paralelo às demais fontes. Os vínculos são recolocados nas listas originais,
sem mudar a precedência de RDOs empatados ou os critérios de elegibilidade anual.
Não foi criado cache entre requisições nem imposto limite de concorrência.
Pool, índices, migrações e fórmulas financeiras permanecem os anteriores.

Os testes incluem RDOs históricos/futuros, relatórios offshore somente anuais,
relatórios onshore no período, limites exclusivos do mês/ano, exclusões e
fallback por intervalos. Mudanças nos vínculos de RDO e do relatório anual são
observadas na leitura seguinte; falha na fonte interrompe o cálculo. Uma
regressão com PostgreSQL real confirma que IDs de projeto restrito ficam fora
do parâmetro SQL e dos dois conjuntos retornados. O transporte do teste Omni
também passou a encaminhar consultas parametrizadas ao mesmo banco descartável
usado por seus modelos; suas asserções de valores e privacidade foram mantidas.

Foram comparados oito resultados completos normalizados com o backend arquivado
de `3d4971eb`, em processos separados lendo as mesmas linhas: ponto explícito e
consolidado, horas alocadas, diagnóstico, detalhe, grupo, divisão e grupo sem
custos individuais/categorias administrativas. As dez fases cobrem alterações
de cargo/salário/horas, alocações oficiais/ciclos/cancelamento, plano desativado,
compartilhamentos, consolidação e mudanças nos vínculos. Os **80 pares de
resultados permaneceram idênticos**. Horas alocadas e diagnóstico conservam o
caminho de fontes anterior; o cálculo direto de custos elimina uma chamada.

Um protótipo com filtro relacional unificando período/ano também foi medido e
**descartado**. Embora reduzisse chamadas e parâmetros, seu plano repetia a
leitura de 4.802 serviços: execução próxima de 3 ms, contra cerca de 0,4 ms nas
duas leituras anteriores. A versão aceita consulta somente `ReportCollaborator`,
usando os IDs já selecionados; os replays `EXPLAIN ANALYZE` deram 0,408/0,334 ms
nos dois modos, sem nova leitura de relatórios/serviços. Esses replays são
diagnósticos separados, e não a duração SQL das requisições originais. O
[patch do protótipo descartado](evidence/report-rosters-filter-rejected-20261110.patch)
permite reproduzir seu código sobre um checkout limpo de `3d4971eb`; não deve
ser aplicado à versão aceita. Seus ensaios permanecem nas evidências.

O benchmark de serviço fez três pares por modo no cenário denso, alternando a
ordem dos backends nos mesmos dados: 1.203 relatórios, 4.802 serviços e 21
colaboradores. Os **nove pares completos foram iguais**.

| Serviço: referência `3d4971eb` → continuação | Parede mediana | CPU mediana do processo |
| --- | ---: | ---: |
| Aquecido | 85,0 → 60,7 ms | 125,4 → 88,4 ms |
| Processo novo | 319,8 → 286,8 ms | 746,7 → 706,2 ms |
| Após SELECT de sessão | 196,0 → 189,0 ms | 429,5 → 415,6 ms |

São amostras pequenas e sequenciais de serviço, com imports/boot fora da janela
e páginas do banco aquecidas. CPU é a do processo Node/Prisma inteiro, incluindo
threads e trabalho em segundo plano, sem CPU do PostgreSQL. Esses resultados
não estabelecem ganho causal ou aceite geral de latência. A meta fria geral
continua pendente; a última comparação cumulativa contra o início do plano
permanece em 41,0%/46,4%, sem nova medição cumulativa nesta etapa.

O HTTP autenticado foi medido em quatro coortes sequenciais, referência →
candidato e candidato → referência, com PostgreSQL 16 descartável de uma
CPU/768 MiB, pool oito, concorrência quatro, relatórios nos dois membros do
grupo e tabela de custos resumida. Cada coorte teve 832 respostas 200, incluindo
800 aquecidas, oito primeiras respostas em processos novos, oito aquecimentos
e 16 leituras após escrita. Houve oito negativas 401/403 esperadas por coorte,
separadas das **3.328 respostas medidas**, sem interrupções. Não houve testes
ou outro benchmark desta tarefa durante as medições; o host da API não foi isolado.

No fixture sem alocações oficiais, o ponto passou de **32 para 31 chamadas**
medianas, com o mesmo JSON de 20.447 B aquecido. Cards mantiveram 11 chamadas e
máximo aquecido de 7.021 B; detalhe/grupo, 51–52 chamadas e 302.068/442.319 B.
Os picos por requisição seguiram em 18 no detalhe, 14 no grupo e 15 no ponto,
incluindo consultas esperando no pool.

| p95 cliente aquecido, administrador / visualizador | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Cards | 148,4 / 81,1 ms | 152,1 / 72,2 ms | 183,6 / 78,0 ms | 163,7 / 90,1 ms |
| Detalhe individual | 240,6 / 304,5 ms | 244,8 / 277,1 ms | 267,3 / 275,2 ms | 272,9 / 312,0 ms |
| Grupo | 355,8 / 396,8 ms | 333,2 / 429,0 ms | 371,4 / 542,1 ms | 375,0 / 440,4 ms |
| Ponto | 279,7 / 233,4 ms | 282,5 / 241,9 ms | 298,9 / 280,9 ms | 292,4 / 268,9 ms |

Há variações nos dois sentidos, inclusive maior p95 do grupo visualizador no
candidato na ordem inversa. A redução de chamadas está confirmada; **não há
aceite geral de p95**.

| Pool aquecido | Referência inicial | Candidato inicial | Candidato na ordem inversa | Referência na ordem inversa |
| --- | ---: | ---: | ---: | ---: |
| Amostras sem fila / total | 620 / 2.057 | 618 / 2.034 | 633 / 2.041 | 668 / 2.117 |
| Proporção sem fila | 30,1% | 30,4% | 31,0% | 31,6% |
| Pico de consultas esperando | 38 | 42 | 34 | 46 |
| Maior sequência observada com fila | 318,2 ms | 362,9 ms | 397,8 ms | 316,3 ms |

A meta de **95% sem fila permanece pendente**. A amostragem não observou
sequência com fila acima de cinco segundos e não mede espera individual por
consulta. As leituras alteradas após escrita terminaram em até 794,7 ms no
candidato, a partir da confirmação/preparo da coleta; cards mantêm sua expiração
normal. Proxy, TLS, renderização e produção não foram medidos; uma primeira
resposta por rota/perfil não permite p95 frio.

As [evidências dos vínculos nominais](evidence/performance-report-rosters-20261110.json)
guardam as quatro coortes aceitas e as quatro do protótipo descartado, todas as
**6.656 amostras numéricas**, perfis SQL/planos, CPU, paridade e hashes dos cinco
arquivos de implementação/testes. Validação final: **2.778 testes de backend
aprovados e 42 ignorados**, sem falhas/cancelamentos; também passaram os 12
contratos/regressões HTTP/PostgreSQL, 23 testes focados e nove testes Omni.
Sintaxe, arquitetura, diff e integridade/privacidade das evidências foram
verificados. As tabelas de dados sintéticos ficaram vazias antes da remoção do
banco descartável e seus volumes; permaneceram somente cadastros do bootstrap.

Os próximos passos são reduzir trabalho/caminho crítico restantes do custo e do
detalhe e a pressão do pool, atingir a meta fria geral e executar novo CI quando
os commits locais forem enviados. O último CI remoto verificado segue sendo o
de `be1fad15`. Aceites publicados de HTTP/conteúdo útil/LCP, cobertura em dois
navegadores, séries de 24 h/sete dias e política/aplicação de retenção continuam
pendentes. **Backups seguem adiados**. Não houve publicação ou alteração em produção.

### Leituras versionadas, fontes por requisição e operação — 10/11

A referência incremental é `5a82aa25`, já enviada e com 11 jobs de CI aprovados.
Esta continuação foi feita exclusivamente na worktree `filtroAPP-performance`.
Não houve publicação, operação em servidores ou alteração de backups.
As [evidências completas](evidence/performance-versioned-reads-20261110.json)
identificam 43 arquivos de código/teste/configuração por SHA256, congelados antes
das medições finais, e guardam todas as amostras numéricas.

**Implementação.** GET/HEAD compartilham promessas de catálogos durante a própria
requisição, por cliente e escopo. Escritas não herdam esse contexto. Categorias
manuais/administrativas/químicas usam uma leitura combinada; cargos das duas
fontes de horas previstas são lidos uma vez, somente quando necessários. Custos
manuais vazios dispensam Project/User. A autenticação continua consultando sessão,
usuário, papéis e vínculo atual, mas elimina as duas consultas de relações vazias
quando não há colaborador vinculado (cinco para três SQLs nesse caso).
A auditoria contábil só é reutilizada no cálculo mensal se todos os objetos de dias,
sua ordem e as seis referências de contexto forem idênticos; recortes, parâmetros
e eixos com compartilhamento conservam sua classificação própria.

O novo cache opt-in cobre os DTOs de detalhe individual/grupo e colaboradores do
ponto. Autenticação e validação precedem seu uso; usuário, escopo, permissões,
filtros e divisão compõem a chave. Cada consumidor recebe uma cópia independente.
Limites: 32 entradas, 16 MiB concluídos, 2 MiB por resposta e TTL de até 15 s.
`ACOMPANHAMENTO_READ_CACHE_ENABLED=false` permanece o padrão. As medições abaixo
habilitam explicitamente o recurso; não representam ganho já publicado.

A migration `20261110230000_performance_read_revision` registra alterações das
187 tabelas explicitamente relacionadas no SQL. Cada backend PostgreSQL escritor
incrementa sua própria linha na mesma transação dos dados. A leitura usa o hash do
vetor inteiro confirmado, incluindo identidade do servidor/banco e dia; não usa
MAX(id), Project.updatedAt nem um contador global bloqueado por toda escrita.
Commit tardio, rollback e duas conexões escritoras independentes foram testados.
Sessões, jobs e a telemetria operacional excluída não são fontes dos três DTOs.
Os caches intermediários e de categorias salariais também respeitam a versão;
falha na revisão retorna 503, inclusive havendo resposta antiga no cache.

O gate PostgreSQL exige cobertura dos triggers para novas tabelas Prisma.
A compactação dos marcadores oferece dry-run e um lote limitado, preserva PIDs
ativos e avança a época na mesma transação da remoção, evitando repetir uma versão
antiga. Não foi criado agendamento. O catálogo da API classifica a tabela nova
como infraestrutura interna, sem campo/escopo/endpoint externo.

**Concorrência e atualização.** Seis coortes sequenciais: referência/candidato,
candidato/referência e referência/candidato com uma conexão separada atualizando
JobRun a cada segundo. Cada coorte tem 832 respostas medidas: 800 aquecidas
(100 por rota/perfil), oito de processo novo, oito de aquecimento e 16 após escrita;
oito negativas de acesso são verificadas separadamente. Foram 4.992 respostas
medidas nesta versão final. Pool de oito, concorrência quatro, PostgreSQL 16
com uma CPU/768 MiB, dois perfis e duas sessões por perfil, grupo com RDOs nos dois
membros e ponto resumido. Nenhum teste ou outro ensaio desta tarefa compartilhou
as janelas cronometradas; o host da API não foi isolado.

| Coorte | Pool aquecido sem fila | Todas as fases observadas sem fila | Pico aquecido |
| --- | ---: | ---: | ---: |
| Referência, ida | 597/1868 (32.0%) | 34.1% | 46 |
| Candidato, ida | 277/277 (100.0%) | 90.6% | 0 |
| Candidato, ordem inversa | 281/281 (100.0%) | 89.7% | 0 |
| Referência, ordem inversa | 600/1864 (32.2%) | 34.5% | 42 |
| Referência + JobRun | 601/1855 (32.4%) | 34.6% | 40 |
| Candidato + JobRun | 289/289 (100.0%) | 89.7% | 0 |

O aquecido atingiu 100% nas três coortes do candidato. **O agregado das fases
frias/aquecidas/pós-gravação continua abaixo dos 95%; T06 permanece parcial.**
Após escrita, as rajadas ainda atingiram fila. Não se usa a duração menor da fase
quente como prova de uma janela representativa com muitas alterações de fontes.
Um protótipo anterior com `pg_current_snapshot()` invalidava também por sondagens
de jobs: passou em repouso, mas caiu a 80,3% sem fila no aquecido com JobRun.
Foi descartado; suas coortes são exploratórias e não a versão aceita.

Nas coortes finais, as medianas SQL aquecidas foram: cards 11→9, detalhe 51–52→7,
grupo 51–52→4 e ponto resumido 31→4. O p95 cliente do candidato ficou entre 15,8
e 23,3 ms; as metas HTTP aquecidas passaram nesse laboratório. As gravações do
worker, sem mudar Project.updatedAt, apareceram na próxima leitura de detalhe,
grupo e ponto, nas quatro sessões, em até 474,9 ms após confirmação/preparo da
coleta. Cards conservam sua expiração normal. Isso não mede TLS, proxy, navegador
ou produção; uma amostra fria por rota/perfil não estabelece p95 frio.

O logger de performance agora registra intervalos globais do pool uma única vez,
mesmo com requests sobrepostos. O relatório calcula fração sem fila, pico e maior
sequência observada. Logs antigos sem essas amostras não aceitam a meta do pool.

**Paridade e primeira leitura.** Onze saídas completas em onze estados tiveram
igualdade exata (121 pares), incluindo mudanças de cargos, categorias, custos
manuais, vínculos de RDO e fontes oficiais; recortes e compartilhamentos
contábil/analítico continuam cobertos. Na primeira fase direta, detalhe passou de
84 para 75 chamadas, grupo de 63 para 58, divisão de 44 para 40 e filtros de
categorias de 11 para seis. Não são os mesmos contadores do HTTP aquecido.

Cinco pares de serviço por modo/cenário contra `3db7e76f` confirmaram mais 30
resultados completos iguais, alternando a ordem. Tempos excluem importação/boot,
usam páginas do banco aquecidas e não são HTTP. Após sessão significa um SELECT:

| Cenário | Modo | Antes | Depois | Redução |
| --- | --- | ---: | ---: | ---: |
| Poucos serviços | Aquecido | 236.9 ms | 45.5 ms | 80.8% |
| Poucos serviços | Processo novo | 448.6 ms | 247.7 ms | 44.8% |
| Poucos serviços | Após SELECT de sessão | 353.1 ms | 132.3 ms | 62.5% |
| Denso | Aquecido | 234.6 ms | 44.6 ms | 81.0% |
| Denso | Processo novo | 467.3 ms | 239.9 ms | 48.7% |
| Denso | Após SELECT de sessão | 365.1 ms | 135.4 ms | 62.9% |

**A meta fria geral de 50% não foi atingida.** Dois protótipos de transporte SQL
foram rejeitados por não trazerem ganho consistente; não foram incorporados ao
app. O perfil Inspector é diagnóstico com overhead, distinto do tempo de aceite;
não se atribui toda a parcela fixa a uma causa específica. Não houve mudança de
pool, limite de concorrência ou novo índice de negócio para obter esses números.

**Operação e validação.** `--only-job-runs` separa preview/aplicação dos jobs da
retenção geral, exige prazo explícito e preserva falhas, trabalho em andamento e
último sucesso por nome, inclusive empates. O agendamento continua sem política
padrão para JobRun. A definição do prazo permanece pendente; não houve limpeza
publicada. O [roteiro operacional](PERFORMANCE_OPERACAO.md) descreve migration,
habilitação/desativação do flag, coleta de 24 h/sete dias, dois navegadores,
retenção exclusiva e compactação de metadados, sempre com execução manual.

Validação final: **2.797 testes de backend aprovados, 44 ignorados e nenhuma
falha/cancelamento**; **19 contratos PostgreSQL/HTTP aprovados**, sem ignorados.
Arquitetura, sintaxe, diff, integridade das evidências e limpeza das fixtures foram
verificados. O CI desta continuação é verificado após envio e informado no
fechamento. T06 (frio/refresh), T07 (meta fria), política de T10 e aceites publicados
de T01/T03/T04/T05/T06/T08/T09/T12 continuam abertos; **T02 segue adiada**.

### Snapshot mensal e revisão estável — continuação local de 11/11

A referência incremental é **`1c26fa28`**, enviada e com os 11 jobs do
[CI aprovados](https://github.com/pedro-pn/filtroAPP/actions/runs/42918304457).
A continuação foi feita na worktree `filtroAPP-performance`. Não houve operação em
produção/staging, alteração de pool/concorrência, migration adicional ou trabalho
em backups. As [evidências](evidence/performance-monthly-snapshots-20261111.json)
identificam 13 arquivos de código/teste por SHA256, congelados antes dos ensaios.

**Fontes condicionais.** Grupos ativos e dias conferidos mantêm os predicados e a
ordem dos pais. Seus vínculos só são consultados para os IDs realmente retornados.
Na fixture de serviço sem grupos/conferências, isso dispensa dois SELECTs vazios.
Os filhos conservam o escopo do cliente Prisma. Uma falha na leitura dos vínculos
continua rejeitando a operação; não se apresenta uma apropriação parcial como válida.
O mock do relatório mensal foi adaptado ao transporte em duas consultas, mantendo
as verificações de CNPJ, dias conferidos e turno noturno.

**Cálculo mensal compartilhado.** Com o flag de cache existente habilitado,
GET/HEAD que já verificaram a revisão transacional podem compartilhar o cálculo
por revisão, importação e escopo/canal de projetos. Detalhe/grupo e ponto usam o
mesmo resultado canônico; os metadados opcionais de nomes ignorados são projetados
conforme o consumidor. As respostas finais conservam suas chaves por usuário e
permissões. Chamadas sem esse contexto e escritas, inclusive uma escrita aninhada
em leitura verificada, recalculam normalmente.

O armazenamento adicional é limitado a oito entradas/8 MiB, até 2 MiB por entrada
e 15 s. A serialização V8 fica em memória e preserva Map, Date, precisão numérica
e aliases internos; cada consumidor recebe um grafo independente. O decoder
recebe bytes próprios: views de Buffer/TypedArray não podem alterar o armazenamento
ou outro leitor. Erros de carregamento/decodificação são removidos; uma revisão
nova não usa um cálculo antigo, mesmo quando ele ainda está pendente. O contrato
HTTP permanece em JSON e o flag continua desativado por padrão.

O teste com PostgreSQL confirma uma única leitura mensal entre detalhe e ponto,
e novo cálculo após mudança de configuração, sem invalidação manual. A listagem
completa em cache é comparada campo a campo com o cálculo sem cache.

**Revisão do avanço.** A comparação também reproduziu um problema existente:
o banco retornou as mesmas 242 linhas em outra ordem; os demais insumos eram
iguais, os valores publicados não mudavam e o hash do avanço mudava. Isso pode
disparar nova busca de históricos na próxima leitura sem alteração de conteúdo.
O diagnóstico guarda somente contagens, igualdade dos insumos e hashes.

A revisão agora usa chaves JSON canônicas e trata explicitamente a coleção de
serviços realizados como sem ordem para o digest. Escopos planejados, histórico
manual e arrays internos das medições mantêm sua ordem. Os cálculos recebem as
mesmas entradas, sem reordenação. Alterações reais, finalização, data, quantidade
de linhas, valores e ordem das coleções significativas continuam mudando o token.
Projeto e divisão têm regressões que invertem a ordem dos serviços e verificam
revisão estável, valores iguais e nova revisão após editar uma medição.

A primeira versão canônica codificava cada serviço duas vezes. A implementação
final codifica uma vez e monta o objeto canônico a partir dessas representações.
O diagnóstico de CPU comparou 54 digests iguais: vinte pares aquecidos por caso,
primeiras chamadas e insumos capturados. Com 2.420 linhas, a mediana de CPU caiu
30,8% no projeto e 30,6% na divisão contra o protótipo canônico. Isso é custo do
hash em Node, separado de HTTP e do algoritmo antigo anterior à canonização.
A primeira leitura publicada pode atualizar históricos uma vez pelo novo token.

**Paridade.** Oito superfícies em sete estados tiveram 56 pares de saídas de
negócio iguais: custos explícitos/recentes, metadados do ponto, detalhe, grupo,
grupo com acesso restrito, dias conferidos e relatório mensal. Foram cobertos
conferência, troca de vínculo, desconfirmação, compartilhamento, consolidação,
mudança de cargo e nome. A comparação normaliza somente a ordem de chaves JSON,
o horário de emissão do relatório e os três tokens opacos de revisão cujo
algoritmo mudou. Valores, trilhas, escopos, CNPJ, datas e demais campos permanecem
na comparação. Os testes de revisão/atualização verificam os tokens reais.

**HTTP e pool.** Quatro coortes finais sequenciais, referência/candidato e
candidato/referência, ambas com o mesmo flag habilitado. Cada uma guarda 832
respostas medidas (800 aquecidas, oito frias, oito warmups e 16 após escrita),
mais oito negativas de acesso separadas. Foram 3.328 respostas medidas finais.
PostgreSQL 16 com uma CPU/768 MiB, pool oito, concorrência quatro, parâmetro de
1.200 RDOs, 297 linhas de escopo, grupo com dois membros e ponto resumido. Não
houve testes ou outros ensaios desta tarefa durante as janelas cronometradas;
o host da API não foi isolado. O artefato também preserva as coortes exploratórias
do protótipo canônico, sem tratá-las como aceite da versão final.

| Coorte | Aquecido sem fila | Todas as fases sem fila | SQL nas 16 respostas pós-escrita | Última resposta após escrita |
| --- | ---: | ---: | ---: | ---: |
| Referência, ida | 100.0% | 89.8% | 400 | 428.9 ms |
| Candidato, ida | 100.0% | 90.5% | 348 | 472.0 ms |
| Candidato, ordem inversa | 100.0% | 90.2% | 348 | 554.8 ms |
| Referência, ordem inversa | 100.0% | 89.5% | 400 | 474.5 ms |

O máximo de SQL do ponto após escrita passou de 30 para cinco no cenário medido;
no aquecido, os contadores continuam em nove para cards, sete para detalhe e
quatro para grupo/ponto. A combinação das fases permanece abaixo dos 95%.
As latências variaram e não demonstraram ganho uniforme, mesmo reduzindo SQL;
T06 continua parcial. Uma resposta fria por rota/perfil e duas pós-escrita por
rota/perfil não estabelecem p95 dessas fases. Proxy, TLS, navegador e produção
não foram medidos nesta continuação.

**Serviço frio.** Cinco pares por modo/cenário contra `3db7e76f`, alternando a
ordem, confirmaram mais 30 resultados completos iguais. O snapshot mensal é
ignorado nesses cálculos sem GET/HEAD verificado. Tempos excluem imports/boot e
usam páginas do banco aquecidas; após sessão significa um SELECT:

| Cenário | Modo | Antes | Depois | Redução |
| --- | --- | ---: | ---: | ---: |
| Poucos serviços | Aquecido | 232.1 ms | 63.7 ms | 72.5% |
| Poucos serviços | Processo novo | 413.9 ms | 227.9 ms | 44.9% |
| Poucos serviços | Após SELECT de sessão | 324.2 ms | 133.3 ms | 58.9% |
| Denso | Aquecido | 255.8 ms | 68.4 ms | 73.3% |
| Denso | Processo novo | 502.0 ms | 289.6 ms | 42.3% |
| Denso | Após SELECT de sessão | 380.1 ms | 166.3 ms | 56.2% |

A meta fria geral de 50% continua aberta. O artefato preserva as medições
anteriores, incluindo uma repetição densa muito mais lenta para ambas as fontes;
foi observada pressão de CPU no host. Não se atribui a variação de rodadas
separadas a uma mudança isolada nem se compõem percentuais de ganho.

Validação final: **2.808 testes de backend aprovados, 44 ignorados e nenhuma
falha/cancelamento**; **18 contratos PostgreSQL/HTTP aprovados**, sem ignorados.
Arquitetura, sintaxe, diff e integridade/privacidade das evidências verificados.
As fixtures foram removidas e o container descartável com seus volumes foi
excluído. A implementação foi enviada em **`3be5b9fb`** e os **11 jobs** do
[CI](https://github.com/pedro-pn/filtroAPP/actions/runs/43022340172) passaram.
Continuam abertos pool no frio/refresh, meta fria geral, política de JobRun e
aceites publicados de HTTP/conteúdo útil/LCP e 24 h/sete dias. **Backups adiados.**

### Transporte de metadados — experimento reprovado em 11/11

Após `3be5b9fb`, foram ensaiadas duas variantes isoladas que agrupam leituras
pequenas de metadados em um pacote JSONB pelo mesmo cliente/pool. As consultas
principais de períodos e relatórios foram mantidas. O preloader experimental
existiu somente em processos filhos do benchmark; **nenhuma variante foi integrada
ao app e nenhum novo flag foi criado**. As [evidências e receitas](evidence/performance-metadata-prototypes-20261111.json)
preservam todas as coortes concluídas, a falha e o controle posterior.

Na variante serial, o carregamento de metadados termina antes das consultas
principais. Três pares por modo/cenário preservaram 18 resultados completos.
No processo novo, a mediana densa foi 218,5 → 218,5 ms; a esparsa,
239,9 → 219,2 ms. O aquecido esparso piorou 11,6%. Portanto, agrupar SQL não
demonstrou benefício uniforme de carga fria.

Na variante paralela, os metadados carregam junto das consultas principais.
Cinco pares por modo preservaram mais 15 resultados completos no cenário denso:
processo novo 223,8 → 209,7 ms, redução de 6,3%. **A coorte esparsa falhou no
comparador completo, ainda no modo aquecido**, com divergência em `rdoNumber`
na trilha de apropriação. A execução foi interrompida; não existe resumo válido
de latência dessa coorte. Ela não foi substituída por uma repetição favorável.

A redução existente conserva o primeiro relatório encontrado quando as horas
empatam; a consulta dos pais não define desempate explícito. A mudança observada
exige diagnóstico dos insumos/ordem antes de outro transporte, mesmo sem mudança
aparente nas regras. Não foram capturados planos e ordem física nessa falha;
não há causa fechada. Um controle posterior sem preloader, entre duas cópias
idênticas de `3be5b9fb`, preservou nove pares completos, sem resolver a divergência
experimental. As medianas desse controle variaram 2,1–7,7% no mesmo host.

Ambas as variantes foram reprovadas para integração. Não se combina o ganho
parcial com percentuais de outros baselines nem se muda a regra de RDO por uma
meta de performance. O PostgreSQL descartável tinha uma CPU/768 MiB, todas as
250 migrations e acesso apenas por loopback. Não houve testes ou outras
operações de banco desta tarefa durante as medições. As fixtures ficaram zeradas
e o container com seu volume foi removido. As metas de T06/T07 permanecem abertas
nos valores registrados para a implementação aceita em `3be5b9fb`.

### Catálogos verificados e cobertura dos cards — continuação local de 11/11

A referência incremental é `3be5b9fb`; a branch começou esta continuação em
`46fd9cc1`. O trabalho permaneceu na worktree `filtroAPP-performance`, sem
produção/staging, alteração de backup, schema, índices ou pool. As
[evidências](evidence/performance-verified-catalogs-cards-20261111.json) registram
17 fingerprints de código/testes/workflow congelados antes das medições finais.

**Catálogos entre requisições.** GET/HEAD com revisão transacional verificada podem
compartilhar as linhas de cargos/perfis, custos anuais e filtros de categorias.
As chaves incluem cliente Prisma, visibilidade/canal e opções completas. O limite
conjunto adicional é 16 entradas/4 MiB, até 1 MiB por entrada e TTL máximo de 15 s.
Cada consumidor recebe valores e datas próprios; resolvers são reconstruídos
fora do snapshot. Escritas e chamadas sem contexto verificado continuam lendo
normalmente. Falhas são removidas e uma revisão nova não participa da promessa
da antiga. O flag existente permanece desativado por padrão.

As consultas e suas ordens foram mantidas. Não foi integrado outro transporte
SQL nem desempate para a trilha de RDO. O diagnóstico separado do protótipo
reprovado observou somente hashes de insumos: 15 pares iguais e nenhuma mudança
de ordem em dois conjuntos de pais. Isso não reproduziu nem explicou a falha
anterior; o protótipo permanece reprovado.

**Cards.** A rota ainda usava caches por TTL sem verificar a revisão. Agora passa
pelo mesmo envelope de leitura depois de autenticação/autorização e conserva
usuário, projeção financeira e escopo na chave. Os caches intermediários recebem
a revisão e cards, detalhe/grupo e ponto podem usar o mesmo cálculo mensal.
Gravações externas são observadas sem limpar a memória da API. Apresentações e
oportunidades CRM continuam com os contratos/projeções anteriores; suas tabelas
já constam dos triggers existentes. Uma falha de revisão retorna 503 mesmo com
cards antigos em memória.

**Verificação funcional.** Cinco rotas, dois perfis e três estados produziram
30 pares de respostas HTTP completas iguais à API de referência. Foram cobertos
parâmetros efetivos, custos anuais e categorias alterados por outra conexão.
O candidato permanece ativo entre estados; a referência usa processo novo, pois
seu TTL legado poderia manter valores anteriores. Cada estado leu perfis, custos
anuais e categorias uma vez por escopo, através de rotas/sessões distintas.
Falha de catálogo não usa a revisão anterior e a próxima requisição tenta de novo.

Uma comparação adicional em processos separados confirmou **63 pares completos**:
nove superfícies em sete estados de conferência, alteração/desconfirmação de
vínculo, compartilhamento, consolidação, cargo e nome. Preservou valores, trilhas,
CNPJ, datas, ordem dos arrays e os tokens reais do avanço. Normalizou somente
chaves de objetos e o horário de emissão do relatório mensal.

**Medição HTTP final.** Quatro coortes sequenciais, referência/candidato e
candidato/referência, com 832 respostas por coorte: 800 aquecidas, oito frias,
oito warmups e 16 após gravação; 32 negativas de acesso separadas. Pool oito,
concorrência quatro, PostgreSQL 16 com uma CPU/768 MiB, 1.203 relatórios,
4.802 serviços, 297 linhas de escopo, grupo com dois membros e 11 divisões.
Não houve testes/outros ensaios desta tarefa durante as janelas cronometradas;
o host da API não foi isolado.

| Coorte | Aquecido sem fila | Todas as fases sem fila | SQL nas 800 aquecidas | SQL nas 16 pós-escrita | Cards atualizados | Última resposta após escrita |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Referência, ida | 100% | 90,8% | 4.800 | 348 | 0/4 | 517,1 ms |
| Candidato, ida | 100% | 90,6% | 3.800 | 396 | 4/4 | 982,7 ms |
| Candidato, inversa | 100% | 89,7% | 3.800 | 396 | 4/4 | 911,3 ms |
| Referência, inversa | 100% | 91,3% | 4.800 | 348 | 0/4 | 822,1 ms |

Os cards aquecidos passaram de nove para quatro SQLs por resposta. A redução
no conjunto aquecido é 20,8%. O candidato também refaz os cards após a escrita;
a referência ainda retorna seus valores anteriores nessa janela. Portanto, o
maior custo pós-escrita não compara o mesmo trabalho e não há ganho uniforme de
latência a declarar. **O agregado permanece abaixo de 95%; T06 segue parcial.**

O evento final altera medições, ponto e horas de um RDO, sem mudar
`Project.updatedAt`. A atualização dos cards verifica diretamente as horas do
RDO. As coortes exploratórias foram preservadas: mudar somente o ponto pode
manter o custo monetário do card igual, tornando a diferença financeira um
oráculo inadequado. Nenhuma rodada foi substituída por falhar uma meta de tempo.

**Serviço cumulativo.** Cinco pares por modo/cenário contra `3db7e76f` produziram
mais 30 resultados completos iguais, com ordem das fontes alternada. Os cálculos
sem GET verificado não usam os snapshots. Tempos excluem boot/imports e usam
páginas aquecidas do banco; após sessão significa um SELECT:

| Cenário | Modo | Antes | Depois | Redução |
| --- | --- | ---: | ---: | ---: |
| Esparso | Aquecido | 241,4 ms | 46,9 ms | 80,6% |
| Esparso | Processo novo | 484,4 ms | 248,7 ms | 48,7% |
| Esparso | Após SELECT | 370,1 ms | 144,0 ms | 61,1% |
| Denso | Aquecido | 321,4 ms | 63,3 ms | 80,3% |
| Denso | Processo novo | 563,9 ms | 285,3 ms | 49,4% |
| Denso | Após SELECT | 439,6 ms | 160,5 ms | 63,5% |

**A meta fria de 50% segue aberta.** A variação não é atribuída isoladamente ao
catálogo verificado, que não participa desse ensaio, nem composta com percentuais
anteriores. Uma amostra fria por rota/perfil e um evento de escrita por coorte não
estabelecem p95 frio/pós-escrita. Aceites publicados permanecem separados.

Validação: **2.815 testes backend aprovados, 45 ignorados, sem falha/cancelamento**;
**30 contratos PostgreSQL/HTTP aprovados**, incluindo apresentações/CRM com cache
habilitado; após reforçar a fixture de escrita, **nove contratos relevantes foram
repetidos e aprovados**. Arquitetura, YAML do CI, sintaxe, diff e integridade das
evidências conferidos. O novo gate cobre catálogos, cards, apresentações e CRM.
Os 28 conjuntos de fixtures ficaram zerados; container descartável e volume foram
removidos. A implementação foi enviada em **`ccfe0ddd`**. O
[CI](https://github.com/pedro-pn/filtroAPP/actions/runs/43038179636) teve **nove jobs
aprovados**, incluindo o novo gate HTTP. Em duas tentativas, o backend parou na
instalação de Hunspell por falha de DNS dos mirrors Ubuntu, antes dos testes.
No frontend passaram testes, lint, build e orçamentos; a instalação do navegador
também registrou falhas de DNS. As tentativas de instalação sem progresso foram
canceladas, e somente os jobs sem sucesso foram repetidos uma vez. O CI geral
**não está aprovado**; reexecutar backend/navegador após normalizar a rede.
Permanecem abertos pool global, meta fria, política de JobRun e aceite publicado
de 24 h/sete dias.

### Integração da main remota e TypeScript 7 — 11/11

A `main` remota **`a00eb6ce`** foi integrada à branch a partir de `a55b5941`,
preservando os dois históricos. As [evidências da integração](evidence/performance-main-merge-20261111.json)
separam essa validação das medições anteriores. Não foi repetido o benchmark
completo de latência; seus números continuam associados aos commits registrados.

Houve **um conflito textual**, em `.github/workflows/ci.yml`: o gate de tamanho
das páginas disputava a posição após o build com a preparação de DNS/mirrors.
Foram mantidos ambos, os runners Ubuntu 24.04 da main, a recuperação de DNS e os
gates de contratos HTTP/catálogos/cards e navegador da branch de performance.
Os demais sete arquivos alterados nos dois lados foram conciliados automaticamente
e revisados. Fora dessas sobreposições, **87 fontes de runtime alteradas pelo plano
permaneceram idênticas byte a byte** ao estado anterior ao merge.

O modelo híbrido da main foi preservado: `@typescript/native` instala o compilador
**7.0.2**, usado por `tsc`/build/E2E; `typescript` fornece a API **6.0.3**, usada
por ESLint e testes de análise/transpilação. Não houve ajuste de tipagem na aplicação,
supressão de erros ou aumento dos orçamentos. Passaram o build, tipos de E2E,
tipos da `implementation-preview`, lint, arquitetura e os seis limites existentes:

| Superfície | Gzip medido | Limite mantido |
| --- | ---: | ---: |
| Shell | 209.082 B | 220.000 B |
| Efetivo — visão geral | 298.619 B | 320.000 B |
| Efetivo — evolução | 311.568 B | 320.000 B |
| Acompanhamento — dashboard | 289.186 B | 360.000 B |
| Gestor | 411.005 B | 430.000 B |
| Gestor — estatísticas | 419.304 B | 440.000 B |

Na prévia experimental `design-preview`, a checagem ampliada encontrou **66
diagnósticos já existentes**. O mesmo compilador/dependências reproduziu as mesmas
66 assinaturas na main e na performance anterior ao merge, sem diagnóstico novo
na integração. Somente a cópia arquivada da configuração anterior teve `baseUrl`
removido para permitir a comparação com TypeScript 7, como já faz a main.
Essa prévia não integra o build da aplicação; sua correção não foi misturada ao merge.

As novas regras de confirmação de mobilização do Efetivo e a marcação de conteúdo
útil da disponibilidade foram preservadas. As seleções financeiras continuam usando
os períodos delimitados de alocação; os testes de paridade passaram. O middleware
de fontes por requisição e a exclusão de `PerformanceReadRevision` do catálogo
público foram mantidos junto das mudanças da main em corpo de requisição e API.

A migration de notas/documentos foi validada em PostgreSQL isolado tanto na
instalação completa (**251 migrations**) quanto na atualização de **250 → 251**,
com a migration de revisão já aplicada. O registro antigo foi preservado, o novo
campo de anexos recebeu `false`, a nota é anulável e o enum `DOCUMENT` funciona.
Alterar o campo novo mudou a revisão financeira. Os **187 triggers** existentes
cobrem o schema; não foi necessária outra migration de invalidação.

Validação local: **898 testes de frontend**, **2.875 testes de backend** (45
ignorados), **30 contratos PostgreSQL/HTTP** e **oito regressões de navegador de
performance**, sem falhas. A primeira invocação de navegador concluiu os oito
testes e recebeu SIGTERM no encerramento; a repetição direta terminou com saída
zero. As bases nova/atualizada ficaram sem fixtures e o container/volume
descartável foi removido.

O [CI da árvore integrada `f9f4c51f`](https://github.com/pedro-pn/filtroAPP/actions/runs/43069946051)
aprovou os **11 jobs na primeira tentativa**. Foram **898 testes de frontend**,
**2.889 testes de backend** (35 ignorados), **23 testes do gerador de Data Book**
e **41 regressões de navegador** (28 RDO/notificações/equipamentos, oito de
performance e cinco do Efetivo). Os contratos PostgreSQL e o build Docker também
passaram. Os seis tamanhos gzip no CI foram idênticos aos da tabela local.
O resultado resolve a pendência de CI por DNS da rodada anterior; não substitui
as metas quantitativas nem o aceite publicado do plano.

Backups, publicação e os aceites quantitativos pendentes continuam fora desta
integração local.

### Continuação local: fontes compartilhadas e retenção de 90 dias — 11/11

Os catálogos de cargos, perfis/parâmetros e custos anuais passaram a usar uma
consulta com as mesmas colunas selecionadas. Os períodos mensais mantêm a
consulta nativa dos pais e sua ordem; identidade/histórico dos colaboradores são
resolvidos em uma leitura limitada aos IDs selecionados. Ignorados, feriados do
intervalo e revisão do calendário também são lidos juntos. As datas retornam
com os mesmos tipos/UTC do Prisma. Projetos, RDOs, ausências e alocações mantêm
os caminhos protegidos. Não houve mudança de regra, índice ou migration.

Cards, detalhe e grupos reutilizam as fontes normalizadas de avanço por projeto,
inclusive em conjuntos parcialmente sobrepostos. O armazenamento exige GET/HEAD,
revisão verificada, cliente, escopo/canal e modo de correção iguais. Seus limites
são oito entradas/8 MiB, até 2 MiB por projeto e 15 segundos. Cada consumidor
recebe sua própria cópia. As fontes da requisição agora também separam versões
e leituras anteriores à verificação. Escritas e serviços sem contexto verificado
continuam sem compartilhamento entre requisições.

Estoque e equipamentos evitam consultas de relações vazias; estoque reutiliza
as leituras na mesma requisição por conjunto de projetos/divisão. O total de
compras e a parcela paga usam uma agregação por projeto/status, com recomposição
em centavos inteiros e retorno Decimal. Nulos, negativos e valores grandes
preservam o resultado anterior. Os testes PostgreSQL cobrem custos não vazios,
devoluções, TAGs históricos, primeira saída, divisões e visibilidade.

Foram feitas quatro coortes HTTP em ordem **anterior/candidata/candidata/anterior**,
contra `2300c9c6`, com as mesmas dependências e o mesmo harness. Cada coorte contém
832 respostas positivas, além de oito negativas de permissão. São 100 respostas
aquecidas por rota/perfil, um processo novo por rota/perfil e 16 leituras após
gravação externa. Node 24.15.0, PostgreSQL 16 limitado a 1 CPU/768 MiB, pool 8,
concorrência 4, 1.203 RDOs, 4.802 serviços e 297 linhas de escopo sintéticas.

| Medida local | Anterior A1 / A2 | Candidata B1 / B2 |
| --- | --- | --- |
| Intervalos globais sem fila, incluindo aquecimento | 87,45% / 88,49% | 89,39% / 88,86% |
| Intervalos sem fila na fase aquecida | 100% / 100% | 100% / 100% |
| Consultas SQL nas 16 leituras após gravação | 388 / 388 | 334 / 334 |
| Última leitura atualizada após commit | 684,08 / 670,86 ms | 531,76 / 526,25 ms |

Nas duas candidatas, o p95 de servidor aquecido ficou até **9,82 ms nos cards**
e **24,33 ms no detalhe**, com todas as respostas válidas e atualizadas. As quatro
coortes passaram nos limites HTTP aquecidos e de atualização. Não houve sequência
observada de espera acima de cinco segundos. As amostras frias não permitem p95.
Os intervalos do aquecimento, omitidos no agregado antigo, agora são conservados:
**onze buckets positivos**, com negativas de acesso verificadas separadamente.
Não comparar diretamente essa fração global com os ensaios antigos de dez buckets.
Os tempos não demonstram melhoria uniforme de toda rota/fase.

O cálculo do serviço foi comparado com `3db7e76f` em duas coortes por formato,
cinco pares por modo/coorte, sempre em processos separados e ordem alternada.
O banco recebe `ANALYZE` após a carga sintética antes das duas fontes. A primeira
coorte usou ordem esparso/denso; a repetição predefinida inverteu essa ordem.

| Processo novo, mediana do cálculo | Primeira coorte antes → depois | Repetição antes → depois |
| --- | --- | --- |
| Esparso | 490,90 → 235,92 ms (51,94%) | 444,24 → 233,24 ms (47,50%) |
| Denso | 507,72 → 247,51 ms (51,25%) | 460,22 → 228,32 ms (50,39%) |

Os **60 pares de resultados completos** foram iguais, mas a repetição esparsa
mantém aberta a meta geral de 50%. Boot/imports não entram no tempo; o banco tem
páginas aquecidas. Isso não é latência HTTP fria nem aceite de produção. O harness
agora registra falhas como artefatos incompletos e oferece diagnóstico separado
de ordem/conteúdo dos RDOs por hashes, sem mudar desempates. Os protótipos de
consulta da importação e lote de contexto sem ganho uniforme não foram integrados.

Uma comparação HTTP adicional contra a versão anterior conferiu **30 respostas
completas**, sem excluir campos ou reordenar trilhas: cinco rotas, dois perfis e
três estados (inicial, gravação do worker e alteração de parâmetros/custos/calendário).
A candidata permaneceu ativa, sem limpar sua memória após os commits externos.

A retenção manual de **90 dias**, aprovada pelo usuário, foi simulada e aplicada
somente no PostgreSQL descartável. O preview apontou duas exclusões e a aplicação
removeu exatamente essas duas, em lotes de um e com auditoria. Falhas, execuções
em andamento, sucessos recentes, último sucesso e empates foram preservados;
uma sessão expirada de controle também permaneceu. Não houve aplicação publicada.
O novo `report-job-run-volume.js` agrega linhas criadas por dia UTC/status e bytes
de tabela/índices numa transação somente leitura, com timeout. O teste nativo
confirmou que uma tentativa de escrita nessa transação é recusada pelo PostgreSQL.
O relatório não seleciona nomes, metadados, resultados ou erros dos jobs.

Validação local final: **2.893 testes de backend aprovados**, 48 ignorados,
**37 contratos PostgreSQL/HTTP aprovados**, arquitetura e YAML do CI válidos.
A primeira suíte completa encontrou uma expectativa antiga de duas agregações
de compras num teste de visibilidade; o teste passou a conferir a agregação
combinada e o mesmo filtro de projeto, e a suíte completa foi repetida com sucesso.
As fixtures ficaram zeradas e o container/volume descartável foi removido.
O [CI desta rodada](https://github.com/pedro-pn/filtroAPP/actions/runs/43098879792)
foi iniciado para o commit **`8edae73382f3d59b1fd3e26d0b75caac75d183af`**. Na consulta
de **11/11 às 21:01 UTC**, os **11 jobs estavam na fila, sem execução ou conclusão**.
Esse estado não é aprovação do CI e não substitui o aceite publicado.

Os resultados, amostras numéricas, hashes das fontes, coortes exploratórias e
limitações estão na [evidência desta rodada](evidence/performance-final-sources-retention-20261111.json).
O roteiro de [operação e aceite](PERFORMANCE_OPERACAO.md) descreve a coleta publicada
e a aplicação manual. **Continuam abertas as duas metas quantitativas acima**,
além dos aceites publicados e da aplicação manual da retenção. Backups permanecem adiados.

### Fechamento das metas locais de frio e pool — 11/11

O cálculo mensal lê referências e, depois, os relatórios/decisões que as usam.
Cards e detalhe aguardam esse custo antes dos metadados restantes. Os tempos
aparecem em `labor.sources.references`, `labor.sources.reports`,
`cards.sources.labor/metadata` e `detail.sources.labor/metadata`. Não há semáforo,
fila de admissão ou espera omitida da duração HTTP. Pool oito e concorrência
quatro foram mantidos.

Horas normais/extras, seleção de orçamento/adicionais e nomes de cargos usam um
lote limitado aos pais selecionados pelo cliente protegido. Decimais, datas UTC,
revisões comerciais, percentuais e ordem dos campos de horas foram preservados.
O ponto mantém os pais/ordem anteriores e lê identidade/histórico e ausências
sobrepostas dos mesmos IDs em um lote, somente com IDs/datas das ausências.
As políticas continuam na função de disponibilidade, que remove pessoas
ignoradas/fora do recorte. Tipos/observações de ausência não são selecionados.
Sem missões oficiais selecionadas, não é feita a leitura vazia das alocações.

Ajustes manuais e dias conferidos compartilham outra leitura, usando os IDs do
catálogo de projetos protegido do próprio cálculo. Rascunhos, datas fora do
período, projetos ocultos e precedência da conferência mantêm as regras anteriores.
Datas repetidas dos RDOs são formatadas uma vez por cálculo, sem cache global.
A consulta/ordem dos pais de RDO e ponto e os desempates não foram alterados.

O diagnóstico das repetições encontrou a **mesma consulta SQL** lendo 47/1 blocos
de Report/ReportService numa coorte e 330/204 na seguinte: as exclusões anteriores
das fixtures deixaram páginas físicas. A execução SQL do perfil passou de
0,36 para 28,31 ms. Uma prova controlada manteve 335.872/835.584 bytes após excluir
as fixtures e os reduziu a zero com vacuum no banco descartável vazio. O harness
agora faz `VACUUM ANALYZE` **antes da carga**, depois do guard de banco vazio/local,
e `ANALYZE` após semear. Ambas as versões recebem a mesma preparação. Os ensaios
anteriores permanecem como observações das condições físicas anteriores.

| Coortes controladas finais | Referência | Candidata | Resultado |
| --- | --- | --- | --- |
| Processo novo esparso, primeira / repetição | 438,69 / 445,52 ms | 215,81 / 216,13 ms | **50,81% / 51,49%** de redução |
| Processo novo denso, primeira / repetição | 460,88 / 459,61 ms | 210,77 / 219,95 ms | **54,27% / 52,14%** de redução |
| Pool global sem fila, duas coortes por versão (ABBA) | 89,24% / 89,36% | 95,86% / 95,72% | **Meta local de 95% atingida** |
| SQL nas 16 respostas após gravação | 334 / 334 | 310 / 310 | 24 consultas a menos em ambas as coortes |
| Última resposta atualizada após commit | 532,24 / 553,31 ms | 551,37 / 549,35 ms | Todas atualizadas, abaixo de 15 s |

Foram **60 pares completos de cálculo** nas quatro coortes finais, cinco por
modo/formato/coorte; nenhum objeto foi normalizado para fazer a comparação passar.
Foram também quatro coortes HTTP de 832 respostas positivas, 100 aquecidas por
rota/perfil e oito negativas de permissão por coorte, com onze buckets incluindo
o aquecimento. O aquecido ficou 100% sem fila. Os limites de p95 HTTP aquecido
passaram. As amostras frias não permitem p95, e não há alegação de ganho uniforme
de latência HTTP em cada rota/fase.

Uma comparação adicional manteve a candidata ativa por cinco estados de dados
e conferiu **50 respostas HTTP completas** contra `8edae733`: inicial, gravação
do worker, parâmetros/calendário, ajuste/conferência e ausência superveniente.
As leituras em dois perfis/sessões observaram os commits, sem limpar o cache da
candidata. A main `245ebd00` foi incorporada sem conflitos; a correção que permite
gestor e conferente do Efetivo juntos foi preservada.

Validação final local: **2.896 testes de backend aprovados** (52 ignorados),
**902 de frontend** e **42 contratos PostgreSQL/HTTP**, sem falhas. Build,
arquitetura e os seis orçamentos passaram, sem ampliar limites. Os valores gzip
foram: shell 209.086 B; Efetivo visão geral/evolução 298.798/311.765 B;
Acompanhamento 289.200 B; Gestor/estatísticas 411.002/419.301 B.

O [CI final](https://github.com/pedro-pn/filtroAPP/actions/runs/43111440702) validou
o commit **`e5d8f37ba648ec35d802d2324688e839142c92f5`**, com **11/11 jobs aprovados**.
Foram 2.910 testes de backend (42 ignorados), 23 do gerador de Data Book, 902 de
frontend e 41 de navegador (28 RDO/notificações/equipamentos, oito de performance
e cinco do Efetivo). O gate HTTP/PostgreSQL aprovou seus dois grupos de 11 e
24 testes; os demais contratos de integração e o build Docker também passaram.
Os seis tamanhos gzip foram idênticos aos locais. O banco/volume descartável
foi removido após conferir todas as fixtures zeradas.

As [evidências finais](evidence/performance-misses-closure-20261111.json) incluem
amostras, hashes das fontes, perfis SQL, diagnóstico físico e todos os ensaios
exploratórios, inclusive os abaixo das metas. São aceites **locais sintéticos**:
boot/imports não entram no cálculo, páginas do PostgreSQL estão aquecidas e o
host é compartilhado. A leitura de produção foi somente leitura: 358.456 JobRuns,
233.922.560 bytes de tabela/índices e 7.226 elegíveis à política de 90 dias em
11/11 às 22:00 UTC. Não houve publicação, exclusão, vacuum em produção ou mudança
de backup. Os aceites de ambiente publicado e a aplicação manual seguem em T12/T10.

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

Para a prévia exclusiva de JobRun, o operador deve usar `--only-job-runs` e fornecer
`--job-run-retention-days=90` ao script de retenção, que permanece
em dry-run sem `--apply`. Esse escopo não consulta/altera os outros alvos da rotina
geral. Sem prazo explícito, JobRun não participa do agendamento normal. Nenhuma
aplicação publicada foi realizada. A política de 90 dias foi aprovada pelo usuário
em 11/11. Ver [roteiro operacional](PERFORMANCE_OPERACAO.md).

Na publicação manual, atualizar backend/worker e Nginx a partir da mesma revisão;
os comandos de healthcheck dependem do script e da localização HTTP novos. Em
rollback para imagens anteriores, restaurar também a definição anterior do Compose,
pois a imagem antiga do worker não contém `scripts/check-worker-health.js`.
A continuação de leituras versionadas inclui a migration
`20261110230000_performance_read_revision`, necessária antes de habilitar o cache.
A comparação publicada ainda deve separar
primeira carga, cache aquecido, laboratório e HTTP, mantendo T02 (backups) adiada.
