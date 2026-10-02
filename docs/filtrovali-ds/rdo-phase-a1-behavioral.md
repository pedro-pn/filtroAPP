# RDO — Fase A.1: caracterização comportamental

Data de abertura: **20 de agosto de 2026**  
Status: **em execução — resultados comportamentais pendentes de consolidação**

## 1. Objetivo

A RDO A.1 reforça a baseline da RDO atual com testes que exercitam o navegador e observam resultados reais. A finalidade é proteger o comportamento existente antes da migração visual da RDO B.

Esta etapa não autoriza redesign, correção funcional nem refatoração. Um teste de caracterização registra o que a aplicação faz hoje, inclusive quando o comportamento atual não é o comportamento visual desejado.

## 2. Limites absolutos

Durante a RDO A.1:

- não alterar código, layout ou CSS de produção;
- não ativar `AppShell`, Sidebar, Drawer, BottomBar ou ThemeToggle no RDO;
- não adotar no RDO os componentes do Filtrovali DS já disponíveis;
- não alterar rotas, APIs, hooks, stores, permissões ou regras de negócio;
- não alterar backend, banco, seeds ou dados reais;
- não criar dados fictícios dentro da aplicação;
- não criar bypass de autenticação ou de consentimento;
- não alterar Driver.js, `SignatureDialog`, autosave, polling ou qualquer fluxo existente;
- não executar operações destrutivas ou mutáveis;
- não iniciar a RDO B;
- não fazer refatorações oportunistas.

As únicas alterações permitidas são testes de caracterização, artefatos de execução desses testes e esta documentação.

## 3. Ambiente e ressalva de compatibilidade

A baseline visual que precede esta etapa foi produzida pelo frontend da branch `feat/frontend-redesign-2`, revisão `e121e69b8e9cb2a4a57fae221bb83cc83495b5e6`, servido a partir de `/home/relat/apps/filtroAPP-frontend-4/frontend`.

O backend local em `:4000` está em outra worktree: seus bind mounts têm origem em `/home/relat/apps/filtroAPP-main/backend` e `/home/relat/apps/filtroAPP-main/shared`. Nos fluxos seguros e somente leitura executados na RDO A, ele respondeu de forma compatível com o frontend desta branch: autenticação, redirects, listagens, busca, carregamento incremental, detalhe e estatísticas funcionaram sem diferença de contrato observada.

Essa compatibilidade observada não prova os contratos dos fluxos mutáveis, pois eles não serão executados contra dados reais. Não foi criado bypass, seed, fixture persistente nem adaptação entre frontend e backend.

## 4. Cobertura antes da RDO A.1

A RDO A entregou **32 testes automatizados**:

- **4 verificações em runtime** de funções puras/importadas;
- **28 verificações estáticas** baseadas em leitura do código, expressões regulares ou presença de strings.

Esses testes protegem contratos importantes, mas não são equivalentes a interações reais com o navegador. Em especial, presença de handler, seletor, texto, classe ou chave de storage não comprova a transição de estado produzida por clique, preenchimento, reload ou navegação.

### Lacunas prioritárias de entrada

| Área               | Proteção anterior                   | Reforço pretendido na A.1                                       |
| ------------------ | ----------------------------------- | --------------------------------------------------------------- |
| Login/logout       | Observação manual e wiring estático | Interação real, resultado de autenticação e destino após logout |
| Abas               | Presença de tabs/query params       | Clique e confirmação de URL/conteúdo ativo                      |
| Busca/filtros      | Wiring, debounce e chaves           | `fill`, espera do estado observável, limpeza e resultado        |
| Ordenação          | Função pura e observação manual     | Interação real e mudança verificável na ordem                   |
| Seleção            | Algoritmo estático                  | Seleção real, entre grupos e preservação                        |
| Carregar mais      | Wiring de hook/sentinel/botão       | Clique real e aumento observável da lista                       |
| Detalhe/retorno    | Helper e rota                       | Navegação real, retorno e estado restaurado observado           |
| Persistência       | Chaves e schema                     | Navegação/reload e verificação do estado sobrevivente           |
| Estatísticas       | Presença de elementos               | Navegação real e renderização de dados reais                    |
| Vazio/loading/erro | Branches estáticos                  | Estado real quando puder ser obtido sem mutação                 |
| Consentimento      | Observação manual                   | Bloqueio, aceite não marcado e logout, sem aceitar o termo      |
| Tutorial           | Seletores estáticos                 | Exibição e interação real quando a campanha atual permitir      |

