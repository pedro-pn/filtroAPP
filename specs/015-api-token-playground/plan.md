# Implementation Plan: API Playground e tokens de integração

## Incremento operacional — 2026-09-08

Publicar o subconjunto operacional definido no adendo da spec. Usar descritores internos imutáveis com modelo, campos tipados, predicado de publicação e política de projetos explícitos; compartilhar somente a mecânica de consulta paginada/serialização, sem CRUD genérico nem modelo, campos ou ordenação escolhidos pelo consumidor. Router externo e simulação admin usam o mesmo serviço. Catálogo e console passam a compartilhar operações do servidor. Testes verificam descritores contra o schema Prisma, isolamento e contrato OpenAPI. Não altera schema de banco, credenciais existentes nem infraestrutura. Candidatos financeiros/pessoais/arquivos continuam bloqueados.

## Expansão de relatórios, estoque e manutenção — 2026-09-08

Publicar exclusivamente os 16 candidatos restantes desses grupos conforme `contracts/operational-expanded-read.md`. Descritores tipados ganham campo temporal e chave de ordenação explícitos, com `createdSince` para modelos sem atualização e chave composta para equipe. Cada consulta valida dependências, filtros específicos e recorte de projetos. Custos são projeção separada de `StockMovement`; assinaturas/auditoria são metadados reduzidos. Três downloads compartilham visibilidade com a listagem, validam propriedade/pasta e abrem somente arquivos locais gerenciados sem symlinks (50 MiB), usando cotas e registro de bytes existentes. Novos parâmetros são alimentados pelo catálogo no console. Testes abrangem todos os descritores, dependências, pais não publicados, arquivos inválidos, paginação e dispatch da simulação. Sem dependências novas, schema, migração, alteração automática de tokens ou deploy.

