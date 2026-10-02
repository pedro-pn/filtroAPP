# RDO — Fase A: baseline e caracterização

Data da baseline: **20 de agosto de 2026**

Escopo: frontend React atual do módulo RDO, antes de qualquer migração visual para o Filtrovali DS.

## 1. Objetivo e limites

Esta baseline registra os contratos funcionais, visuais, responsivos, de DOM e de persistência que deverão continuar válidos durante a migração do RDO.

Nesta etapa:

- nenhum componente de produção foi criado ou alterado;
- nenhuma tela, rota, API, hook, store, permissão ou regra de negócio foi alterada;
- nenhum CSS de produção foi alterado;
- nenhum seed foi executado;
- nenhum relatório, projeto, consentimento, assinatura, rascunho ou outro dado de domínio foi criado ou modificado;
- não foram executadas ações mutáveis, downloads, uploads, aprovações, devoluções, exclusões, arquivamentos ou assinaturas;
- os logins utilizaram as contas de demonstração já existentes e foram encerrados pelo fluxo normal de logout;
- dados fictícios não foram inseridos na aplicação nem usados nas screenshots.

Os testes de acesso usam objetos mínimos somente em memória para exercitar as funções puras de autorização já existentes. Eles não criam usuários, permissões ou registros persistentes.

## 2. Ambiente utilizado e prova de origem

| Item               | Baseline                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Sistema/data       | Linux, 20/08/2026, fuso `America/Sao_Paulo`                                                                    |
| Node.js            | `v24.15.0`                                                                                                     |
| npm                | `11.12.1`                                                                                                      |
| Playwright CLI     | `0.1.18`, Chromium headless                                                                                    |
| Frontend           | Vite em `http://127.0.0.1:5173`, iniciado a partir de `frontend/` desta worktree                               |
| Branch / revisão   | `feat/frontend-redesign-2` / `e121e69b8e9cb2a4a57fae221bb83cc83495b5e6`                                        |
| Processo do Vite   | PID `1070991`; cwd `/home/relat/apps/filtroAPP-frontend-4/frontend`; binário `frontend/node_modules/.bin/vite` |
| Backend            | container `filtrovali-local-backend`, porta `4000`, `GET /health` = 200                                        |
| Banco              | PostgreSQL 16, container saudável, porta `5432`                                                                |
| Docker / Compose   | Docker `29.6.2`, Compose `v5.3.1`                                                                              |
| E-mail operacional | `SEND_CLIENT_EMAILS=false`                                                                                     |

Antes de qualquer nova captura, a origem do frontend foi verificada em três níveis:

1. havia um único Vite ouvindo na porta `5173`, e toda a cadeia de processos apontava para esta worktree;
2. o source map do módulo servido apontava para `/home/relat/apps/filtroAPP-frontend-4/frontend/src/layout/AppShell.tsx`;
3. o navegador importou o arquivo servido pela rota `/@fs/.../AppShell.tsx?raw` e calculou SHA-256 `5f12b9136983fe6045bc0b2364673196992e4bc69def900e9edee90bf9973e69`, idêntico ao arquivo local.

Como segundo guard, cada superfície RDO, exceto a barreira de consentimento do cliente, foi verificada quanto a `.app-shell` presente e `[data-testid="fv-app-shell"]`, `.fv-topbar`, `.fv-theme-toggle` e `.fv-brand-logo` ausentes. O Hub foi capturado separadamente e contém o AppShell DS, provando visualmente a diferença entre as duas arquiteturas nesta branch.

O backend que já estava ativo na porta `4000` usa bind mounts originados de `/home/relat/apps/filtroAPP-main`, não desta worktree. Ele não foi reiniciado, modificado nem substituído porque a Fase A proíbe mudanças de backend. Portanto, as capturas caracterizam com precisão o **frontend desta branch** usando o conjunto de dados reais disponibilizado por esse backend local; elas não caracterizam uma revisão de backend da branch `feat/frontend-redesign-2`.

O Vite encaminha `/api`, `/assets`, `/uploads`, `/relatorios` e `/certificados-calibracao` para esse backend local. A base já estava populada e não corresponde integralmente ao seed versionado; nenhum seed foi executado.

## 3. Perfis caracterizados