## 5. Cobertura depois da RDO A.1

> Esta seção deve ser preenchida somente com resultados comprovados pela execução dos testes. Nenhum resultado deve ser inferido a partir do código-fonte.

Status atual: **concluído — suíte comportamental consolidada aprovada**.

Foram implementados **5 testes Playwright comportamentais**: um teste do gestor, organizado em oito `test.step`, e quatro testes de acesso — três do colaborador e um do cliente. A execução consolidada passou **5/5** contra o frontend iniciado isoladamente a partir desta worktree e o backend local compatível. Na exploração anterior, duas falhas foram diagnosticadas como defeitos do próprio teste — uma expectativa inexistente no TopBar e um locator instável após `Carregar mais` — e não como falhas da aplicação.

| Perfil/área  | Cenários comportamentais adicionados | Resultado comprovado até agora                                                                      | Evidência                          |
| ------------ | -----------------------------------: | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Gestor       |                   1 teste / 8 etapas | 1/1 aprovado; oito etapas concluídas                                                                | `e2e/rdo-manager.behavior.spec.ts` |
| Colaborador  |                             3 testes | 3/3 aprovados                                                                                       | `e2e/rdo-access.behavior.spec.ts`  |
| Cliente      |                              1 teste | 1/1 aprovado                                                                                        | `e2e/rdo-access.behavior.spec.ts`  |
| Estatísticas |                        1 `test.step` | Aprovado com requests, cards, tabela, consistência dos totais, modal e filtro de período reais      | Navegador e backend reais          |
| Persistência |                        6 observações | Aba/busca, sort, grupo recolhido e quantidade carregada sobrevivem; seleção não sobrevive ao reload | Navegação, storage e reload reais  |

O relatório final deverá separar explicitamente:

1. cenários executados pelo navegador contra dados reais, sem mutação;
2. cenários que permaneceram apenas estáticos;
3. cenários bloqueados por credencial, consentimento ou ausência de fixture;
4. cenários deliberadamente não executados por risco de mutação.

## 6. Matriz comportamental implementada

### 6.1 Gestor

| Fluxo                  | Forma de caracterização                                                          | Resultado                                                   |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Login e logout         | Preencher credenciais existentes, entrar, acionar logout e observar rota/sessão  | Aprovado                                                    |
| Abas                   | Clicar nas oito abas reais e observar estado ativo, conteúdo e URL               | Aprovado                                                    |
| Busca e limpeza        | Preencher busca, esperar debounce/resultado e limpar                             | Aprovado                                                    |
| Filtros disponíveis    | Interagir somente com filtros reais e reversíveis                                | Tabs e busca aprovadas; nenhum filtro adicional foi forçado |
| Ordenação              | Alternar ordenação e comparar a ordem visível                                    | Aprovado; persistência em `localStorage` observada          |
| Seleção                | Selecionar item elegível sem disparar ação em lote                               | Aprovado sem confirmar qualquer ação mutável                |
| Seleção entre grupos   | Selecionar itens/grupos sem executar ação mutável                                | Aprovado; dois grupos exercitados                           |
| Preservação da seleção | Ordenar, expandir ou carregar sem acionar lote                                   | Preservada após `Carregar mais`; removida pelo reload       |
| Carregar mais          | Clicar no botão real e observar aumento da coleção                               | Aprovado; quantidade aumentou e sobreviveu ao reload        |
| Estado vazio           | Produzir por busca sem correspondência e depois limpar                           | Aprovado sem modificar dados                                |
| Detalhe e retorno      | Abrir detalhe somente leitura e voltar à listagem                                | Aprovado; aba e busca preservadas                           |
| Estado após retorno    | Observar aba, busca, ordem, seleção, expansão e scroll; não assumir persistência | Aba/busca preservadas; scroll não caracterizado             |
| Reload                 | Recarregar e registrar precisamente quais estados sobrevivem                     | Aprovado; ver matriz de persistência                        |
| Estatísticas           | Navegar à aba e verificar dados/tabela reais após carregamento                   | Aprovado                                                    |
| Loading                | Observar somente se ocorrer naturalmente e for verificável                       | Transição não caracterizada de forma determinística         |
| Erro/retry             | Executar somente se houver mecanismo seguro e não invasivo                       | Permanece estático; não há disparo seguro confirmado        |