**Branch**: `015-api-token-playground` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/015-api-token-playground/spec.md`

## Summary

Correções da revisão: validar parâmetros tipados e cursores administrativos antes de Prisma; reutilizar schemas compartilhados nos formulários de ciclo de vida; permitir redução real de política e configuração explícita da substituta. Paginação por cursor e seleção de credencial/detalhe são estado navegacional da URL, com carregamento direto por ID independente da página. Falhas de teste preservam status/código/requestId em envelope seguro, sem sucesso obsoleto ou segredo. Catálogo de Qualidade declara os campos dos serializadores. Contrato detalhado em `contracts/admin-corrections.md`, tarefas T107–T115. Sem schema novo, migração, novos escopos ou deploy.

Incremento de Testar API: adicionar descritores explícitos de parâmetros ao catálogo existente; renderizar formulário único RHF/Zod, filtrar operações por permissão (incluindo escopos opcionais) e limpar estado ao trocar credencial/operação. Executor reutiliza serviços de domínio e abertura segura de arquivos para DOWNLOAD_CHECK, fecha handles e retorna somente JSON de disponibilidade, id, MIME e tamanho. Não cria HTTP proxy nem transmite arquivo. Cobertura exige todas as 35 operações/33 permissões e negações de estado/escopo/projeto/arquivo. Atualizar OpenAPI e tutorial existente, sem migrar banco ou iniciar servidor.

Criar, dentro do módulo administrativo existente, um painel em três etapas para emissão e teste de credenciais de integração somente leitura. A solução usará tokens opacos próprios — não OAuth — com segredo revelado uma única vez, verificador não reversível, escopos registrados em código, validade, restrição de projetos/IP, cotas persistentes, rotação, revogação e auditoria redigida. Uma nova árvore `/api/integracoes/v1` autenticará apenas esses tokens e publicará inicialmente registros, naturezas e evidências autorizadas de Qualidade por projeções externas explícitas e paginação por cursor. Os 126 modelos Prisma atuais foram inventariados em [contracts/data-catalog.md](contracts/data-catalog.md); domínios futuros permanecem não concedíveis até passarem pelo mesmo gate de contrato, minimização, autorização e testes.

## Technical Context

**Language/Version**: Backend Node.js ESM/JavaScript; frontend TypeScript 5.8 e React 19

**Primary Dependencies**: Express 5.2, Prisma 7.9, PostgreSQL, Zod 4.4, Node `crypto`, React Router 8.3, TanStack Query 5.101, React Hook Form 7.81, Driver.js 1.8; adicionar uma biblioteca pequena e auditada de CIDR/IP como dependência direta caso o parser existente não cubra IPv4 e IPv6

**Storage**: PostgreSQL via Prisma para credenciais, concessões, projetos permitidos, eventos, uso e cotas; segredo completo nunca é persistido

**Testing**: `node --test` em `backend/test/*.test.js` e `frontend/test/*.test.mjs`; build TypeScript/Vite e verificação de arquitetura existentes

**Target Platform**: Aplicação web responsiva servida por Linux/Nginx, com consumo da API externa exclusivamente sobre HTTPS

**Project Type**: Aplicação web monorepo com SPA React e API Express

**Performance Goals**: validação de token e autorização com p95 inferior a 100 ms sem contar a consulta de domínio; páginas de até 500 registros de Qualidade com p95 inferior a 1 s no volume corrente; revogação/redução de privilégio observada na chamada seguinte; painel interativo sem bloquear durante consultas e auditorias

**Constraints**: somente leitura; somente contas `ADMIN` gerenciam tokens; token nunca em URL/cookie/storage do navegador/log; nenhum destino arbitrário no playground; paginação obrigatória; `Cache-Control: no-store`; CORS da árvore externa desabilitado por padrão; sem acesso direto ao banco pelo colaborador; todas as alterações de esquema por migração Prisma

**Scale/Scope**: 126 modelos atuais classificados em 20 domínios; 1 tela administrativa principal com lista/detalhe/playground; 5 escopos de Qualidade inicialmente concedíveis; demais escopos catalogados para ativação incremental; limite global inicial de 500 itens por página, configurável para valores menores por credencial

## Constitution Check

*GATE: aprovado antes da pesquisa e reavaliado após o desenho.*

- **Operação**: PASS — este plano não executa servidor, Docker, migração ou deploy. Os comandos operacionais aparecem apenas no quickstart para execução humana posterior.
- **UI pt-BR e mobile-first**: PASS — a tela usa o shell amplo existente; listas viram cartões, painéis empilham e somente blocos de código podem rolar internamente.
- **Validação compartilhada**: PASS — esquemas Zod de credencial, filtros, cursores e operações ficam em `shared/schemas`, usados no backend e adaptados ao RHF no frontend.
- **Persistência**: PASS — seis novas entidades são introduzidas por uma migração Prisma versionada, sem SQL ad hoc.
- **Testes de regra**: PASS — autenticação, matriz de escopos, validade, rotação, filtros, cotas, cursor e projeção segura têm testes unitários/integração no backend.
- **Consistência visual**: PASS — serão reutilizados `Button`, `Modal`, `ConfirmDialog`, `SearchBar`, `SearchCombobox`, `HelpTip` e `Skeleton`, com os estados compartilhados de formulário. Os botões diretos/estilos locais encontrados em `AdminAccountsPage` não serão copiados.
- **Drag and drop**: N/A — a funcionalidade não reordena itens; escopos são agrupados e pesquisados.
- **Novidade e tutorial**: PASS — por ser uma função dentro do módulo Admin, terá selo/cartão de novidade e tutorial Driver.js somente durante os 10 dias posteriores à data registrada de implementação, com marcador visto por usuário/navegador.
- **Navegação persistente**: PASS — rota `/admin/tokens` e query params guardam etapa, filtros, operação e identificadores não secretos; segredo e resposta nunca vão para URL ou storage.
- **Identidade portada**: N/A — o Google OAuth 2.0 Playground inspira apenas o fluxo; o design continua sendo o do FiltroApp.

**Evidência visual obrigatória:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Lista e detalhe de credenciais | `frontend/src/pages/admin/AdminAccountsPage.tsx`; `admin-toolbar`, `page-card`, `admin-card-grid` | `Shell`, `TopBar`, `SearchBar`, `Button`, `Skeleton`, `ConfirmDialog` | busca, status, escopo, campos obrigatórios, loading, vazio, erro e disabled | N/A | `/admin/tokens` com `status`, `scope`, `q`, `cursor` e `credential` | selo Novo + tutorial por 10 dias | tabela desktop vira cartões; `min-width: 0`; ações quebram linha; sem scroll da página |
| Fluxo em três etapas e permissões | Google OAuth 2.0 Playground como referência funcional; `OperationsPage.tsx` para cards/painéis | `Button`, `SearchBar`, `SearchCombobox`, `HelpTip`, cards/badges compartilhados | checkbox acessível; disponível/sensível/planejado/proibido; required-empty vermelho; focus/disabled/error | N/A | `etapa` e `operation` no query string; seleção em estado do formulário | tutorial apresenta menor privilégio, validade e teste | duas colunas no desktop; pilha no celular; seletor de etapa compacto; badges envolvem |
| Revelação/rotação/revogação | `frontend/src/components/ui/Modal.tsx`; `ConfirmDialog.tsx` | `Modal`, `Button`, aviso e rodapé compartilhados | confirmação digitada, justificativa, falha de cópia e validação temporal | N/A | N/A porque contém segredo transitório | etapa própria do tutorial e aviso em cada emissão | modal limitado à viewport, corpo rolável e rodapé fixo; segredo quebra visualmente sem alterar cópia |
| Console de requisição/resposta | `frontend/src/pages/OperationsPage.tsx`; `page-card` | cards, badges de status, `Button`, `Skeleton`, área monoespaçada | somente filtros registrados; loading, sucesso, erro seguro e truncamento | N/A | operação/filtros não sensíveis na URL; resultado e segredo não | tutorial destaca autorização redigida e variável de ambiente | painéis lado a lado no desktop e empilhados no mobile; código tem scroll interno isolado |

### Reavaliação pós-desenho

PASS. O modelo de dados, o contrato HTTP, o catálogo e o quickstart preservam todos os gates. Não há exceção constitucional nem débito visual herdado necessário.

## Project Structure

### Documentation (this feature)

```text
specs/015-api-token-playground/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── contracts/
    ├── openapi.yaml
    ├── data-catalog.md
    └── ui-flow.md
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_api_credentials/
├── src/
│   ├── lib/
│   │   ├── api-credentials/
│   │   │   ├── catalog.js
│   │   │   ├── token.js
│   │   │   ├── service.js
│   │   │   ├── authorization.js
│   │   │   ├── quota.js
│   │   │   ├── audit.js
│   │   │   └── cursor.js
│   │   └── qualidade/
│   │       └── public-serializer.js
│   ├── middleware/
│   │   └── api-token-auth.js
│   └── routes/
│       ├── index.js
│       ├── resources/api-credentials.js
│       └── integrations/v1/
│           ├── index.js
│           └── qualidade.js
└── test/
    ├── api-credentials.test.js
    ├── api-token-auth.test.js
    ├── api-token-quota.test.js
    ├── integration-quality-api.test.js
    └── integration-quality-contract.test.js

shared/
├── schemas/
│   ├── api-credentials.js
│   └── integration-api.js
└── modules/registry.json

frontend/
├── src/
│   ├── components/admin/api-tokens/
│   │   ├── ApiCredentialForm.tsx
│   │   ├── ApiScopeCatalog.tsx
│   │   ├── ApiTokenRevealModal.tsx
│   │   ├── ApiRequestConsole.tsx
│   │   └── ApiCredentialCards.tsx
│   ├── pages/admin/AdminTokensPage.tsx
│   ├── modules/moduleRoutes.tsx
│   ├── styles/base.css
│   └── api/apiCredentials.ts
└── test/
    ├── admin-api-tokens-access.test.mjs
    ├── admin-api-tokens-form.test.mjs
    └── admin-api-tokens-responsive.test.mjs

```

**Structure Decision**: Manter o monorepo web existente. A autenticação de credencial e a API externa ficam isoladas das rotas de sessão; regras reutilizáveis ficam em `backend/src/lib/api-credentials`. As projeções públicas vivem junto ao domínio de origem, mas são chamadas apenas pelo roteador versionado de integrações. O painel entra como segunda rota do módulo `admin`, declarada na fonte `shared/modules/registry.json` e regenerada pelo script existente, não por edição manual do registry gerado.

## Delivery Phases

### Phase 0 — Fundamentos e contratos

- Congelar códigos de escopo/operação e o envelope v1 conforme `contracts/openapi.yaml`.
- Adicionar schemas compartilhados para criação, restrições, listagem, filtros e parâmetros de Qualidade.
- Criar a migração Prisma e serviços de token, autorização, cursor, auditoria e cotas.
- Implementar testes de propriedade do segredo: formato, entropia, verificador, comparação constante e ausência em serializações/logs.

### Phase 1 — Administração segura

- Montar `/api/admin/api-scopes` e `/api/admin/api-credentials` sob `requireAuth` + `requireHubAdmin`. No frontend, usar o grupo `admin` com `allowedAccountTypes: ['ADMIN']`; não usar isoladamente o helper legado `isHubAdmin`, que também considera o papel `MANAGER`.
- Entregar criação, listagem, detalhe, redução de escopo, rotação, revogação, eventos, uso e teste por operação allowlisted.
- Implementar `/admin/tokens`, navegação interna do Admin, revelação única em memória e tutorial temporário.
- Impedir aumento silencioso de privilégio: adição de escopo/recurso exige rotação.

### Phase 2 — API de Qualidade v1

- Montar `/api/integracoes/v1` com middleware próprio que não tente autenticação humana e aceite somente Bearer no formato de integração.
- Criar projeções públicas de natureza, registro e evidência, sem reutilizar serialização interna irrestrita.
- Entregar lista/detalhe de registros, lista de naturezas e download autenticado de evidência; aplicar projeto, excluídos, paginação, sincronização incremental e cotas.
- Validar o OpenAPI por testes de contrato e matriz completa de escopos/negações.

### Phase 3 — Observabilidade, hardening e UX

- Completar eventos imutáveis, registros de uso redigidos, alertas de expiração e agregação das cotas.
- Aplicar limite grosseiro por IP antes da busca da credencial, limites de corpo/query/tempo, headers de não cache, CORS fechado e tratamento uniforme de erros.
- Testar teclado, leitor de tela, 360/768/desktop, resposta longa, falha de cópia e estados vazios.
- Registrar a data real de implementação e expirar globalmente novidade/tutorial exatamente dez dias depois.

### Phase 4 — Expansão governada

- Para cada domínio planejado no catálogo, criar uma entrega separada que defina finalidade, campos públicos, base legal quando aplicável, operação, escopo, limites e testes.
- Só então mudar o estado do escopo para concedível. Modelos reservados/proibidos nunca são expostos por serialização genérica.

## Complexity Tracking

Nenhuma violação constitucional identificada.
