# Padrao de modulo

Este documento define o formato minimo para novos modulos do FiltroAPP. A regra
principal e simples: modulo novo deve nascer com fronteira clara de backend,
frontend, permissao, teste e auditoria. O CI ja bloqueia parte desse padrao via
`npm run architecture:check`.

## Regras ja impostas pelo CI

O script `scripts/architecture-check.mjs` roda no check `Architecture` e reprova
PRs que violem estas regras:

- arquivos criticos nao podem crescer acima do budget atual:
  - `backend/src/routes/resources/reports.js`: 7497 linhas;
  - `frontend/src/pages/gestor/GestorPage.tsx`: 4581 linhas;
  - `frontend/src/pages/ReportDetailPage.tsx`: 2082 linhas;
  - `frontend/src/pages/collaborator/NewReportPage.tsx`: 1702 linhas;
- `backend/src/server.js` nao pode importar de `backend/src/routes`;
- arquivos de rota nao podem exportar jobs, queues, schedules ou processors;
- arquivo novo de dominio nao pode ser criado solto na raiz de `backend/src/lib/`.

Quando uma refatoracao reduzir um arquivo critico, o budget deve ser reduzido no
mesmo PR. O teto existe para impedir piora progressiva.

## Backend

Estrutura esperada para modulo novo:

```text
backend/src/routes/resources/<modulo>.js
backend/src/lib/<modulo>/
  access.js
  service.js
  audit.js
  jobs.js
  document.js
  notifications.js
backend/test/<modulo>.test.js
```

Arquivos opcionais devem ser criados apenas quando houver necessidade real. A rota
deve ficar fina: validar entrada, aplicar permissao e chamar servicos de dominio.

Nao colocar em rota:

- regra de negocio extensa;
- geracao de documento;
- envio de e-mail;
- job recorrente;
- sincronizacao com integracao externa;
- acesso direto a arquivo que deveria passar por helper de dominio.

Jobs vivem em `backend/src/lib/<modulo>/jobs.js`. O servidor pode importar jobs de
`lib`, nunca de `routes`.

## Frontend

Estrutura esperada para modulo novo:

```text
frontend/src/api/<modulo>.ts
frontend/src/hooks/use<Modulo>.ts
frontend/src/pages/<modulo>/<Modulo>Page.tsx
frontend/src/pages/<modulo>/components/
frontend/src/pages/<modulo>/utils/
frontend/test/<modulo>.test.mjs
```

Telas novas devem comecar pequenas. Se uma pagina passar de 700 a 900 linhas, o
modulo deve ser dividido antes de acumular mais fluxo na mesma tela.

Modulo com dashboard, tabelas, cards em grade ou formulario de multiplas colunas deve
usar o shell largo de desktop, seguindo o padrao de Equipamentos/Acompanhamento
(`.equip-page` ou equivalente documentado). Nao comprimir modulos operacionais no
container padrao de 420/540px quando houver largura disponivel.

No mobile, cards e grades devem caber na largura util da tela sem scroll horizontal de
pagina. Grades com largura minima visual devem usar padrao encolhivel, como
`minmax(min(100%, 280px), 1fr)`, e containers/filhos flex ou grid devem declarar
`min-width: 0` quando necessario. Valores longos, badges, links e linhas de acao
devem quebrar, truncar com ellipsis ou empilhar sem cortar bordas do card.

Abas, segmented controls e filtros que funcionam como abas tambem devem caber no
mobile. Use quebra de linha, grid responsivo, rolagem interna intencional ou troque por
`select`/menu mobile quando houver muitas opcoes. Rotulo longo nao pode aumentar a
largura da pagina.

Navegacao interna de modulo deve sobreviver ao refresh da pagina. Abas, secoes
laterais, filtros que funcionam como abas e detalhes que substituem a lista devem ser
representados por URL/query params (`?tab=...`, `?section=...`, `?project=...`) sempre
que nao forem sensiveis. Ao trocar para uma secao incompativel, limpar parametros
relacionados para evitar reabrir categoria/card antigo por acidente.