### 6.2 Colaborador

| Fluxo                 | Forma de caracterização                                              | Resultado                                                               |
| --------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Home                  | Navegar e verificar as ações/estados realmente disponíveis           | Aprovado                                                                |
| Meus relatórios       | Abrir a rota e observar dados ou vazio real                          | Aprovado                                                                |
| Arquivados            | Abrir a rota e observar dados ou vazio real                          | Aprovado                                                                |
| Serviços em andamento | Abrir a rota sem iniciar/encerrar serviço                            | Aprovado                                                                |
| Formulário inicial    | Abrir a primeira etapa sem preencher dados que acionem autosave      | Aprovado                                                                |
| Estados vazios        | Validar apenas vazios naturais do ambiente                           | Aprovado                                                                |
| Tutorial              | Exercitar a campanha real sem modificar Driver.js nem forçar storage | Aprovado em contexto novo; avançou ao segundo passo sem concluir o tour |
| Logout                | Acionar e confirmar destino/sessão                                   | Aprovado                                                                |

### 6.3 Cliente

| Fluxo                     | Forma de caracterização                                                                 | Resultado                                 |
| ------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| Redirecionamento          | Login legítimo e confirmação da rota autorizada                                         | Aprovado                                  |
| Barreira de consentimento | Confirmar que o portal permanece bloqueado                                              | Aprovado, inclusive após reload           |
| Não aceite                | Não marcar/aceitar o termo e verificar ausência de progressão                           | Aprovado                                  |
| Logout                    | Sair sem aceitar o termo e confirmar destino/sessão                                     | Aprovado                                  |
| Portal interno            | Não acessar por bypass; depende de credencial/fixture com consentimento legítimo prévio | Bloqueado até existir ambiente apropriado |

## 7. Persistência observada

Cada teste deve registrar o valor antes e depois da transição correspondente. A existência de uma chave não prova o comportamento de persistência.

| Estado                       | Navegação/detalhe                                        | Reload                             | Resultado observado                                                     |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Aba ativa                    | `Aprovados` sobrevive ao detalhe e ao botão Voltar       | Sobrevive                          | Preservada no retorno e no reload                                       |
| Busca por aba                | Valor sobrevive ao detalhe e ao botão Voltar             | Sobrevive via `sessionStorage`     | Preservada; limpeza também remove a entrada persistida                  |
| Filtros                      | Nenhum filtro adicional foi forçado                      | Não caracterizado                  | Tabs e busca cobertas; outros filtros permanecem pendentes              |
| Ordenação                    | Direção `Z→A` observada após alternância                 | Sobrevive via `localStorage`       | Preferência e primeira posição visível persistidas                      |
| Grupos recolhidos/expandidos | Projeto real foi recolhido e reaberto                    | Estado recolhido sobrevive         | Persistência comprovada pelo desaparecimento/retorno dos grupos de tipo |
| Quantidade carregada         | Aumenta após o clique real em `Carregar mais`            | Sobrevive                          | Contagem do projeto após reload permanece maior ou igual à carregada    |
| Seleção                      | Mantida entre grupos e depois de `Carregar mais`         | Não sobrevive                      | Reload resulta em zero checkboxes selecionados                          |
| Posição de scroll            | Retorno ao detalhe exercitado, sem asserção do offset    | Não caracterizado                  | Pendente                                                                |
| Barreira do cliente          | Impede acesso ao portal sem aceite                       | Sobrevive                          | Checkbox continua desmarcado e ação continua desabilitada após reload   |
| Tutorial                     | Executado em contexto novo e isolado até o segundo passo | Não aplicável nesta caracterização | Tour real responde ao clique sem ser concluído                          |
| Tab/projeto/tipo do cliente  | Bloqueado pelo consentimento legítimo no ambiente atual  | Bloqueado                          | Pendente de conta consentida ou fixture legítima                        |

