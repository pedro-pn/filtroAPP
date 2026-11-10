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

- [ ] T01 Coleta HTTP, marcas de conteúdo útil e ensaio HTTP autenticado/concorrente implementados localmente; janela publicada pendente.
- [ ] T02 Adiada pelo usuário: estratégia de backup e recuperação.
- [ ] T03 Healthchecks de Nginx/progresso do worker implementados localmente; série publicada pendente.
- [x] T04 Consultas do Gestor por necessidade da aba, verificadas localmente.
- [x] T05 Pacote completo de avanço otimizado com paridade, verificado localmente.
- [ ] T06 Implementação local: projeção de avanço, custos dos grupos em lote e leituras de ponto por finalidade; meta de fila do pool e aceite publicado pendentes.
- [ ] T07 Parcial: fontes compartilhadas, catálogos em lote, intervalos por período, calendário antecipado e conciliação sem motor de custos; meta fria geral e aceite HTTP pendentes.
- [ ] T08 Seções/modais e painéis do Gestor carregados sob demanda localmente; aceite publicado pendente.
- [ ] T09 Imagens otimizadas e CSS exclusivo da administração extraído; aceite LCP publicado pendente.
- [ ] T10 Sondagens vazias agregadas e retenção opt-in validada localmente; política e aplicação pendentes.
- [x] T11 Gates de tamanho, paridade, consultas, navegador e padrões de novos módulos integrados ao CI, verificados localmente.
- [ ] T12 Comparação em produção, 24 h e sete dias, e aceite registrado.

## Entregas locais e próximos incrementos

| Tarefa | Entrega nesta rodada | Trabalho restante |
| --- | --- | --- |
| T01 | Coleta HTTP opt-in, marcas de conteúdo útil e benchmark HTTP local com sessões reais, concorrência e amostragem do pool; cache e refresh separados | Janela completa de HTTP/conteúdo útil após publicação |
| T03 | Healthchecks locais do Nginx e de progresso do worker, incluindo filas de aprovação/e-mail/Data Book | Publicação manual e série de 24 h/sete dias |
| T04 | Bootstrap projetado por seção, cache separado por seção e usuário, consultas condicionais, tratamento de carga/falha no upload manual e compatibilidade do contrato anterior | Aceite HTTP em ambiente publicado |
| T05 | Associação das medições e preparo do escopo reutilizados dentro de cada cálculo; curvas não montam grupos de exibição descartados; resultado completo comparado com o anterior | Aceite HTTP em ambiente publicado |
| T06 | Avanço atual a cada 15 s; histórico/recortes por revisão; projeção exclusiva de avanço; fontes comercial e de custos em lote para grupos; leituras de ponto por finalidade; ensaio HTTP local de permissões e escrita entre processos | Reduzir fila de pool observada no ensaio e validar concorrência/p95 no ambiente publicado |
| T07 | Fontes mensais/globais compartilhadas; catálogos em lote; horários por período; ausências/calendário antecipados; conciliação sem calcular custos; catálogo de cargos reutilizado no ponto e horas dos RDOs reutilizadas no detalhe | Reduzir as 38 chamadas da tabela de custos e a fila do pool; atingir a meta fria geral; planos SQL locais verificados sem justificar novo índice |
| T08 | Seções do Efetivo/Acompanhamento, cinco modais de workflow e painéis do Gestor sob demanda; visão geral estatística separada dos overlays | Aceite das superfícies autenticadas no ambiente publicado |
| T09 | Variantes lossless, favicon/hash/prioridade do login e CSS da administração de credenciais separado do shell, preservando a camada legacy | Aceite LCP publicado; outros estilos globais podem ser divididos conforme medição |
| T10 | Uma linha por janela de 15 min para sondagens vazias de finalização/quarentena; trabalho e falhas individuais; preview/retenção em lotes sem prazo padrão | Aprovar prazo/política antes de aplicação manual; medir linhas/dia publicado |
| T11 | Orçamentos, paridade, projeções HTTP/PostgreSQL e cenários de navegador no CI; padrões de carga/cache/atualização em PADRAO_MODULO.md | Execução dos gates no PR após envio; validação publicada permanece em T12 |

Os aceites publicados, a política/aplicação de retenção e o restante da meta fria de T07 permanecem pendentes. As regras de apropriação
de custos foram preservadas. Não houve exclusão de histórico, alteração de backup
ou execução em servidores nesta implementação local.

### Pendências priorizadas após a revisão para commit

1. **Pool e volume por requisição — T06/T07:** reduzir a pressão confirmada no
   ensaio HTTP já implementado. Com quatro requisições simultâneas e pool de oito,
   a rodada mais recente com a tabela de custos observou 25,1% das amostras
   ativas sem fila, contra 26,3% na referência da mesma rodada; não houve
   melhora dessa proporção. A meta continua em 95%. Na rodada anterior, o
   consumidor de conciliação observou 29,7%, em cenário diferente da tabela.
   O grupo agora usa 47–48 chamadas medianas, o detalhe individual 45–46 e
   a tabela de custos 38. A conciliação usa oito e a tabela transfere 21.167 B.
   Priorizar metadados de colaboradores compartilhados entre membros e medir
   as rajadas de consultas das fontes, preservando regras financeiras, acesso
   e atualização. Eventual coordenação de concorrência deve medir também a
   espera na aplicação e o HTTP total, sem apenas deslocar a fila do PostgreSQL.
2. **Carga fria — T07:** atingir a redução de pelo menos 50% em todos os
   cenários-alvo. A comparação direta com o início do plano deu 40,6% no cenário
   com poucos serviços e 50,1% no denso; isso ainda não fecha o aceite geral.
3. **Aceite publicado — T01/T04/T05/T06/T08/T09:** verificar as metas HTTP e
   de conteúdo útil/LCP da tabela inicial, a transferência por rota, dois
   navegadores, perfis com/sem acesso financeiro, gravações do worker e atualização
   em até 15 s, incluindo a ausência de polling com a página oculta.
4. **Operação e fechamento — T03/T11/T12:** executar os gates no CI/PR,
   preparar a publicação manual e comparar séries de 24 h e sete dias de pool,
   event loop, CPU steal, memória, erros e progresso dos jobs.
5. **Retenção — T10:** definir/aprovar a política e o prazo antes da aplicação
   manual; medir a criação de linhas por dia no ambiente publicado. O mecanismo
   local de preview/retenção já está implementado.

**T02 (backups) permanece adiada pelo usuário.** As entregas locais de T04,
T05 e T11 estão concluídas; os aceites publicados são acompanhados em T12.
Uma divisão adicional de CSS ou novos índices depende de novo gargalo medido,
sem constituir uma implementação obrigatória já comprovada como ausente.

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