| Perfil      | Caracterização de navegador              | Resultado                                                                                                                                                                                           |
| ----------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gestor      | Sim, conta de demonstração existente     | Listas reais, abas, busca, ordenação, seleção, carregamento incremental, detalhe, estatísticas e logout validados. No momento da captura havia 17 pendentes/devolvidos e 669 aprovados.             |
| Colaborador | Sim, conta de demonstração existente     | Home com zero serviços em andamento, Meus relatórios e Arquivados vazios, início do Novo relatório sem projeto disponível, tutorial real do Hub e logout validados.                                 |
| Cliente     | Parcial, conta de demonstração existente | A autorização leva corretamente a `/rdo/cliente`, mas o consentimento de privacidade está pendente. Somente a barreira de consentimento e o logout foram validados; o consentimento não foi aceito. |
| Coordenador | Contrato automatizado apenas             | Há coordenadores ativos no ambiente, porém não há credencial conhecida/versionada. Nenhuma conta foi criada, redefinida ou adulterada.                                                              |

O cliente conhecido possui projetos e relatórios relacionados na base, mas o conteúdo do portal não pode ser aberto sem gravar a aceitação de privacidade. Para uma baseline visual completa do cliente será necessário um snapshot descartável com consentimento previamente aceito. Para o coordenador será necessária uma credencial de teste fornecida explicitamente.

O RDO atual não expõe `ThemeToggle` e não usa o novo AppShell. Light/dark foi capturado por emulação de `prefers-color-scheme` apenas para registrar o comportamento existente; isso **não** significa que o dark mode esteja funcional no RDO legado.

## 4. Rotas preservadas

Os testes de caracterização validam o registry, os aliases legados, os grupos de `RoleRoute` e os redirecionamentos sem modificar o roteamento.

| Superfície                 | Rota canônica                         |
| -------------------------- | ------------------------------------- |
| Entrada RDO                | `/rdo`                                |
| Novo relatório             | `/rdo/relatorio/novo`                 |
| Alias de novo relatório    | `/rdo/relatorios/novo`                |
| Detalhe compartilhado      | `/rdo/relatorios/:id`                 |
| Home colaborador           | `/rdo/home`                           |
| Serviços em andamento      | `/rdo/andamento`                      |
| Meus relatórios            | `/rdo/meus-relatorios`                |
| Meus relatórios arquivados | `/rdo/meus-relatorios/arquivados`     |
| Gestor                     | `/rdo/gestor`                         |
| Detalhe do gestor          | `/rdo/gestor/relatorio/:id`           |
| Coordenador                | `/rdo/coordenador`                    |
| Detalhe do coordenador     | `/rdo/coordenador/relatorio/:id`      |
| Cliente                    | `/rdo/cliente`                        |
| Detalhe do cliente         | `/rdo/cliente/relatorio/:id`          |
| Assinatura pública         | `/assinar/:token`                     |
| Validação pública          | `/validar-assinatura/:validationCode` |

Os aliases sem o prefixo `/rdo` continuam registrados. A entrada e o detalhe permanecem dependentes do perfil: colaborador, coordenador, gestor e cliente resolvem para seus caminhos atuais. O acesso de escrita continua permitido a colaborador, coordenador e gestor e negado ao cliente.

## 5. Testes de caracterização

Foram adicionados 32 testes em três arquivos, usando o Node Test Runner e, quando necessário, módulos reais carregados pelo Vite. Não foi introduzido um novo framework de testes.