Os testes não devem limpar, renomear ou reescrever chaves de `localStorage`/`sessionStorage` da aplicação para fabricar um cenário. O isolamento de sessão do navegador pode ser usado sem alterar a implementação do produto.

## 8. Estados loading, erro e vazio

### Vazio

É seguro produzir vazio por uma busca sem correspondência e, quando o ambiente já estiver naturalmente vazio, observar a superfície correspondente. O teste deve limpar a busca ao concluir. Não se deve apagar ou arquivar registros para criar vazio.

### Loading

O estado só será promovido a cobertura comportamental se puder ser observado naturalmente e de modo determinístico durante uma requisição real. Verificar apenas a existência de skeleton/spinner no código permanece caracterização estática.

### Erro e retry

Não se deve desligar o backend compartilhado, interceptar globalmente infraestrutura alheia ou modificar dados para fabricar erro. Se a suíte puder isolar uma requisição no contexto exclusivo do navegador sem alterar aplicação, backend ou dados, o cenário poderá ser caracterizado; caso contrário, erro/retry continuará documentado como limitação e protegido apenas estaticamente.

Resultados: o vazio foi caracterizado no gestor por busca sem correspondência e no colaborador pelos vazios naturais do ambiente. A transição de loading não foi capturada de modo determinístico. Erro/retry não foi induzido e continua somente na caracterização estática.

## 9. Classificação dos fluxos mutáveis

Legenda:

- **A — caracterização comportamental segura:** pode ser executada contra o ambiente atual sem mudar dados;
- **B — caracterização estática suficiente para esta etapa:** preserva wiring/contrato sem executar a mutação;
- **C — necessita ambiente descartável/fixture:** o comportamento completo só pode ser comprovado com dados restauráveis e isolados;
- **D — fora do escopo da RDO B:** regra de negócio que a migração visual não pode modificar; qualquer alteração exige etapa própria.

Cada fluxo abaixo recebe uma classificação operacional principal para a A.1. Quando indicado, sua semântica de negócio também permanece fora do escopo da RDO B.

| Fluxo         | Classe A.1 | Decisão e justificativa                                                                                                                                                                                      | Regra para RDO B                                                                         |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Aprovação     | **C**      | Muda status, autoria/auditoria e possivelmente efeitos posteriores. Exige registro descartável e restauração verificável.                                                                                    | **D:** preservar ação, visibilidade, confirmação e payload; não alterar semântica.       |
| Devolução     | **C**      | Muda status e pode exigir motivo/notificação. Não executar em relatório real.                                                                                                                                | **D:** preservar regras e efeitos atuais.                                                |
| Arquivamento  | **C**      | Retira ou move registros das coleções visíveis e altera persistência.                                                                                                                                        | **D:** preservar disponibilidade e resultado contratual.                                 |
| Exclusão      | **C**      | É destrutiva e não pode ser revertida com segurança no ambiente atual.                                                                                                                                       | **D:** não tocar na regra nem executar durante migração visual.                          |
| Renumeração   | **C**      | Altera identificador de domínio e pode afetar ordenação, links e documentos.                                                                                                                                 | **D:** preservar validações e contrato atuais.                                           |
| Ações em lote | **C**      | Podem modificar vários registros e ampliar o impacto de qualquer erro. A seleção isolada é **A**, mas a confirmação do lote não é.                                                                           | **D:** migrar apenas apresentação/seleção, mantendo handlers e payloads.                 |
| Assinatura    | **C**      | Cria evidência persistente e pode mudar status/documentos. `SignatureDialog` não será alterado.                                                                                                              | **D:** preservar diálogo, validação, cache permitido e chamadas atuais.                  |
| Upload        | **C**      | Persiste arquivo/metadados e pode acionar processamento.                                                                                                                                                     | **D:** preservar limites, validações, progresso e payloads.                              |
| Autosave      | **C**      | Preencher projeto/data pode criar ou atualizar rascunho automaticamente. O formulário será aberto sem acionar os gatilhos.                                                                                   | **D:** preservar debounce, deduplicação, criação/atualização e salvamento antes de sair. |
| Polling       | **C**      | A requisição de leitura pode ser passiva, mas o portal necessário está bloqueado pelo consentimento e seus efeitos observáveis dependem de estado real. O wiring/intervalo continua protegido estaticamente. | **D:** preservar intervalo, condições de ativação, cancelamento e atualização de cache.  |