Campos selecionaveis (`select`, combobox, multiselect e dropdown de filtro) devem usar
o estilo compartilhado do app: borda, raio, padding, foco, disabled, erro e mobile
consistentes. Select nativo com aparencia crua do navegador e bloqueante em review.

Excecao de identidade portada (Principio VI da constitution): modulo que reproduz
fielmente um aplicativo ja aprovado pode manter a identidade visual de origem, desde que
declare a excecao na spec, escope todo o CSS sob uma raiz do modulo sem vazamento nos
dois sentidos, centralize paleta e medidas em custom properties prefixadas sem redefinir
tokens globais, e preserve os comportamentos obrigatorios (aria-invalid com mensagem,
estados de select, drag and drop compartilhado, navegacao em URL, tutorial de primeiro
acesso e ausencia de scroll horizontal no mobile). A excecao vale so para porte fiel;
modulo novo sem app de origem continua obrigado ao kit e aos tokens.

Formularios devem usar o estado visual compartilhado para obrigatorios vazios ou
invalidos. Ao tentar salvar, cada campo obrigatorio com erro deve ficar vermelho com
`.field-group.field-invalid`, mensagem `.field-error` abaixo do controle e
`aria-invalid` quando aplicavel. A validacao nativa do navegador nao substitui esse
padrao.

Reordenacao por drag and drop deve seguir o padrao compartilhado do app: handle dedicado
de arraste, placeholder com espaco e legenda da posicao atual, fantasma visual seguindo
o cursor/toque, reorganizacao ao vivo durante o arraste, cancelamento restaurando a ordem
inicial e persistencia apenas da ordem final ao soltar. Em mobile, o gesto deve funcionar
por Pointer Events ou mecanismo equivalente com `touch-action: none`; drag nativo do
navegador nao pode ser o unico suporte.

Funcao nova visivel ao usuario deve incluir divulgacao temporaria no padrao do app:

- card centralizado via Driver.js, no mesmo modelo usado para novidades como DDS;
- marcador "visto" em `localStorage`, por usuario e navegador;
- data-limite global exatamente 10 dias corridos apos a data de implementacao;
- depois da data-limite, o aviso nao aparece para ninguem, mesmo em primeiro acesso;
- tutorial guiado apontando os controles reais da funcao durante a mesma janela de
  10 dias e apenas no primeiro acesso do publico impactado.

Tutorial permanente de primeiro acesso e exigido para modulo novo. Funcao nova dentro
de modulo existente usa apenas campanha temporaria de novidade, nao onboarding
permanente.

Evitar misturar no mesmo arquivo:

- provider e hook compartilhado;
- componente React e constantes exportadas para outras telas;
- pagina, regra de negocio, normalizador de payload e UI repetida.

## Permissoes

Modulo novo deve nascer no registry compartilhado `shared/modules/registry.json`.
Esse arquivo e a fonte de verdade para:

- identificacao do modulo;
- roles publicas e codigos Prisma;
- card do hub;
- rotas principais;
- grupos de acesso usados pelo frontend;
- fallback de roles legadas.

Depois de alterar o registry, rode:

```bash
npm run modules:generate
```

O CI valida que `frontend/src/modules/registry.generated.ts` esta sincronizado
com `shared/modules/registry.json` e que os enums `AppModule` e `ModuleRoleCode`
do Prisma contem os valores declarados no registry.

Roles modulares seguem o formato:

```text
<modulo>:manager
<modulo>:viewer
<modulo>:signer
```

Evitar novas regras baseadas apenas em `MANAGER`, `COORDINATOR` ou `ADMIN`, exceto
quando a regra for realmente de administracao global.

## Scaffold

Para criar a estrutura inicial de um modulo, use:

```bash
npm run new:module -- <nome-do-modulo> --title "Nome do Modulo"
```

O scaffold cria:

- entrada em `shared/modules/registry.json`;
- arquivo gerado do frontend via `npm run modules:generate`;
- valores novos em `backend/prisma/schema.prisma`;
- migration SQL para `AppModule` e `ModuleRoleCode`;
- rota em `backend/src/routes/resources/<modulo>.js`;
- service inicial em `backend/src/lib/<modulo>/service.js`;
- teste backend inicial;
- API, hook, pagina e teste frontend iniciais;
- mount no `backend/src/routes/index.js`;
- rota no `frontend/src/modules/moduleRoutes.tsx`.

O scaffold entrega apenas a casca minima e segura. A regra de negocio real,
auditoria, documentos, jobs e testes do fluxo principal ainda precisam ser
implementados no PR do modulo.

## Banco

Tabelas de modulo devem ter, quando aplicavel:

- `createdAt` e `updatedAt`;
- `createdByUserId`;
- status explicito;
- indices para filtros e listagens principais;
- soft delete quando exclusao fisica gerar risco operacional;
- tabela de auditoria para aprovacao, assinatura, exclusao, envio externo ou
  alteracao sensivel.

Campos `Json` sao aceitaveis para formularios dinamicos, mas o contrato do payload
deve ficar validado por schema e coberto por teste.

## Ambiente

Variaveis de ambiente sao validadas em `backend/src/config/env.js` com Zod. O boot
deve falhar cedo quando:

- `DATABASE_URL` nao estiver configurado;
- variavel numerica ou booleana tiver valor invalido;
- em producao faltar `TRUST_PROXY`, `SIGNATURE_TOKEN_SECRET` ou
  `SURVEY_TOKEN_SECRET`;
- em producao `TRUST_PROXY=true` for usado.

Modulo novo que exigir env propria deve adiciona-la ao schema, documentar no
`backend/.env.example` e incluir teste em `backend/test/env.test.js`.

## Testes e CI

Todo modulo novo deve ter teste no mesmo PR. A suite minima esperada e:

- backend: teste de permissao e teste do fluxo principal;
- frontend: teste de utilitario/hook quando houver transformacao de payload ou
  estado persistido;
- arquitetura: `npm run architecture:check`;
- backend: `npm test`;
- frontend: `npm run lint`, `npm test` e `npm run build`.

O CI obrigatorio em `main` roda `Architecture`, `Backend` e `Frontend`. Nao fazer
merge quando algum desses checks falhar.

## Definicao de pronto

Um modulo novo so esta pronto quando:

- segue a estrutura de pastas deste documento;
- usa permissao modular;
- nao aumenta arquivos criticos acima do budget;
- nao cria arquivo novo solto em `backend/src/lib/`;
- nao exporta job de rota;
- tem env validada quando precisar de configuracao;
- esta registrado em `shared/modules/registry.json` e com registry gerado;
- tem teste automatizado;
- passa no CI completo.

## Referência: módulo Assinaturas

`Assinaturas` é uma implementação de referência para módulos com documentos e uma superfície pública. A fronteira de domínio está em `backend/src/lib/assinaturas/`; a rota autenticada exige `assinaturas:user`, enquanto convite e validação têm contratos públicos mínimos e independentes.

Decisões reutilizáveis desse módulo:

- segredo público no fragmento do navegador, somente em memória, e enviado à API por header dedicado; nunca em path/query, log, telemetria ou auditoria;
- escrita de PDF original/final e prévias apenas em armazenamento gerenciado, com hash de integridade;
- operações pós-commit recuperáveis por claim, retry/backoff e jobs rastreados;
- exclusão que cruza banco e filesystem usa manifesto durável e quarentena com rollback/reconciliação;
- navegação interna usa `?doc=`, `?page=`, `?tab=` e `?status=`, limpando combinações incompatíveis;
- datas de negócio são exibidas com formatador compartilhado em `America/Sao_Paulo`;
- onboarding permanente via Driver.js é marcado por usuário no `localStorage`.

Na exclusão da conta proprietária (decisão D16 da feature), documentos não concluídos são excluídos e seus bytes passam por quarentena; documentos concluídos são preservados como órfãos, com o nome histórico e a auditoria intactos.