| Arquivo                                                | Testes | Contratos cobertos                                                                                                                                                           |
| ------------------------------------------------------ | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/test/rdo-baseline-characterization.test.mjs` |     13 | Rotas e aliases; matriz de acesso; redirecionamentos; abas; buscas; filtros; ordenação; estados; paginação acumulada; seleção; ações; navegação; autosave; polling; logout.  |
| `frontend/test/rdo-dom-contracts.test.mjs`             |      8 | Driver.js; seletores; `data-*`; IDs; ARIA; tabs e teclado; busca; lista agrupada; assinatura.                                                                                |
| `frontend/test/rdo-persistence-contracts.test.mjs`     |     11 | `localStorage`; `sessionStorage`; snapshots; TTL; grupos; quantidade carregada; ordenação; abas do cliente; preferências do gestor; scroll; assinatura; tutorial e novidade. |

Parte da cobertura é intencionalmente estática: ela caracteriza o wiring e os contratos do código atual sem reescrever a arquitetura para obter um ambiente DOM artificial. As funções puras de acesso e ordenação também são exercitadas em runtime.

## 6. Fluxos efetivamente validados

### 6.1 Navegador com backend real

- login e logout do gestor, colaborador e cliente;
- redirecionamento de cada conta para a rota permitida pelo sistema;
- tutorial do Hub exibido ao colaborador;
- gestor: abas Pendentes, Aprovados e Estatísticas;
- gestor: busca controlada com debounce e estado vazio real após filtragem;
- gestor: persistência da busca da aba após recarregar a página na mesma sessão;
- gestor: ordenação de projetos `A→Z` e `Z→A`;
- gestor: seleção de um relatório, mudança de ordenação, grupo temporariamente não carregado e restauração da seleção após `Carregar mais`;
- gestor: barra de lote atualizada pela seleção real;
- gestor: carregamento incremental real por grupo;
- gestor: navegação de um card para a rota de detalhe específica do perfil;
- gestor: listagem responsiva, detalhe e tabela de estatísticas com scroll interno;
- colaborador: Home, Meus relatórios, Arquivados, Serviços em andamento e início do Novo relatório;
- colaborador: estados vazios reais e botão de serviço em andamento desabilitado quando não há dados;
- cliente: bloqueio por consentimento pendente, botão de aceite desabilitado até a confirmação e logout sem aceitar o termo;
- emulação light/dark para registrar a ausência atual de tematização real no RDO legado;
- ausência de erros JavaScript no console nos fluxos percorridos.

Nenhuma ação mutável foi executada. Aprovar, devolver, arquivar, excluir, alterar número, download, upload, assinatura e aceite de privacidade ficaram intocados. As três sessões terminaram com zero erros de console.

### 6.2 Contratos automatizados

- acesso por `legacyRole` e `moduleRole` para os quatro perfis;
- todos os caminhos canônicos e legados;
- redirects e paths de detalhe por perfil;
- tabs, query params, busca persistente e debounce de 300 ms;
- filtros funcionais atuais (`mine`, status, fila de revisão, projeto ativo/inativo e autor);
- tamanhos de página 25/30/50 e lotes internos de 10;
- polling do cliente em 15 segundos;
- loading inicial, loading incremental, skeleton, empty, erro e retry;
- `IntersectionObserver`, lazy ensure, sentinel e botão `Carregar mais`;
- seleção que mantém IDs fora do grupo visível;
- ações e downloads ainda conectados às APIs atuais;
- scroll salvo antes da navegação ao detalhe;
- autosave server-side do novo RDO após projeto/data, com debounce atual de 150 ms, criação/atualização e deduplicação de rascunhos;
- logout aguardado antes do redirect. O Novo relatório redireciona diretamente a `/login`; as outras páginas mantêm o destino `/`, posteriormente protegido pela autenticação.

## 7. Baseline visual

Foram geradas **46 screenshots PNG corrigidas** em `output/playwright/rdo-phase-a/`.

| Série                          | Viewports/temas                                | Quantidade |
| ------------------------------ | ---------------------------------------------- | ---------: |
| `server-origin-hub-*`          | 1280, tema system                              |          1 |
| `manager-pending-*`            | 375, 480, 768, 1024, 1280 e 1536; light e dark |         12 |
| `detail-manager-*`             | 375 e 1280; light e dark                       |          4 |
| `manager-approved-empty-*`     | 1280; light e dark                             |          2 |
| `manager-stats-*`              | seis viewports em light; 375 e 1280 em dark    |          8 |
| `manager-stats-table-*`        | recorte da tabela em 375; light e dark         |          2 |
| `collaborator-hub-tutorial-*`  | 1280, tema system                              |          1 |
| `collaborator-home-*`          | 375 e 1280; light e dark                       |          4 |
| `collaborator-reports-empty-*` | 375 e 1280; light e dark                       |          4 |
| `collaborator-new-report-*`    | 375 e 1280; light e dark                       |          4 |
| `client-consent-*`             | 375 e 1280; light e dark                       |          4 |

O diretório oficial foi limpo antes da nova execução. As 44 imagens geradas contra o servidor incorreto foram retiradas da baseline e movidas de forma recuperável para `/tmp/rdo-phase-a-invalid-server-20260820-1303`; elas não fazem parte da contagem nem devem ser usadas em comparações.

`server-origin-hub-1280-system.png` funciona como testemunho visual de origem: mostra o Hub com AppShell DS. Já todas as séries do RDO mostram o Shell legado estreito esperado nesta branch. A série `manager-pending-*` fornece a comparação principal nos seis viewports. O conjunto de arquivos tem hash agregado SHA-256 `b6caec6f1a3e6af4121f7c5d084da22e7fcab0b8004591a77359ad2289f96023` na ordem lexical dos nomes.

## 8. Baseline responsiva e problemas existentes

As medições abaixo registram o comportamento atual; não são correções nem novos critérios de layout.

### Contrato estrutural medido

O RDO não usa o novo breakpoint/layout do DS. O `.app-shell` legado permanece limitado a 540 px e centralizado:

| Viewport | Largura do Shell | Margem esquerda medida |
| -------: | ---------------: | ---------------------: |
|   375 px |           375 px |                   0 px |
|   480 px |           420 px |                  30 px |
|   768 px |           540 px |                 114 px |
|  1024 px |           540 px |                 242 px |
|  1280 px |           540 px |                 370 px |
|  1536 px |           540 px |                 498 px |

Não houve overflow horizontal no documento nas superfícies medidas, mas isso não significa pleno aproveitamento ou ausência de overflow interno.

### 375 px

- lista, detalhe e formulário permanecem dentro do Shell legado e não montam BottomBar/Drawer do DS;
- os cards de relatório concentram checkbox, status e até seis ações pequenas no mesmo item;
- o detalhe possui 56 alvos abaixo de 44 px e 20 controles de texto abaixo de 16 px na amostra real;
- o Novo relatório mostra 6 inputs/selects visíveis, dos quais 3 têm fonte abaixo de 16 px, mantendo risco de zoom no iOS;
- a tabela estatística tem largura de 440 px dentro de uma área útil de 313 px e depende de scroll horizontal interno;
- o painel de consentimento mede 327 px dentro da viewport, sem Shell nem overflow no documento;
- alguns emojis/ícones legados aparecem como glifos ausentes no Chromium do ambiente.

### 480 px

- o Shell mede 420 px, deixando 30 px de margem em cada lado;
- a tabela estatística ainda tem 440 px dentro de wrapper de 358 px e usa scroll horizontal;
- o formulário continua com 3 de 6 controles de texto abaixo de 16 px;
- cards e ações continuam visualmente compactos, embora sem overflow no documento.

### 768 px

- o Shell atinge seu teto de 540 px e deixa 114 px de margem lateral;
- tabs e ações permanecem na composição legada; não há NavigationDrawer;
- a tabela passa a 550 px dentro de wrapper de 478 px e continua exigindo scroll horizontal interno;
- o ganho de viewport não se converte em maior área útil para o conteúdo RDO.

### 1024 px

- o Shell continua em 540 px; não há Sidebar do DS;
- as ações por relatório permanecem densas em cards horizontais;
- a tabela continua com 550 px dentro de wrapper de 478 px e scroll interno;
- o documento não apresenta overflow horizontal global.

### 1280 px

- 740 px da viewport ficam fora do Shell de 540 px;
- listagem, detalhe e formulário não aproveitam a largura desktop disponível;
- a tabela estatística permanece limitada e rolável internamente, em vez de se expandir;
- o alto número de ações por relatório força quebras e densidade visual dentro dos cards.

### 1536 px

- 996 px da viewport ficam fora do Shell de 540 px;
- o layout é visualmente idêntico ao de 1024/1280 em largura útil;
- a tabela permanece em 550 px, não em largura ampla;
- não há overflow global, mas também não há ganho de legibilidade com a tela larga.

### Tema

O RDO atual não possui alternador de tema. Os aliases legados (`--bg`, `--wh`, `--tx`, `--g` e relacionados) permanecem definidos com valores claros em `:root` e suas superfícies não consomem os tokens semânticos dark do DS. Por isso as capturas `*-dark.png`, geradas com `prefers-color-scheme: dark`, permanecem essencialmente claras. Isso é um problema conhecido a ser corrigido na migração, não uma validação de dark mode funcional.

## 9. Contratos DOM que não podem ser quebrados

### Driver.js e tutoriais

O `ClientTutorial` consulta os seguintes alvos:

- `.client-welcome-card`;
- `.stats-grid`;
- `input[aria-label="Buscar relatórios"]`;
- `.filter-tabs[aria-label="Projetos do cliente"]`;
- `.det-section`;
- `.filter-tabs[aria-label="Tipos de relatório"]`;
- `.client-report-card` e suas ações;
- `.client-report-comment textarea`;
- `.signature-progress`;
- `.report-batch-toolbar`;
- `.topbar-chip`.

Os tours contextuais também dependem de:

- `data-client-report-tab`;
- `data-client-report-id`;
- `data-client-report-checkbox`;
- `data-client-batch-signature-button`.

A campanha DDS depende de `[data-dds-novelty]`, produzido no toggle diurno e consultado por `RdoDdsNovelty`/Driver.js.

### Formulário e validação

Devem ser preservados ou receber adaptadores compatíveis:

- IDs `rdo-project`, `rdo-date`, `rdo-arrival`, `rdo-departure`, `rdo-lunch`, `rdo-overtime` e `rdo-description`;
- `data-invalid-target` para projeto, data, horários, equipe, DDS, standby, noturno e lista vazia de serviços;
- `data-service-id` e a busca descendente por `.field-invalid input`;
- tablist `aria-label="Etapas do relatório"`, tabs e `aria-selected`.

### Listagens e assinatura

- tablists `Status dos relatórios`, `Seções do coordenador`, `Seções do gestor`, `Projetos do cliente` e `Tipos de relatório`;
- navegação horizontal das tabs por teclado;
- busca `type="search"`, nome acessível, botão `aria-label="Limpar busca"` e contagem `exibidos de total`;
- grupos expansíveis ativáveis por Enter/Espaço e anúncio da quantidade visível;
- `signature-dialog-title`, `signature-signer-name`, `signature-dialog-error`;
- nomes acessíveis `Fechar`, `Modo de assinatura` e `Área para desenhar assinatura`.

## 10. Contratos de persistência

Nenhuma chave foi renomeada ou removida.

### `sessionStorage`

- buscas por usuário e aba:
  - `my-reports-search:<identidade>:<tab>`;
  - `my-archived-search:<identidade>`;
  - `coordinator-search:<id>:<tab>`;
  - `gestor-search:<id>:<tab>`;
  - `client-search:<identidade>`;
- snapshot acumulado: `accumulated-reports:<identidade>:<filtros codificados>`, versão 1, TTL de 30 minutos, página, itens, totais e quantidades carregadas por grupo;
- posição de scroll: `filtrovali:page-scroll:<identidade>:<rota+query>`.

### `localStorage`

- grupos de colaborador, coordenador e gestor, isolados por usuário/aba, contendo projetos e tipos recolhidos, quantidade visível e direção de ordenação;
- cliente: `filtrovali-client-tabs:<identidade>`, com projeto ativo, tipo por projeto, tipos recolhidos e ordenação;
- gestor: `gestor-ui-prefs:<id>` e `gestor-project-details-collapsed:<id>`;
- assinatura: `filtrovali.signature.v1:<identidade normalizada>`;
- tutorial do cliente: prefixo `filtrovali-tutorial-done`;
- dica de assinatura em lote: prefixo `filtrovali-client-batch-signature-tip-done`;
- novidade DDS: `filtrovali:rdo-dds-novelty:v2:<id>`.

O cache de assinatura persiste somente o nome do signatário. A imagem desenhada não pode voltar a ser persistida. O estado transitório do editor permanece na store em memória; o rascunho é salvo pelas APIs atuais, não por uma nova chave de browser storage.

### Ordenação e quantidade carregada

- ordem de tipos atual: RDO, RTP, RCPU, RLF e demais tipos;
- projetos usam comparação numérica quando possível;
- relatórios dentro do grupo seguem número sequencial ascendente/descendente;
- a janela carregada é segmentada por projeto, tipo, page size e direção;
- `Carregar mais` preserva os itens já acumulados e não equivale a uma paginação plana.

## 11. Limitações e bloqueios

| Fluxo                                                | Motivo de não validação end-to-end                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Backend desta branch                                 | O processo já ativo usa mounts de outra worktree. Não foi substituído porque esta fase proíbe alterar backend.                  |
| Coordenador no navegador                             | Não há credencial de teste conhecida/versionada.                                                                                |
| Portal interno do cliente                            | Consentimento pendente; aceitar gravaria um dado que esta etapa não autoriza alterar.                                           |
| Tutorial específico do cliente                       | Fica depois da barreira de consentimento.                                                                                       |
| Dark mode real do RDO                                | O módulo não expõe ThemeToggle nem consome os tokens dark do DS; apenas a preferência do navegador foi emulada.                 |
| Loading visual                                       | O backend local respondeu rápido demais; não foi introduzido delay artificial.                                                  |
| Erro/retry visual                                    | Não foi derrubada a rede nem forçada resposta falsa. O wiring foi caracterizado estaticamente.                                  |
| Aprovar, devolver, arquivar, excluir, alterar número | São operações mutáveis; somente o vínculo estático com as mutations existentes foi caracterizado.                               |
| PDF/DOCX e lote                                      | Não foram acionados porque podem gerar/cachear artefatos no servidor.                                                           |
| Assinatura e rejeição                                | Exigem token/estado real e alteram dados. `SignatureDialog` permaneceu intocado.                                                |
| Autosave end-to-end                                  | O colaborador não possui projeto acessível e dispará-lo criaria/alteraria rascunho. O contrato foi caracterizado estaticamente. |
| Polling do cliente                                   | O intervalo de 15 s foi validado no código, mas o portal está bloqueado pelo consentimento.                                     |
| Assinatura pública válida                            | O ambiente não fornece token ou código de validação reproduzível.                                                               |

Os totais e registros visíveis são um retrato da base em 20/08/2026 e podem mudar. As screenshots, os hashes e os contratos de código são a parte reproduzível; para reproduzir os mesmos dados será necessário um snapshot explícito da base, que não foi criado nesta etapa.

## 12. Comportamentos que devem permanecer inalterados

- registry, permissões, `RoleRoute`, `PrivateRoute`, paths e aliases;
- filtros funcionais e status enviados às queries;
- busca com debounce de 300 ms e persistência por aba/usuário;
- polling do cliente em 15 segundos;
- estrutura projeto → tipo → relatório;
- ordenação de projeto, tipo e sequência;
- expansão/recolhimento e quantidade visível de cada grupo;
- paginação acumulada, lazy loading, sentinel e botão `Carregar mais`;
- seleção limitada aos relatórios visíveis, preservando IDs já selecionados fora do grupo;
- ações e visibilidade condicionadas a perfil, status e assinatura;
- navegação ao detalhe com estado de retorno e restauração de scroll;
- autosave de rascunho, debounce de 150 ms, deduplicação e salvamento antes de voltar;
- estados loading, updating, empty, erro e retry;
- tutoriais, campanhas, seletores Driver.js e chaves existentes;
- cache de assinatura somente com o nome, nunca com a imagem;
- logout aguardado e destinos atuais;
- conteúdo, dados, APIs, uploads, assinatura e regras de validação atuais.

## 13. Validação da baseline corrigida

- `npm run build`: aprovado; TypeScript e Vite concluíram, com 2.323 módulos transformados;
- `npm run lint`: aprovado com 0 erros e 2 warnings preexistentes fora do RDO (`OmieCostCategoriesPanel.tsx` e `ProjectTrackingNovelties.tsx`);
- `npm test`: 19/19 arquivos de teste aprovados;
- testes RDO direcionados: 32/32 aprovados;
- Prettier: aprovado nos quatro arquivos da Fase A;
- `git diff --check`: aprovado;
- 46/46 PNGs existem, são não vazios e foram inspecionadas amostras representativas;
- console do navegador: 0 erros nas sessões de gestor, colaborador e cliente;
- análise do grafo: os quatro arquivos da Fase A afetam 0 fluxos de produção.

Esta baseline é o ponto de comparação para o RDO B. Ela não autoriza o início da migração.