Nesta A.1, nenhuma operação da classe C será executada. A caracterização estática existente pode permanecer como guarda complementar, mas não deve ser apresentada como comprovação comportamental do efeito.

## 10. Perfis e fixtures

### Gestor, colaborador e cliente

Há credenciais de demonstração já utilizadas legitimamente na RDO A. Os testes podem repetir somente os fluxos não mutáveis descritos neste documento.

### Coordenador

Há registros ativos no ambiente, mas nenhuma credencial de teste conhecida ou versionada foi confirmada. A A.1 deve procurar apenas fixtures, seeds ou documentação já existentes. Se nenhum acesso legítimo for encontrado:

- não inventar credencial;
- não redefinir senha;
- não criar conta;
- não contornar autenticação;
- registrar a cobertura como pendente.

Esse ponto bloqueia a migração de superfícies exclusivas do coordenador, mas não necessariamente uma RDO B explicitamente limitada a superfícies já cobertas e compartilhadas, desde que a limitação seja aceita antes da implementação.

### Portal interno do cliente

O cliente conhecido está legitimamente bloqueado por consentimento pendente. O termo não será aceito apenas para viabilizar testes. A cobertura interna requer uma conta já consentida ou um snapshot descartável preparado fora desta etapa, sem bypass. Até lá, a barreira de consentimento pode ser testada, mas o portal interno permanece pendente.

## 11. Riscos restantes a avaliar ao final

- backend em outra worktree, com compatibilidade comprovada apenas nos fluxos seguros observados;
- ausência de snapshot imutável do banco, permitindo variação de contagens/dados entre execuções;
- dependência de contas de demonstração e campanhas/tutoriais condicionados por storage;
- coordenador sem credencial conhecida;
- cliente interno bloqueado por consentimento legítimo;
- impossibilidade de provar efeitos mutáveis sem fixture descartável;
- loading e erro possivelmente não determinísticos no ambiente real;
- o disclosure legado de projeto recolhe e restaura corretamente, mas não expõe `aria-expanded`; a RDO B deve corrigir a semântica sem mudar a persistência observada;
- o backend limita tentativas de login a 8 por usuário/IP em 15 minutos; a suíte é serial e consolida o gestor em uma sessão, mas reruns imediatos repetidos ainda podem atingir o limite real;
- risco de testes frágeis se dependerem de IDs, textos ou contagens voláteis em vez de estados semânticos;
- risco de confundir observação manual, presença DOM ou regex com teste comportamental.

## 12. Critérios de conclusão da RDO A.1

A etapa só pode ser considerada concluída quando:

- os testes novos interagirem de fato com o navegador (`click`, `fill`, `press`, `reload`, navegação e espera por resultado observável);
- os cenários seguros de gestor, colaborador, cliente e Estatísticas forem executados ou tiverem limitação objetiva registrada;
- a matriz de persistência tiver resultados observados, sem suposições;
- vazio for testado comportamentalmente e loading/erro forem testados ou documentados como não reproduzíveis com segurança;
- coordenador e portal interno do cliente forem marcados como cobertos ou explicitamente pendentes;
- nenhum fluxo mutável tiver sido disparado;
- toda a suíte RDO e a suíte frontend passarem;
- TypeScript, build, lint, Prettier e `git diff --check` forem executados;
- o diff comprovar ausência de alteração em código e CSS de produção;
- arquivos criados/alterados, cobertura antes/depois, limitações e riscos restantes forem listados no relatório final;
- nenhum commit for criado automaticamente;
- a RDO B permanecer não iniciada.

## 13. Resultados de execução

> Resultados consolidados da execução final da RDO A.1.

### Testes adicionados

- `frontend/e2e/rdo-access.behavior.spec.ts`: quatro testes — três do colaborador e um da barreira do cliente;
- `frontend/e2e/rdo-manager.behavior.spec.ts`: um teste consolidado do gestor com oito `test.step`;
- `frontend/e2e/support/rdo.ts`: credenciais configuráveis, login, logout e asserção do Shell legado;
- `frontend/playwright.rdo.config.ts`: execução serial isolada em Chromium, sem reutilizar servidor Vite externo;
- `frontend/tsconfig.e2e.json`: checagem TypeScript própria da infraestrutura E2E.

Foram adicionadas somente dependências de desenvolvimento: `@playwright/test@1.62.1` para a automação comportamental e `@types/node@24.13.3` para tipar a configuração e os helpers E2E. Os scripts `test:rdo:static`, `test:rdo:behavioral`, `test:rdo` e `typecheck:rdo:e2e` foram registrados em `frontend/package.json`; nenhuma dependência entra no bundle de produção.

Total: **5 testes Playwright comportamentais**. Os arquivos anteriores de baseline permanecem como 32 contratos complementares, predominantemente estáticos.

### Fluxos efetivamente executados

- colaborador: login, tutorial real avançado até o segundo passo em contexto novo, Home, relatórios pendentes/aprovados vazios, Arquivados, Serviços em andamento, abertura não preenchida do formulário inicial e logout;
- cliente: login, redirect, barreira de consentimento, não aceite, reload, tentativa de navegar a `/modulos` ainda bloqueada e logout;
- gestor: login, Shell legado, oito abas, busca/limpeza/vazio, ordenação, recolhimento de grupo, seleção entre grupos, `Carregar mais`, detalhe/retorno, reload/persistência, estatísticas e logout;
- nenhum desses fluxos confirmou ação em lote ou executou operação mutável.

A execução consolidada terminou em **5/5 testes aprovados**. O teste único do gestor concluiu suas oito etapas em 35,5 segundos. As duas falhas da exploração inicial eram defeitos do teste já corrigidos e não são contadas como falhas funcionais da aplicação.

### Fluxos somente estáticos

- loading enquanto transição observável;
- erro/retry;
- wiring dos fluxos mutáveis da seção 9;
- demais contratos DOM, fluxos Driver.js, storage não exercitado e intervalos já cobertos pelos 32 testes da RDO A.

### Bloqueios por credencial ou fixture

- coordenador: sem credencial ou fixture de teste conhecida;
- portal interno do cliente: consentimento pendente e nenhum bypass permitido;
- operações mutáveis: exigem ambiente descartável/fixture, conforme a seção 9;
- posição de scroll: ainda sem asserção comportamental determinística;
- loading e erro/retry reais: não foram fabricados e continuam apenas estáticos.

### Validações de qualidade

| Verificação                        | Resultado                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Suíte comportamental RDO A.1       | 5/5 aprovados; gestor 1/1 com oito etapas; acesso 4/4                                                     |
| Suíte RDO completa                 | 3 arquivos / 32 contratos aprovados                                                                       |
| Suíte frontend                     | 19 arquivos de teste aprovados                                                                            |
| TypeScript                         | Aprovado para produção e para a suíte E2E                                                                 |
| Build                              | Aprovado                                                                                                  |
| Lint                               | Aprovado: 0 erros; 2 warnings preexistentes                                                               |
| Prettier                           | Aprovado                                                                                                  |
| `git diff --check`                 | Aprovado                                                                                                  |
| Ausência de alterações de produção | Aprovada: alterações limitadas a testes, configuração E2E, dependências de desenvolvimento e documentação |
