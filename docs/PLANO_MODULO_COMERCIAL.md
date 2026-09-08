# Plano de reescrita — Módulo Comercial (Gerador de Propostas)

Plano de execução para reescrever o rascunho de `~/comercialAPP` na stack do
FiltroAPP (React + Vite no frontend, Express + Prisma no backend), usando o
schema `comercial` do mesmo PostgreSQL.

- **Escopo:** reescrita fiel, sem alteração de funcionalidade.
- **Dados:** o app nunca entrou em produção — o D1/SQLite atual é descartado.
  Não há migração de dados.
- **Base do estudo:** `~/comercialAPP` (rascunho) e FiltroAPP em `main` (`d70b182`).
- **Substitui:** `~/comercialAPP/PLANO-PRODUCAO.md` (plano de portar o app
  Cloudflare como serviço separado), que fica obsoleto.

---

## 1. Decisão: pasta única, módulo do FiltroAPP

**Recomendação: desenvolver dentro do repositório do FiltroAPP, como o módulo
`comercial`.** Manter `~/comercialAPP` apenas como **referência somente-leitura**
do comportamento a ser reproduzido, sem desenvolvimento ativo.

### Por quê

1. **A stack passa a ser a mesma.** Depois da reescrita não existe diferença
   técnica entre o comercial e os outros 8 módulos. Dois repositórios com a mesma
   stack, o mesmo banco e o mesmo deploy só duplicam trabalho.
2. **O FiltroAPP já tem o padrão pronto** — `docs/PADRAO_MODULO.md`,
   `npm run new:module`, registry compartilhado, `architecture:check` no CI.
   Fora do repo, nada disso vale.
3. **Autenticação sai de graça.** `User`, `UserSession`, `ModuleRole` e o
   middleware `requireAuth` já existem. Isso apaga **772 linhas** do rascunho
   (auth própria, PBKDF2, rate limit, tela de login, `chatgpt-auth.ts`) e
   elimina o segundo cadastro de usuários e o segundo offboarding.
4. **É o objetivo final do projeto.** Alimentar `CommercialProposal` e
   `ProjectBudget` vira chamada Prisma na mesma transação — sem token de
   serviço, sem contrato HTTP, sem fila de reenvio, sem período de dupla escrita.
5. **Produção fica mais simples, não mais complexa:** nenhum container novo,
   nenhum Dockerfile novo, nenhum job de backup novo.

### O que você não perde

DNS próprio continua existindo. O repositório **já resolve exatamente esse caso**:
`relatorios.filtrovali.com.br` redireciona para `app.filtrovali.com.br/rdo`
(`deploy/nginx/default.conf:20-46`). O mesmo padrão serve
`comercial.filtrovali.com.br` → `app.filtrovali.com.br/comercial`, com a
vantagem de a sessão ser compartilhada (mesma origem, mesmo cookie).

### O que você perde

- Cadência de release independente: o comercial sobe junto com a operação.
- Blast radius compartilhado: o módulo roda no mesmo processo Express.
  Mitigação: o código é aditivo (rotas e libs novas), e o CI já cobre o resto.

### Se preferir repositório separado mesmo assim

É viável, com este custo adicional: duplicar `Dockerfile`/compose/nginx/cert,
manter uma cópia do `shared/` e do cliente Prisma, e recriar autenticação —
ou expor um endpoint de validação de sessão entre os dois. Estime **+4 a 6 dias**
na entrega inicial e manutenção permanente dobrada em auth e deploy. Todo o
resto deste plano continua válido; muda apenas onde os arquivos moram.

---

## 2. Descobertas que definem o esforço

O rascunho tem ~15.900 linhas nos arquivos principais. Elas se dividem em três
grupos com custos muito diferentes:

### 2.1 Porta por cópia — ~6.500 linhas (regra de negócio pura)

Estes arquivos **não têm nenhum `import`** (verificado): são TypeScript puro,
sem React, sem Next, sem Cloudflare.

| Arquivo | Linhas | Conteúdo |
|---|---|---|
| `lib/cost-model.ts` | 4.529 | Motor de custos LEC completo: cargos, jornada, HE 70/100, insalubridade, adicional noturno, despesas por base de cálculo, indiretos, materiais, circuitos/volumes, produtos químicos, filtros, efluente, logística, impostos, comissões, margem, QQP |
| `app/technical-services.ts` | 454 | Catálogo técnico (flushing, filtragem, desidratação, limpeza química, hidrojateamento, PIG, teste hidrostático, pré-engenharia, limpeza de reservatório) |
| `app/scope-content.ts` | 192 | Blocos de escopo (tabelas e fotos com legenda) |
| `lib/finalization.ts` | 168 | Nomes de arquivo, limites de upload, estágios da finalização |
| `lib/nectar-pipelines.ts` | 129 | Reconhecimento dos dois funis autorizados |
| `app/proposal-visuals.ts` | 79 | Imagens por tipo de serviço |
| `lib/cnpj.ts` | 34 | Validação/formatação (o FiltroAPP já tem `backend/src/lib/cnpj.js` — conferir sobreposição) |
| `app/proposal-pdf.ts` | 908 | Montagem dos PDFs comercial e técnico (só depende de tipos do `jspdf`). Vai para o **backend** — ver §5.3; trocam-se apenas 2 helpers de imagem (~50 linhas) por `sharp` |

**Consequência:** a inteligência do app — o que é caro de reescrever e fácil de
quebrar — não precisa ser reescrita. Precisa de casa nova e de build.

### 2.2 Porta com adaptação mecânica — ~5.200 linhas (UI)

As três telas são `"use client"` e usam apenas `useState`/`useMemo`/`useEffect`.
**Não há Server Component, Server Action nem `next/headers` nas telas.** A
superfície específica do Next é minúscula: 4 × `next/link`, 2 × `next/image`,
1 × `next/navigation`.

| De | Para |
|---|---|
| `"use client"` | remover |
| `next/link` | `Link` do `react-router-dom` |
| `next/image` | `<img>` |
| `next/navigation` | `useNavigate` |
| `useAuth` do `auth-context` | `useAuth` de `frontend/src/auth/AuthContext` |
| `fetch("/api/…")` | `frontend/src/api/client.ts` (axios) + **`@tanstack/react-query`** para estado de servidor (stack fixada) |
| `useState` em formulário | **`react-hook-form` + resolver Zod** (Princípio III) — ver §10 |
| CSS próprio | **portado integralmente**, escopado em `.comercial-app` (§5.6) — exige emenda §10.1 |
| Tailwind (`@import "tailwindcss"`) | **descartar** — o JSX praticamente não usa utilitários |

### 2.3 Reescreve de fato — ~3.200 linhas (persistência e API)

`db/*.ts` (1.276) + 9 rotas de API (~1.930, das quais `finalize` sozinha tem
1.172) viram Prisma + Express. Aqui a reescrita é real, mas o comportamento é
todo conhecido e testável.

### 2.4 Descarta — 772 linhas

Auth própria (`lib/app-auth.ts`, `lib/auth-crypto.ts`, `db/auth.ts`,
`app/login/page.tsx`, `app/auth-gate.tsx`, `app/auth-context.tsx`,
`app/chatgpt-auth.ts`) e as tabelas `app_users`, `app_sessions`,
`auth_login_attempts`.

---

## 3. Arquitetura alvo

### 3.1 Onde cada coisa mora

```text
shared/
  comercial/                       # regra de negócio compartilhada (TypeScript)
    src/cost-model.ts              #   cópia literal do rascunho
    src/technical-services.ts
    src/scope-content.ts
    src/proposal-visuals.ts
    src/finalization.ts
    src/nectar-pipelines.ts
    dist/                          #   gerado por tsc (.js + .d.ts) — consumido pelos dois lados
  schemas/comercial.js|.d.ts       # schemas zod (padrão dos módulos existentes)

backend/
  prisma/schema.prisma             # + models no schema `comercial`
  src/routes/resources/comercial.js
  src/lib/comercial/
    access.js                      # permissões do módulo
    cost-estimates.js              # levantamentos + versões + atribuições
    proposals.js                   # propostas, histórico, arquivos
    storage.js                     # PDFs e fotos em disco
    nectar.js                      # cliente do CRM
    sharepoint.js                  # Microsoft Graph
    finalize.js                    # orquestração da finalização
    proposal-pdf.js                # porte de proposal-pdf.ts para pdf-lib — §5.3
    pdf-images.js                  # carga/redução de imagem com sharp
    cost-csv.js                    # CSV do levantamento anexado ao SharePoint
    jobs.js                        # integrações pós-resposta
  test/comercial*.test.js

frontend/
  src/api/comercial.ts
  src/hooks/useComercial.ts
  src/pages/comercial/
    ComercialPage.tsx              # hub: histórico + atalhos
    proposta/                      # assistente de 7 etapas
    custos/                        # levantamento (5 seções)
    components/  utils/
  src/styles/comercial.css         # CSS do rascunho, escopado
  test/comercial.test.mjs
```

### 3.2 Runtime em produção

Nada muda na topologia. O módulo vive no container `backend` e no bundle servido
pelo `nginx`, exatamente como Qualidade ou Acompanhamento.

```text
comercial.filtrovali.com.br ──301──▶ app.filtrovali.com.br/comercial
                                              │
                                    filtrovali-nginx (SPA + proxy /api)
                                              │
                                    filtrovali-backend :4000
                                              │
                                    filtrovali-postgres
                                      ├── schema public     (operação)
                                      └── schema comercial  (propostas)
```

---

## 4. Modelo de dados

### 4.1 Dois schemas: `public` (operação) e `comercial` (propostas)

**Decidido.** Verificado: `multiSchema` é **GA desde o Prisma ORM 6.13** e o
repositório usa **Prisma 7.9** — não precisa de `previewFeatures`.

#### O que isso significa na prática

Hoje `backend/prisma/schema.prisma:5-7` declara apenas
`datasource db { provider = "postgresql" }`. Sem lista de schemas, o Prisma
assume que **tudo** vive em um só (`public`, conforme
`DATABASE_URL=...?schema=public`). Para o Prisma enxergar dois schemas, é
preciso declarar os dois e dizer a que schema cada tabela pertence:

```prisma
datasource db {
  provider = "postgresql"
  schemas  = ["public", "comercial"]
}

model Report {
  // ...campos existentes, sem alteração...
  @@schema("public")      // <-- única linha nova
}

model Proposal {
  // ...modelo novo...
  @@schema("comercial")
}
```

#### O ponto que causa dúvida (e por que é seguro)

Ativar `multiSchema` obriga a anotar `@@schema(...)` em **todos** os models e
enums já existentes — cerca de 100 models e 40 enums. Parece grande, mas:

- **Nenhum dado se move.** As tabelas já estão em `public`; a anotação apenas
  informa ao Prisma onde elas *já* estão.
- **É mecânico** — um script insere a linha em todo model/enum sem `@@schema`.
- **A migration resultante é quase vazia:** só `CREATE SCHEMA comercial` mais as
  tabelas novas. Nenhum `ALTER` nas tabelas da operação.
- `_prisma_migrations` continua em `public` (vem do `?schema=public` da URL).

#### Passos (Etapa E3)

1. `schemas = ["public", "comercial"]` no datasource.
2. Script para inserir `@@schema("public")` em todo model/enum existente.
3. Models novos com `@@schema("comercial")`.
4. `prisma migrate dev` e **revisar o SQL gerado** — deve conter
   `CREATE SCHEMA` + `CREATE TABLE comercial.*` e nada mais.
5. `GRANT USAGE ON SCHEMA comercial TO <role da aplicação>` no deploy.

#### O que a separação entrega — e o que não entrega

**Entrega:** organização clara (o `\dt comercial.*` mostra só o comercial),
listagens e dumps parciais por schema, e a porta aberta para dar um role
Postgres restrito a um serviço separado no futuro.

**Não entrega isolamento de segurança hoje**, porque é o mesmo processo Express
com o mesmo usuário de banco acessando os dois schemas. Isso é intencional — é
exatamente o que torna a Etapa E11 (gravar `CommercialProposal` na mesma
transação) trivial.

**Contingência:** se a migration revelar algo inesperado, o fallback é manter
tudo em `public` com `@@map("comercial_*")`. Não é o plano, é o plano B.

### 4.2 Models novos

Nomes livres no client Prisma atual. `CommercialProposal` **já existe** e é o
staging do Access — os novos precisam de nomes distintos.

| Model novo | Origem (SQLite) | Observação |
|---|---|---|
| `Proposal` | `proposal_history` | Proposta gerada pelo app (≠ `CommercialProposal`, que é staging do Access). `createdByUserId` obrigatório — é o que sustenta a regra de autoria (§12.5, decisão 3) |
| `CostEstimate` | `cost_estimates` | Levantamento atual |
| `CostEstimateVersion` | `cost_estimate_versions` | Versão imutável, com hash do payload |
| `SalesAttribution` | `sales_attributions` | Representantes e indicações internas |
| `Seller` | — (era constante `SELLERS`) | **Novo** (§12.5, decisão 4): vendedor com nome, ativo/inativo e ordem. Substitui a lista fixa de `page.tsx:93` |
| `ProposalNumberSeq` ou sequence | — (era Nectar) | **Novo** (§12.5, decisão 5): origem do número da proposta, semeada acima do maior existente |

Conversões obrigatórias:

| SQLite | Postgres/Prisma |
|---|---|
| `real` (dinheiro) | `Decimal @db.Decimal(14,2)` — **nunca `Float`**; segue `ProjectBudget` |
| `real` (margem) | `Decimal @db.Decimal(6,2)` |
| `integer` `*_cents` / `*_bps` | `Int` (já são inteiros — manter) |
| `integer` boolean | `Boolean` |
| `text` ISO de data | `DateTime` |
| `text` JSON (`payload`, `snapshot`) | `Json` |
| `id integer autoincrement` | `String @id @default(cuid())` (padrão do repo) |

Exigências de `docs/PADRAO_MODULO.md` a aplicar em todos:
`createdAt`, `updatedAt`, `createdByUserId`, status explícito, índices de
listagem, soft delete onde exclusão física for arriscada, e auditoria para
finalização/envio externo (usar um `ProposalAuditLog` no padrão de
`ReportAuditLog`).

O contrato do campo `Json` do levantamento fica validado por
`shared/schemas/comercial.js` **e** por `normalizeCostEstimatePayload` do
cost-model, com teste — o padrão exige contrato validado para campo `Json`.

### 4.3 Ligações com a operação (já preparadas, uso na Etapa 10)

- `Proposal.proposalCode` ↔ `Project.commercialProposalCode`
- `Proposal` → `CommercialProposal` (`codProp`/`nRev`) → `ProjectBudget`

---

## 5. Mapa de portabilidade

### 5.1 Rotas HTTP

| Rascunho (Next) | Destino (Express, `/api/comercial`) | Nota |
|---|---|---|
| `POST /api/auth/login` | — | **descartado**: `/api/auth` existente |
| `GET /api/auth/session` | — | idem |
| `POST /api/auth/logout` | — | idem |
| `GET+POST /api/cost-estimates` | `GET+POST /levantamentos` | recalcula no servidor (autoridade) |
| `GET /api/proposals` | `GET /propostas` | histórico |
| `GET /api/proposals/files` | `GET /propostas/:id/arquivos/:tipo` | comercial \| tecnica |
| `POST /api/finalize` | `POST /propostas/finalizar` | JSON pequeno; ver §5.3 |
| `GET+POST /api/scope-assets` | `GET+POST /escopo/fotos` | |
| — | `POST /propostas/documentos` | **novo**: gera os dois PDFs no servidor (§5.3) |
| — | `POST /propostas/anexos` | **novo**: anexos extras do SharePoint, base64, um por vez |
| `GET /api/nectar/pipelines` | `GET /nectar/funis` | |
| `GET /api/nectar/contacts` | `GET /nectar/contatos` | |
| `GET /api/nectar/opportunities` | `GET /nectar/oportunidades` | |
| `GET /api/nectar/next-number` | `GET /propostas/proximo-numero` | **Muda de origem** (§12.5, decisão 5): sequence local em vez de varredura no Nectar. Sai de `/nectar/*` |
| — | `GET/POST/PATCH/DELETE /vendedores` | **Novo** (§12.5, decisão 4) |

### 5.2 Telas

| Rascunho | Destino | Ação |
|---|---|---|
| `app/page.tsx` (1.759) | `pages/comercial/proposta/` | 7 etapas → 1 container + 7 componentes de etapa + preview |
| `app/custos/page.tsx` (3.382) | `pages/comercial/custos/` | 5 seções → 1 container + 5 componentes (Premissas, Mão de obra, Insumos, Logística, Resumo) |
| `app/historico/page.tsx` (66) | `pages/comercial/ComercialPage.tsx` | vira o hub do módulo |
| `app/login/page.tsx` | — | descartado |

O padrão do repo reprova página acima de 700–900 linhas. As duas telas grandes
**precisam** ser decompostas — isso não é refatoração opcional, é requisito de CI.

### 5.3 Geração do PDF passa para o backend

**Problema do desenho atual.** O `finalize` recebe os dois PDFs (até 22 MB) em um
multipart. O FiltroAPP não usa multipart: envia base64 em JSON com limite por
rota (`backend/src/app.js:51-69`, teto de 25 MB) e o nginx tem
`client_max_body_size 30M`. 22 MB em base64 ≈ 29,7 MB — não cabe.

**Decisão: gerar os PDFs no backend com `pdf-lib`**, como o FiltroAPP já faz com
os relatórios (`backend/src/lib/report-pdf.js`). O problema de tamanho
desaparece: o cliente manda um JSON pequeno e nada grande sobe pela rede.

> **Por que `pdf-lib` e não `jsPDF`.** A constitution fixa a stack de geração de
> documentos em `pdf-lib` e no pipeline DOCX→PDF do backend; `jsPDF` duplicaria
> esse papel e exigiria emenda. O inventário do uso real de jsPDF mostrou que a
> troca é barata: `rect` (10), `text` (7), `setFillColor` (7), `setTextColor` (5),
> `setDrawColor` (5), `addPage` (2), `line` (1) — todos com equivalente direto em
> `pdf-lib`. O único ponto não trivial é `splitTextToSize` (10 usos), que vira um
> helper de ~30 linhas sobre `font.widthOfTextAtSize()`. As 908 linhas de layout
> (posições, laços, conteúdo) permanecem. Ambos usam a Helvetica padrão do PDF,
> com as mesmas métricas — a quebra de linha deve coincidir.

Isso ficou viável porque a inspeção do `app/proposal-pdf.ts` mostrou que ele é
quase todo isomórfico:

| Constatação | Consequência |
|---|---|
| `html2canvas` **não é usado em lugar nenhum** — dependência morta | Sai do projeto |
| jsPDF é usado programaticamente (`addImage`, `setFont`, `setFontSize`), **não** capturando DOM | Traduz para `pdf-lib` primitiva a primitiva |
| Única fonte: `helvetica`, embutida no jsPDF — sem `addFileToVFS`, sem fonte customizada | `StandardFonts.Helvetica` do `pdf-lib`, mesmas métricas |
| Imagens vêm de arquivos estáticos (`/proposal-assets/*`) e das fotos de escopo já enviadas ao servidor | O servidor já tem tudo em disco |
| Código de browser: **apenas 2 helpers** (`loadImage` e `optimizeScopePhotoForPdf`, ~50 linhas em `proposal-pdf.ts:840-888`) | Trocar por `sharp`, que o backend já usa |

**Fluxo novo:**

1. O usuário monta a proposta e vê o preview em HTML (inalterado, no navegador).
2. `POST /api/comercial/propostas/documentos` com os dados da proposta (JSON
   pequeno) → backend renderiza os dois PDFs, grava em disco e devolve as chaves.
3. Download pelo caminho autorizado de arquivos, no padrão de `/relatorios/*`.
4. `POST /api/comercial/propostas/finalizar` — JSON pequeno; dispara Nectar e
   SharePoint lendo os PDFs já gravados.

**O que muda para o usuário:** o download passa a ter uma ida ao servidor em vez
de ser instantâneo no navegador. Nada além disso — mesmas etapas, mesmos dois
documentos, mesmo conteúdo, gerado pelas mesmas 908 linhas.

**O que se ganha:**

- Some o limite de corpo como restrição de projeto.
- O PDF vira reproduzível no servidor — revisão e reemissão passam a gerar o
  documento a partir do dado gravado, não do estado da aba do navegador.
- `jspdf` e `html2canvas` saem do projeto; nenhuma dependência nova.
- Alinha com o RDO e com a stack fixada pela constitution.

**Anexos extras** (arquivos que o usuário junta ao envio do SharePoint) continuam
subindo do cliente, em base64 e um por vez, no padrão de
`backend/src/routes/resources/uploads.js`.

**Portão de verificação (aceite de E5):** os PDFs gerados com `pdf-lib` devem ser
visualmente idênticos aos do rascunho, comparados página a página, para o mesmo
conjunto de entradas de referência (§6.0). Se a paridade falhar por métrica de
fonte ou quebra de linha, o caminho é ajustar o helper de quebra — **não**
introduzir `jsPDF`, que exigiria emenda à constitution.

### 5.4 Integração pós-resposta

O `finalize` responde primeiro e roda Nectar + SharePoint depois, via `after()`
do Next (`app/api/finalize/route.ts:139`), atualizando `integration_status` para
`ok`/`error`. No Express isso vira `backend/src/lib/comercial/jobs.js` — o
`architecture:check` **proíbe** exportar job de arquivo de rota.

### 5.5 Arquivos em disco

Mesmo padrão dos relatórios (`env.reportsDir`, volume `filtrovali_relatorios`).
Nova env `COMERCIAL_DIR` (default dentro de `reportsDir`), com as chaves do
rascunho preservadas: `propostas/<codigo>/<id>/{comercial,tecnica}.pdf` e
`escopo/AAAA/MM/<uuid>.<ext>`. Validação de assinatura de arquivo e limites
(1,5 MB por foto) portados de `app/api/scope-assets/route.ts`.

### 5.6 CSS

778 linhas com 636 seletores de classe, muitos genéricos (`.field`, `.add`,
`.brand`, `.step-content`) que colidem com as 242 KB de `frontend/src/styles/base.css`.
Só a variável `--bg` colide entre os dois conjuntos.

**Decisão do mantenedor: a identidade visual do rascunho é preservada
integralmente.** O módulo é um porte fiel — UI e UX idênticas, recriadas na stack
do projeto. Portanto o CSS é portado, não reinventado.

Isso conflita com o Princípio VI (kit e tokens obrigatórios) e é grande demais
para caber em Complexity Tracking: não é uma tela fora do padrão, é um módulo
inteiro com identidade própria. **Exige emenda à constitution** (§10.1) —
aprovada antes de E6, não descoberta em revisão.

**Regra depois da emenda:**

1. **Todo o CSS do rascunho é portado** para
   `frontend/src/styles/comercial.css`, integralmente sob a raiz
   `.comercial-app`, sem vazar um seletor sequer para o resto do app.
2. **Paleta e medidas em um bloco único de custom properties prefixadas**, na
   raiz do módulo — exigência da alínea (b) da emenda. Nenhuma redefinição dos
   tokens globais de `variables.css` (`--bg` é a única que colidiria), e nenhum
   hex/px solto espalhado pelos seletores duplicando o que está no bloco.
   **Nomear por função, não por cor** (`--com-superficie`, `--com-borda`,
   `--com-texto-fraco`), para que uma eventual promoção a padrão do app seja
   renomeação e não reescrita — ver §10.1.1.
3. **Componentes visuais são os do rascunho.** O kit `components/ui/` entra
   apenas onde não há equivalente no rascunho e sem conflito de identidade
   (ex.: `Toast` e `ConfirmDialog` como infraestrutura); se destoarem, recebem
   restilização dentro do escopo.
4. **Comportamento obrigatório continua valendo**, porque é acessibilidade e
   consistência funcional, não estética:
   - `aria-invalid` nos campos inválidos, com mensagem visível no padrão que o
     rascunho já tem (`.field-error input{border-color:#c43d3d}` em
     `globals.css`) — visual do rascunho, semântica do app;
   - `select` com estados de foco, disabled e erro definidos;
   - reordenação dos blocos de escopo no padrão compartilhado de drag and drop;
   - navegação interna refletida em URL/query params;
   - tutorial permanente de primeiro acesso.
5. **Único ajuste permitido sobre o original:** corrigir onde o rascunho gera
   scroll horizontal de página no celular. Ele já é responsivo (media queries em
   1100px, 900px e 650px), mas mantém
   `.cost-table th,.cost-table td{white-space:nowrap}`. Onde isso estourar a
   viewport, aplicar `max-width` + tratamento de overflow **preservando o layout
   desktop intacto**. É correção de defeito, não redesenho — e é o mínimo que o
   Princípio II exige mesmo com a emenda.

O fac-símile do documento (preview A4) segue o mesmo regime, sob
`.comercial-app .comercial-documento`. Como o PDF nasce no backend (§5.3), esse
CSS é referência visual e não contamina o arquivo entregue ao cliente.

#### Tipografia (decidido)

O rascunho carrega Geist via `next/font/google` em `layout.tsx:11-16`, **mas
nunca a usa**: `globals.css` aplica `font-family: Arial, Helvetica, sans-serif`
em `body` e nunca referencia `var(--font-geist-sans)`. É a terceira dependência
morta do pacote, junto de `html2canvas` e do Tailwind — **Geist não entra no
porte**, e some com ela o risco de build dependente de rede.

Regra:

- **Chrome do módulo herda a fonte do app** — `'Segoe UI', system-ui, sans-serif`
  de `base.css`. Decisão do mantenedor; entra como desvio nº 5 (§5.7).
- **O fac-símile do documento mantém `Arial, Helvetica, sans-serif`**, que é o
  que `.proposal-page` já usa. Isso **não** é preferência: o PDF é gerado com
  `StandardFonts.Helvetica` (§5.3), então o preview só continua fiel ao arquivo
  entregue ao cliente se preservar essa família.
- Trocar Arial por Segoe UI muda métrica de texto: espere reflow pequeno em
  rótulos e nas tabelas com largura percentual fixa (`.price-table`). No aceite,
  refluxo atribuível **apenas** à fonte é esperado; ajusta-se espaçamento, nunca
  o layout.

### 5.7 Paridade de UI/UX: o que é garantido e como

**O alvo é paridade total: UI e UX idênticas, recriadas na stack do projeto.**
Muda a tecnologia por baixo (React Router, react-query, react-hook-form,
componentes decompostos), não o que o usuário vê e faz.

#### O que não pode mudar

- **Aparência**: cores, tipografia, espaçamentos, bordas, sombras, larguras de
  coluna, comportamento responsivo — o CSS é portado (§5.6).
- Número e ordem das etapas do assistente (7) e das seções do levantamento (5).
- **Todo campo**: rótulo, unidade, tipo, obrigatoriedade, valor padrão, máscara.
- Todas as regras condicionais: parâmetros NAS/PPM/material pedidos só quando o
  serviço exige, espelhamento da desmobilização, travas e desabilitações.
- Todos os textos pt-BR de erro, aviso, vazio e ajuda.
- Índice dos documentos: 13 itens no comercial, 10 no técnico, na mesma ordem.
- Estágios da finalização e o que cada um informa ao usuário.
- Resultados numéricos — cobertos pelos goldens (§E0-5).

#### Desvios deliberados (lista fechada — aprovar antes de E6)

Sobraram cinco, e só o último é escolha de aparência:

1. **PDF gerado no backend** — o download passa a ter uma ida ao servidor
   (§5.3, imposto pela stack fixada na constitution).
2. **Tailwind removido** — não era usado; nenhum efeito visual.
3. **Correção de scroll horizontal no celular** onde o `nowrap` das tabelas de
   custo estoura a viewport, preservando o desktop (§5.6, item 5).
4. **Adições exigidas pela constitution que o rascunho não tem**: tutorial
   permanente de primeiro acesso, `aria-invalid` nos campos inválidos, estado
   navegacional em query params. São acréscimos, não substituições.
5. **Fonte do chrome herda a do app** (`'Segoe UI', system-ui`) em vez do
   `Arial, Helvetica` do rascunho — decisão do mantenedor. O fac-símile do
   documento **mantém Arial/Helvetica** para continuar fiel ao PDF (§5.6).

**Nada fora desta lista pode divergir.** Divergência não listada é bug, não
escolha.

#### Como garantir isso na prática

Com paridade total o critério fica objetivo — mas o risco continua sendo
**perder silenciosamente** um campo, uma condição ou uma mensagem. As três telas
somam cerca de **800 strings visíveis ao usuário** (123 rótulos `label=`,
93 `<option>`, 24 `aria-label`, 23 `placeholder` e ~530 textos soltos em JSX).
Requisito escrito em prosa não segura esse volume: o que sumir não gera erro,
gera ausência — e ausência não aparece em revisão.

Como agora o CSS é portado, entra uma quinta peça: **comparação visual por
screenshot**, viável justamente porque o alvo é pixel-a-pixel.

**Peça 1 — Inventário extraído, não narrado (tarefa E0-6).**
Script que varre `app/page.tsx`, `app/custos/page.tsx` e `app/historico/page.tsx`
e emite `specs/009-modulo-comercial/contracts/ui-inventory.md` com um **ID por
elemento**: tela → etapa/seção → campo, com rótulo, tipo, obrigatoriedade,
default, opções, condição de exibição e mensagens. Constantes que definem
estrutura entram como listas fechadas (`steps`, `SECTIONS`, `COMMERCIAL_INDEX`,
`TECHNICAL_INDEX`, `SELLERS`). O inventário é revisado por humano uma vez e
vira o **oráculo de aceite** — some a dependência de memória.

**Peça 2 — Referência rodando (tarefa E0-7).**
Screenshot e roteiro clicável valem mais que qualquer descrição. O rascunho não
compila por um único arquivo ausente: `vite.config.ts:3` importa
`./.openai/hosting.json`, que o pacote não trouxe. O conteúdo esperado é
mínimo — `{ "d1": "DB", "r2": "SCOPE_ASSETS" }` — porque o config só desestrutura
`{ d1, r2 }`. Criar o stub, `pnpm install`, `pnpm dev`. Se aparecer outro
bloqueio (o `layout.tsx` usa `next/font/google`, que baixa fonte no build),
resolver ou substituir por fonte local. **Vale o dia que custar:** sem referência
executável, a paridade vira opinião — e é ela que também gera os PDFs golden pelo
fluxo real.

**Peça 3 — Amarrar no spec-kit, senão ele inventa.**
`/speckit-specify` escreve a partir do prompt. Se o prompt for "reescrever o app
comercial", ele produz requisitos genéricos, plausíveis e incompletos. Portanto:

- rodar `/speckit-specify` **com o inventário como entrada**, declarando que a
  fonte da verdade é `contracts/ui-inventory.md` + o código de referência;
- cada requisito funcional do `spec.md` cita os IDs do inventário que cobre;
- `/speckit-checklist` gera `checklists/paridade-ux.md`, uma linha por
  tela/fluxo/campo;
- cada tarefa de UI no `tasks.md` referencia os IDs que precisa satisfazer;
- `/speckit-analyze` roda ao final para achar item de inventário sem tarefa —
  é exatamente o cruzamento que pega o que sumiu.

**Peça 4 — Aceite por comparação lado a lado, não por opinião.**
No aceite de E7 e E8: referência rodando de um lado, módulo novo do outro,
percorrendo um roteiro escrito. Cada divergência é classificada como bug ou como
um dos 5 desvios da lista. O checklist de paridade precisa estar 100% marcado —
e ele é item da Definição de Pronto, não uma conferência informal.

**Peça 5 — Comparação visual por screenshot (só faz sentido com paridade total).**
As capturas de E0-7 (3 telas × desktop e mobile, em cada etapa/seção) viram a
baseline. Na revisão de E7 e E8, capturar as mesmas telas no módulo novo e
comparar. Não precisa de ferramenta de regressão visual em CI: comparação
assistida na revisão já pega deslocamento de coluna, espaçamento errado e cor
trocada — que são exatamente os erros que passam despercebidos em porte de CSS.
**Diferença esperada e aceita:** a fonte do chrome (desvio nº 5) e o reflow que
ela causa. Tudo o mais deve coincidir — inclusive o preview do documento, que
mantém Arial/Helvetica e portanto não tem desculpa para divergir.

---

## 6. Etapas de execução

**Ordem obrigatória: E0 antes de E-1.** O levantamento da referência precisa
existir antes do spec-kit, senão a spec nasce de memória e a paridade fica sem
oráculo.

### E0 — Preparação, decisões e arquivos de referência (2 dias)

1. Ler `docs/PADRAO_MODULO.md` inteiro (é o contrato do CI).
2. Congelar `~/comercialAPP` como referência: `git init` + commit, marcar
   somente-leitura. **Nenhum desenvolvimento novo lá.**
3. Definir os nomes finais dos models (§4.2).
4. Branch `feat/modulo-comercial` a partir de `main`, criada **à mão**:
   `git checkout -b feat/modulo-comercial`. Nenhum comando do spec-kit cria
   branch aqui — `create-new-feature.sh` só faz isso através de um hook
   `before_specify` em `.specify/extensions.yml`, arquivo que este repo não tem.
   O nome da branch é livre: os comandos localizam a feature por
   `.specify/feature.json`, não pelo branch (`common.sh`).
5. **Gerar os arquivos de referência (goldens)** — pré-requisito de E5 e E7:
   - `lib/cost-model.ts` é TypeScript puro sem imports, então dá para executá-lo
     direto (`tsx`/`tsc`) num script que recebe N payloads representativos e
     grava o `CostEstimateResultV2` de cada um em JSON — **sem depender de o app
     compilar**;
   - o mesmo script alimenta `proposal-pdf.ts` para gerar os PDFs de referência
     (ou, melhor, gerá-los pelo fluxo real depois do passo 7);
   - guardar em `specs/009-modulo-comercial/contracts/goldens/`;
   - cobrir os casos que exercitam o motor: obra em sede, viagem e offshore; HE
     70 e 100; com e sem produtos químicos; com e sem logística; precificação
     `filtrovali_net_revenue_v1` e `legacy_lec`.

6. **Inventário de UI extraído** para
   `specs/009-modulo-comercial/contracts/ui-inventory.md` (§5.7, Peça 1),
   revisado por humano.
7. **Colocar o rascunho para rodar** (§5.7, Peça 2): criar
   `.openai/hosting.json` com `{ "d1": "DB", "r2": "SCOPE_ASSETS" }`,
   `pnpm install`, `pnpm dev`; capturar screenshots das 3 telas em desktop e
   mobile e gravar o roteiro clicável de referência.
8. Aprovar a **lista fechada de desvios deliberados** (§5.7) com o mantenedor.
9. Tipografia: **decidido** (§5.6) — chrome herda a fonte do app, documento
   mantém Arial/Helvetica, Geist não entra no porte. Nada a decidir aqui; só
   conferir na captura da baseline que a referência de fato renderiza em Arial.

**Aceite:** branch criada; referência congelada e **executável**; goldens
versionados e revisados; inventário revisado; lista de desvios aprovada.

### E-1 — Fluxo spec-kit (obrigatório, depois de E0)

Este documento **não substitui** o fluxo exigido pela constitution. Módulo novo é
feature de porte grande e DEVE passar por spec-kit com artefatos em `specs/`.

> Os comandos são skills em `.claude/skills/`, invocados com **hífen**
> (`/speckit-specify`), não com ponto.
>
> `.specify/feature.json` aponta para a última feature trabalhada. Rodar
> `/speckit-plan` ou qualquer comando seguinte **antes** do `/speckit-specify`
> faz o spec-kit operar sobre a feature anterior. O `/speckit-specify` reescreve
> esse ponteiro.
>
> O `/speckit-specify` cria o diretório com `mkdir -p` e não falha se ele já
> existir — então os artefatos da E0 podem ser gravados em
> `specs/009-modulo-comercial/contracts/` antes de ele rodar, que é justamente a
> ordem exigida aqui.

1. `/speckit-specify` **tendo `contracts/ui-inventory.md` e os goldens como
   entrada declarada** → cria `spec.md`. Este documento entra como
   insumo/`research.md`, não como spec.
2. `/speckit-clarify` — fechar as questões em aberto da §9.
3. `/speckit-plan` — gera `plan.md` com **Constitution Check** e
   **Complexity Tracking** preenchidos a partir da §10.
4. `/speckit-tasks` — gera `tasks.md`; as etapas E1–E11 viram tarefas numeradas,
   cada tarefa de UI citando os IDs do inventário que precisa satisfazer.
5. `/speckit-checklist` — gera `checklists/paridade-ux.md` (§5.7, Peça 3).
6. `/speckit-analyze` — cruza spec × tasks × inventário e aponta item sem
   cobertura. **Nenhum item de inventário pode ficar órfão.**
7. ~~**PR de emenda à constitution** (§10.1)~~ — **concluído**. A emenda 1.9.0
   (exceção de identidade portada no Princípio VI) foi mergeada na PR #138,
   junto com a sincronização de `plan-template.md`, `spec-template.md`,
   `tasks-template.md` e `docs/PADRAO_MODULO.md`. Nada a fazer nesta etapa.
8. `/speckit-implement` — só então.

**Aceite:** `specs/009-modulo-comercial/` completo, Constitution Check aprovado,
`analyze` sem item de inventário descoberto e **emenda 1.9.0 mergeada**.

> A dúvida sobre `multiSchema` está resolvida (§4.1): é GA desde o Prisma 6.13 e
> o repo usa 7.9. A anotação em massa e a migration são tarefas de E3.

### E1 — Scaffold do módulo (0,5 dia)

1. `npm run new:module -- comercial --title "Comercial"`.
2. Ajustar `shared/modules/registry.json`: badge `COM`, roles
   `comercial:manager` (orçamentista sênior/gestor) e `comercial:viewer`,
   `pathPrefixes: ["/comercial"]`, rotas `index`, `proposta`, `custos`.
3. `npm run modules:generate`.
4. Migration dos enums `AppModule.COMERCIAL` e
   `ModuleRoleCode.COMERCIAL_MANAGER|COMERCIAL_VIEWER`.
5. `requireComercialAccess` / `requireComercialManager` em
   `backend/src/middleware/auth.js`, no padrão de `requireQualidadeAccess`.

**Aceite:** `npm run architecture:check` verde; card do módulo aparece no hub
para quem tem a role; rota `/comercial` protegida responde.

### E2 — Regra de negócio compartilhada (2 dias)

1. Criar `shared/comercial/` e **copiar sem alterar**: `cost-model.ts`,
   `technical-services.ts`, `scope-content.ts`, `proposal-visuals.ts`,
   `finalization.ts`, `nectar-pipelines.ts`.
2. `tsconfig` próprio gerando `dist/` com `.js` + `.d.ts`
   (`declaration: true`, `module: ESNext`).
3. Script `build:shared` na raiz; encadear no `backend/Dockerfile` e no
   `deploy/nginx/Dockerfile`; `predev` no backend.
4. Conferir sobreposição de `cnpj.ts` com `backend/src/lib/cnpj.js` — manter uma
   implementação só.
5. Portar os testes que já existem no rascunho: `cost-model`, `cnpj`,
   `finalization`, `nectar-pipelines`, `scope-content`, `technical-services`,
   `proposal-visuals`.

**Aceite:** `import { calculateEstimate } from '.../shared/comercial/dist/cost-model.js'`
funciona no backend (JS) e no frontend (TS, com tipos); testes portados verdes.

> Alternativa se o build extra for indesejado: manter `.js` + `.d.ts` escritos à
> mão, como `shared/schemas/*`. Para 4.529 linhas com ~80 tipos exportados isso é
> pior — o build é o caminho recomendado.

### E3 — Banco e dois schemas (1,5 dia)

1. `schemas = ["public", "comercial"]` no datasource.
2. Script que insere `@@schema("public")` em todo model e enum existente
   (~100 models + ~40 enums) — nenhum dado se move (§4.1).
3. Models `Proposal`, `CostEstimate`, `CostEstimateVersion`, `SalesAttribution`
   + `ProposalAuditLog`, com `@@schema("comercial")` e as conversões da §4.2.
4. `prisma migrate dev` e **revisão do SQL gerado**: deve conter só
   `CREATE SCHEMA comercial` e as tabelas novas — nenhum `ALTER` em tabela da
   operação. Atenção a `Decimal` e índices.
5. `GRANT USAGE ON SCHEMA comercial` no roteiro de deploy (E10).
6. Schemas zod em `shared/schemas/comercial.js` + `.d.ts`.
7. Teste do contrato do payload `Json` do levantamento.

**Aceite:** migration aplica e reverte em banco limpo; SQL revisado sem `ALTER`
inesperado; `prisma generate` ok; suíte existente do backend continua verde
(prova de que a anotação em massa não mexeu na operação); teste de schema verde.

### E4 — Backend: levantamentos e cadastros (3 dias)

1. `lib/comercial/cost-estimates.js`: salvar, versionar (hash do payload),
   atribuições de venda, buscar por id e por `proposalCode`.
2. Rota `GET|POST /api/comercial/levantamentos` sob **`requireComercialManager`**
   (§12.5, decisão 1 — o viewer não alcança custo nem margem), fina: valida,
   autoriza, delega.
3. **Recalcular no servidor** com `calculateEstimate` — os totais gravados são
   sempre os do servidor, nunca os enviados pelo cliente (é a regra atual e é
   uma propriedade de segurança: impede forjar margem).
4. **Cadastro de vendedores** (§12.5, decisão 4): model `Seller`, CRUD sob
   `requireComercialManager`, semeado com os 6 nomes de `page.tsx:93`.
5. **Numeração local** (§12.5, decisão 5): sequence no schema `comercial` e
   `GET /propostas/proximo-numero`. Migration semeia acima do maior número
   existente no Nectar **e** em `CommercialProposal` — o valor de partida é
   levantado uma vez, na E4, e registrado na migration.
6. Teste de permissão (viewer bloqueado no levantamento) + teste do fluxo
   (salvar → versionar → reler) + teste da numeração (não regride, não colide).

**Aceite:** salvar e reler um levantamento reproduz os mesmos totais dos goldens;
`comercial:viewer` recebe 403 em todas as rotas de levantamento.

### E5 — Backend: propostas, PDFs e integrações (5 dias)

1. `lib/comercial/storage.js` — gravação/leitura em disco (§5.5).
2. `lib/comercial/proposals.js` — histórico, revisões, vínculo com levantamento.
   **Regra de autoria** (§12.5, decisão 3): escrita só pelo `createdByUserId` ou
   por `comercial:manager`. É regra nova, inexistente no rascunho — vive em
   `lib/comercial/access.js` e tem teste próprio.
3. **`lib/comercial/proposal-pdf.js`** — porte de `app/proposal-pdf.ts` para
   `pdf-lib` (§5.3): primitivas traduzidas 1:1, helper próprio de quebra de linha
   sobre `widthOfTextAtSize`, e `lib/comercial/pdf-images.js` com `sharp` no
   lugar dos dois helpers de canvas. **Nenhuma dependência nova.**
4. Rota `POST /propostas/documentos` — gera os dois PDFs e devolve as chaves;
   download pelo caminho autorizado, no padrão de `serveAuthorizedStoredFile`.
5. `lib/comercial/nectar.js` — funis, contatos, oportunidades, próximo número.
6. `lib/comercial/sharepoint.js` — token, site, drive, árvore de pastas, upload.
7. `lib/comercial/cost-csv.js` — CSV do levantamento (portar `costEstimateV2Rows`).
8. `lib/comercial/finalize.js` + `jobs.js` — persistir, responder, integrar
   depois, atualizar `integrationStatus`. Rota sob **`requireComercialManager`**
   (§12.5, decisão 2).
9. Rota `POST /propostas/anexos` para anexos extras (base64, um por vez).
10. Envs novas em `backend/src/config/env.js` (zod) + `.env.example` +
   `backend/test/env.test.js`: `NECTAR_API_TOKEN`,
   `NECTAR_PIPELINE_LICITACOES_ESTUDO_VIABILIDADE_STAND_BY_ID`,
   `NECTAR_PIPELINE_GESTAO_COMERCIAL_ID`, `MICROSOFT_TENANT_ID`,
   `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `SHAREPOINT_HOSTNAME`,
   `SHAREPOINT_SITE_PATH`, `SHAREPOINT_BASE_FOLDER`, `COMERCIAL_DIR`.
   **Sem credencial configurada, o módulo degrada com aviso — não derruba o boot**
   (comportamento atual do rascunho).
11. Limite de corpo da rota de anexos em `backend/src/app.js`.

**Aceite:** os dois PDFs gerados no Node são visualmente idênticos aos do
rascunho, página a página, para o mesmo conjunto de entradas (portão da §5.3);
finalização completa em ambiente de teste com Nectar e SharePoint mockados;
`integrationStatus` correto nos três cenários (ok, erro parcial, erro total);
auditoria gravada.

### E6 — Frontend: base do módulo e porte do CSS (2 dias)

> Pré-requisito: **emenda à constitution aprovada** (§10.1).

1. `frontend/src/styles/comercial.css` — porte integral das 778 linhas
   (`globals.css` + `logo.css`), tudo sob `.comercial-app`, variáveis
   renomeadas para `--com-*` (§5.6). Sem Tailwind e sem Geist; a regra de
   `font-family` do `body` não é portada (chrome herda a do app), mas a de
   `.proposal-page` é preservada.
2. Verificação de vazamento: nenhum seletor do módulo pode afetar telas de
   outros módulos, e `base.css` não pode alterar o módulo.
3. `frontend/src/api/comercial.ts` + `hooks/useComercial.ts` com
   `@tanstack/react-query` (estado de servidor) e `zustand` se houver estado
   cliente compartilhado.
4. `ComercialPage.tsx` — hub com histórico, busca e download dos PDFs,
   reproduzindo `app/historico/page.tsx`.
5. Rotas em `moduleRoutes.tsx` com `RoleRoute`.
6. Estado de aba/etapa em query param (navegação sobrevive a refresh).

**Aceite:** `/comercial` idêntico ao histórico da referência na comparação por
screenshot (desktop e mobile); nenhum vazamento de CSS nos dois sentidos,
verificado abrindo um módulo vizinho.

### E7 — Frontend: levantamento de custos (6 a 7 dias)

Porta de `app/custos/page.tsx` (3.382 linhas) decomposta:

1. `custos/CustosPage.tsx` — container, navegação das 5 seções, autosave.
2. `components/PremissasSection.tsx` — nome do serviço e bases financeiras.
3. `components/MaoDeObraSection.tsx` — fases, cargos LEC, turnos, HE 70/100,
   condição da obra, despesas por base, indiretos, detalhamento individual.
4. `components/InsumosSection.tsx` — materiais, circuitos/volumes, produtos por
   dosagem, filtros, efluente.
5. `components/LogisticaSection.tsx` — destinos, distância, veículos, equipe e
   equipamento, ida/retorno espelhado, complementos.
6. `components/ResumoSection.tsx` — apresentação comercial, comissões e
   indicações, formação do preço, faixas de margem, QQP.
7. `utils/` — formatação (`money`, `percent`, `people`), fábricas de item
   (`newLaborContext`, `newMaterial`, `newVolumeSystem`, `newLogistics`…).
8. **`react-hook-form` + resolver Zod** nas seções de entrada, com `useFieldArray`
   para as coleções (fases, cargos, materiais, circuitos, produtos, filtros,
   destinos). O recálculo ao vivo continua vindo de `calculateEstimate` sobre os
   valores do formulário — ver a justificativa e o limite disso em §10.
9. Marcação idêntica à do rascunho (mesmas classes), para o CSS portado encaixar
   sem retrabalho; `aria-invalid` acrescentado nos campos inválidos.

**Aceite:** os números da tela batem com os goldens (§E0-5) campo a campo;
**comparação lado a lado e por screenshot** (§5.7, Peças 4 e 5) com a parte do
`checklists/paridade-ux.md` referente ao levantamento 100% marcada e toda
divergência classificada como bug ou como um dos 5 desvios aprovados; nenhum
arquivo acima de 900 linhas; sem scroll horizontal de página em mobile.

### E8 — Frontend: assistente da proposta (5 a 6 dias)

Porta de `app/page.tsx` (1.759 linhas) decomposta em 7 etapas — Cliente, Escopo,
Responsabilidades, Prazos, Técnica, Comercial, Revisão:

1. `proposta/PropostaPage.tsx` — container, modo novo/revisão, vínculo com o
   levantamento, numeração.
2. Um componente por etapa com `react-hook-form` + Zod, incluindo
   `TechnicalServicesEditor` e `ScopeContentEditor` (tabelas e fotos com legenda).
   A reordenação dos blocos de escopo DEVE usar o padrão compartilhado de drag
   and drop: handle dedicado, placeholder com legenda de posição, fantasma
   seguindo o cursor, reorganização ao vivo, Pointer Events com
   `touch-action: none`, cancelamento restaurando a ordem e persistência só ao
   soltar.
3. `components/DocumentPreview.tsx` — paginação do documento (técnico e
   comercial), dentro de `.comercial-app .comercial-documento`. Continua sendo
   preview em HTML; o PDF vem do servidor (§5.3).
4. Envio: `POST /propostas/documentos` → download/preview dos PDFs gerados →
   `POST /propostas/finalizar`, mantendo os estágios de progresso de
   `finalization.ts`. **Nenhuma dependência de PDF no frontend** — `jspdf` e
   `html2canvas` ficam fora do bundle.
5. Tutorial permanente de primeiro acesso (Driver.js) — **obrigatório para
   módulo novo** — e campanha de novidade de 10 dias corridos.

**Aceite:** revisão de proposta existente recupera escopo, técnica e preços; o
fluxo completo (montar → gerar → baixar → finalizar) funciona ponta a ponta;
**comparação lado a lado e por screenshot** (§5.7, Peças 4 e 5) com o restante do
`checklists/paridade-ux.md` 100% marcado — incluindo as 7 etapas na ordem, os
índices de 13 e 10 itens, as regras condicionais da etapa Técnica, os estágios da
finalização e o preview do documento. A paridade do PDF já foi verificada em E5.

### E9 — Testes, qualidade e CI (2 dias)

1. Backend: permissão + fluxo principal (levantamento, finalização, arquivos).
2. Frontend: utilitários e hooks com transformação de payload.
3. Portar os 13 testes do rascunho que ainda fizerem sentido.
4. `npm run architecture:check`, `npm test` (backend e frontend), `npm run lint`,
   `npm run build`.
5. Revisão de acessibilidade e mobile das duas telas grandes.

**Aceite:** CI completo verde (`Architecture`, `Backend`, `Frontend`).

### E10 — Produção (1,5 dia)

> **Princípio I (inegociável).** Nada nesta etapa é executado por agente de IA ou
> pelo desenvolvedor direto no servidor. Toda ação vira **bloco de comando
> documentado com a instrução "rode no servidor"**, para execução manual pelo
> operador. O entregável de E10 é um roteiro em `deploy/`, não uma execução.

Preparar no repositório (isto sim é trabalho de código):

1. Bloco novo no `deploy/nginx/default.conf` para
   `comercial.filtrovali.com.br` redirecionando para
   `app.filtrovali.com.br/comercial`, nos moldes de `default.conf:20-46`.
2. `deploy/backup-prod.sh` incluindo a pasta do `COMERCIAL_DIR`.
3. Conferir `client_max_body_size` (30M) contra o limite da rota de anexos.
4. Documento `deploy/COMERCIAL.md` com o roteiro do operador.

Roteiro a entregar ao operador (com "rode no servidor"):

5. Preencher as envs novas em `backend/.env.production` (`chmod 600`).
6. `GRANT USAGE ON SCHEMA comercial` ao usuário da aplicação (a migration cria o
   schema; o `pg_dump` do banco inteiro já cobre os dois schemas no backup).
7. Emissão/renovação do certificado incluindo o novo nome (SAN).
8. Deploy em staging (`docker-compose.staging.yml`), roteiro funcional completo,
   depois produção.
9. Conceder `comercial:manager` a Aliander e Erike; `comercial:viewer` a quem
   precisar consultar.

**Aceite:** roteiro dos 7 itens executado em produção — login, criação e revisão
de custos, geração técnica/comercial/conjunta, download pelo histórico, fotos e
tabelas no escopo, busca e criação no Nectar, envio ao SharePoint.

### E11 — Substituir a sincronização do Access (posterior, 3 a 5 dias)

Com tudo no mesmo backend, o caminho encurta muito em relação ao plano anterior:

1. Ao finalizar, gravar `CommercialProposal` na mesma transação — sem HTTP,
   sem token, sem fila.
2. Reaproveitar `refreshSelectedProjectBudgetsFromProposals`
   (`backend/src/lib/acompanhamento/access-import.js:454`) para derivar
   `ProjectBudget`.
3. Mapear os agregados (todos já existem em `CostEstimateResultV2`):
   `salePrice`, `totalCost`→`plannedCost`, `profitValue`→`expectedProfit`,
   `margin`, `taxValue`→`taxes`, `totalPersonDays`→`plannedDays`,
   `peakHeadcount`→`numOperators`, `mobilizationCost`→`components.mobEquipe/mobEquipamento`,
   `effluentCost`→`components.efluente`, `filterCost`→`components.elemento`.
4. **Resolver três lacunas antes de desligar o import:**
   - `codBd`: sequence própria iniciada acima do `MAX(cod_bd)` legado.
   - Numeração: **resolvida** (§12.5, decisão 5) — a sequence local é semeada
     acima do maior número do Nectar e de `CommercialProposal` já na E4, então a
     coexistência não gera colisão com o legado.
   - Campos que o comercial não gera: `n_dias_trabalhados`, `n_p_dia`,
     `n_p_noite`, `prev_atende` — capturar na tela ou manter edição no
     Acompanhamento.
5. Coexistência: manter o import do Access por 2 ciclos de proposta, com
   relatório de divergência por `codProp`; divergência zerada → desligar.

---

## 7. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Divergência numérica do motor de custos após o port | **Alto** — proposta com preço errado | Copiar o arquivo sem editar; suíte de payloads de referência comparando rascunho × novo, campo a campo, antes de E7 |
| `Decimal` × `Float` no dinheiro | Alto | Regra explícita na §4.2; revisar o SQL da migration à mão |
| PDF sair diferente ao trocar jsPDF por `pdf-lib` | Alto — documento vai ao cliente | Mesma Helvetica padrão nos dois; o risco se concentra no helper de quebra de linha. PDFs de referência gerados em E0 e comparados página a página no aceite de E5 |
| Anotação em massa de `@@schema` mexer sem querer na operação | Médio | SQL da migration revisado à mão (não pode haver `ALTER` em tabela de `public`) + suíte do backend verde antes de seguir |
| Telas grandes reprovando no `architecture:check` | Médio | Decomposição é requisito das etapas E7/E8, não polimento posterior |
| **Perder campo, condição ou mensagem na reescrita da UI** | **Alto** — ~800 strings visíveis; ausência não gera erro, só some | Inventário extraído do código como oráculo, referência executável, `/speckit-analyze` cruzando inventário × tarefas, checklist de paridade na Definição de Pronto (§5.7) |
| Referência não subir localmente | Médio — tira a base de comparação | Bloqueio conhecido é um arquivo (§5.7, Peça 2); se persistir, cair para inventário + screenshots do que existir e registrar a perda de cobertura |
| **Vazamento de CSS entre o módulo e o resto do app** | Alto — quebraria telas da operação | Escopo total sob `.comercial-app` e variáveis `--com-*`; verificação nos dois sentidos é critério de aceite de E6 |
| **Emenda à constitution não ser aprovada** | Alto — invalida §5.6 e parte de E6/E7/E8 | Decidir em E-1, antes de qualquer código de UI. Se reprovada, volta o plano de reconstruir com o kit: +2 dias e a paridade visual deixa de ser critério |
| Reflow causado pela troca de fonte do chrome | Baixo | Desvio nº 5 aprovado (§5.7); no aceite ajusta-se espaçamento, nunca layout. O preview do documento não muda de fonte, então não sofre |
| **Número de proposta colidir com o Nectar** | Médio — dois documentos com o mesmo número | A numeração passa a ser local (§12.5, decisão 5), então o Nectar deixa de ser consultado. Se alguém criar oportunidade direto lá, o número pode repetir. Mitigação: semear a sequence com folga, checar duplicidade na finalização e combinar com o time que o número nasce sempre no app |
| Base64 dos anexos estourar o limite de corpo | Médio | Anexos enviados um por vez (§5.3); conferir limites de rota e nginx em E10 |
| Segredos de Nectar/Microsoft no repo | Alto | Só em `.env.production`, `chmod 600`, fora do git; rotacionar os tokens de origem |
| Regressão na operação por compartilhar processo | Médio | Módulo aditivo; CI completo; deploy primeiro em staging |

---

## 8. Cronograma

| Etapa | Escopo | Esforço |
|---|---|---|
| E0 | Preparação, goldens, inventário de UI e referência rodando | 2 d |
| E-1 | Fluxo spec-kit + PR de emenda à constitution (§10.1) | 2-2,5 d |
| E1 | Scaffold do módulo | 0,5 d |
| E2 | `shared/comercial` (cópia + build + testes) | 2 d |
| E3 | Banco e dois schemas | 1,5 d |
| E4 | Backend — levantamentos, vendedores e numeração | 3 d |
| E5 | Backend — propostas, autoria, PDFs (`pdf-lib`) e integrações | 5,5 d |
| E6 | Frontend — base, histórico e porte do CSS | 2 d |
| E7 | Frontend — levantamento de custos | 5-6 d |
| E8 | Frontend — assistente da proposta + tela de vendedores | 5-6 d |
| E9 | Testes e CI | 2 d |
| E10 | Produção (roteiro para o operador) | 1,5 d |
| | **Até produção** | **32-35,5 dias úteis (~7 semanas)** |
| E11 | Substituir o import do Access | 3-5 d |

Ordem de execução: **E0 → E-1** → E1 → E2 → E3 → (E4 e E6 em paralelo) → E5 →
E7 → E8 → E9 → E10. E0 antes do spec-kit; E2 é pré-requisito de tudo; E7 e E8
são o caminho crítico.

> **Como a estimativa evoluiu.** Da primeira versão (~5 semanas) para ~7: o que
> pesa é conformidade, não escopo — spec-kit, goldens, inventário de UI,
> `react-hook-form` + Zod e a decomposição das telas grandes. A decisão de manter
> a identidade visual devolveu ~2 dias (portar CSS é mais barato que reconstruir
> com o kit) e acrescentou ~0,5 dia de governança (a emenda). As respostas da
> §12.5 somaram ~2 dias: cadastro de vendedores e regra de autoria são escopo
> novo, que não existe no rascunho.

---

## 9. Questões de produto — **todas respondidas** (ver §12.5)

Ficam registradas aqui como enunciado; as respostas e o impacto no escopo estão
na §12.5. Levar as duas coisas para o `spec.md` no `/speckit-specify`.

1. **Quem enxerga custo e margem?** A tela de levantamento expõe custo interno,
   comissão de representante e margem. `comercial:viewer` vê isso ou só vê a
   proposta e o histórico? Hoje o rascunho não faz essa distinção.
2. **Quem pode finalizar** (criar oportunidade no Nectar e enviar ao SharePoint)?
   Sugestão: só `comercial:manager`.
3. **Quem pode revisar proposta de outro orçamentista?**
4. **Numeração:** o Nectar continua sendo a fonte da verdade do número da
   proposta depois que o Access sair de cena?
5. **Retenção e LGPD:** propostas guardam nome, e-mail e CNPJ de contatos de
   cliente. Entram na política de `data-retention.js` e no ROPA — com que prazo?
6. **Vendedores** hoje são uma lista fixa no código (`SELLERS` em `page.tsx:93`).
   Viram cadastro, ou continuam constante?

> **Resolvida por convenção:** o card do módulo no hub. `hubModulesForUser`
> (`frontend/src/auth/moduleNavigation.ts:66`) já filtra por role — quem não tem
> acesso simplesmente não vê o card. Nada a decidir.

---

## 10. Conformidade com a constitution

Auditado contra `.specify/memory/constitution.md` v1.8.0.

### Atendido pelo plano

| Princípio | Como |
|---|---|
| I — Operação de servidor | E10 reescrita como roteiro "rode no servidor" (nenhuma execução por agente) |
| II — pt-BR e mobile | UI já é pt-BR; scroll horizontal corrigido onde o rascunho estoura a viewport (§5.6, item 5) |
| III — Zod nas duas pontas | `shared/schemas/comercial.js` no backend; `react-hook-form` + resolver Zod no frontend |
| IV — Banco só via Prisma | Migrations versionadas; SQL da migration de dois schemas revisado à mão |
| V — Testes de backend | E4, E5 e E9 com teste de permissão e de fluxo principal |
| VI — Tutorial, URL params, `aria-invalid`, drag and drop | E6, E7 e E8 (comportamento preservado mesmo com visual próprio) |
| Stack | `pdf-lib` em vez de `jsPDF` (§5.3); react-query, zustand, react-hook-form; `sharp` no processamento de imagem |
| Workflow | E-1 obriga o fluxo spec-kit com artefatos em `specs/` |

### Correções que a auditoria exigiu no plano

| O que o plano dizia antes | Princípio ferido | Correção |
|---|---|---|
| Adicionar `jsPDF` ao backend | Stack (duplicaria `pdf-lib`) | Porte para `pdf-lib`; sem dependência nova (§5.3) |
| Manter `useState` nos formulários | III (react-hook-form + Zod) | RHF + Zod nas seções de entrada (E7, E8) |
| Herdar `white-space: nowrap` sem tratamento | II (mobile-first) | `max-width` + overflow onde estoura a viewport, preservando o desktop (§5.6, item 5) |
| E10 descrevendo deploy como tarefa a executar | I (inegociável) | Vira roteiro documentado para o operador |
| Sem menção a react-query | Stack | Estado de servidor via `@tanstack/react-query` |
| Sem fluxo spec-kit | Workflow | Etapa E-1 |

### 10.1 Emenda ao Princípio VI — **aplicada em 2026-07-28**

A identidade visual própria (§5.6) **não cabia em Complexity Tracking** — não é
uma tela fora do padrão, é um módulo inteiro. Foi feita emenda à constitution,
**1.8.0 → 1.9.0** (MINOR: exceção nova e delimitada, sem redefinir o princípio),
aprovada pelo mantenedor.

Arquivos alterados: `.specify/memory/constitution.md` (cláusula, Sync Impact
Report e versão), `.specify/templates/plan-template.md`,
`.specify/templates/spec-template.md`, `.specify/templates/tasks-template.md` e
`docs/PADRAO_MODULO.md`.

> **Consequência para a E6:** a alínea (b) exige paleta e medidas em **um bloco
> único de custom properties prefixadas**. Não basta escopar o CSS — hex solto
> espalhado pelos seletores reprova na auditoria de identidade portada que entrou
> no `tasks-template.md`. Ver §5.6.

Texto acrescentado ao Princípio VI:

> **Exceção de identidade portada.** Um módulo que reproduz fielmente um
> aplicativo já existente e aprovado pela diretoria PODE preservar a identidade
> visual de origem, desde que:
> (a) todo o CSS fique escopado sob uma raiz do módulo, sem vazar seletor para o
> restante do app e sem ser afetado por `base.css`;
> (b) a paleta e as medidas próprias sejam declaradas como custom properties
> prefixadas na raiz do módulo, em um bloco único, sem redefinir tokens globais
> de `variables.css`. Valor hex/px solto espalhado pelos seletores não atende
> esta alínea;
> (c) os comportamentos obrigatórios sejam preservados — `aria-invalid` com
> mensagem visível em campo inválido, `select` com estados de foco/disabled/erro,
> reordenação no padrão compartilhado de drag and drop, navegação em URL/query
> params, tutorial permanente de primeiro acesso e ausência de scroll horizontal
> de página em mobile;
> (d) a exceção seja registrada no `plan.md` da feature e reavaliada quando o
> módulo deixar de ser um porte e passar a evoluir por conta própria.
>
> Divergência visual entre módulos é estado transitório, nunca permanente. Só
> existem dois desfechos aceitáveis: o módulo converge para o kit, ou a
> identidade portada é promovida a padrão do app por nova emenda que atualize
> `variables.css`, `frontend/src/components/ui/` e este princípio. Enquanto a
> promoção não acontecer, esta exceção NÃO autoriza outro módulo a inventar
> identidade própria — ela vale apenas para porte fiel de aplicativo aprovado.
>
> Racional: forçar o kit sobre um porte fiel produziria retrabalho sem ganho
> para o usuário, que já conhece a tela de origem, e destruiria a paridade que
> torna a migração verificável. A exceção é de aparência; nenhuma garantia de
> acessibilidade, responsividade ou consistência funcional é dispensada. A
> exigência de paleta centralizada na alínea (b) existe para que a promoção a
> padrão do app, se ocorrer, seja uma troca de tokens e não uma reescrita.

### 10.1.1 Se o visual do Comercial virar o padrão do app

O mantenedor sinalizou que a identidade do módulo pode ser adotada no FiltroAPP
inteiro no futuro. A emenda foi escrita para deixar esse caminho barato:

- a paleta em bloco único (alínea b) faz a promoção ser **renomear `--com-*` para
  os tokens globais**, não reescrever CSS;
- a cláusula de desfecho impede o estado intermediário virar bagunça: enquanto a
  promoção não acontecer, nenhum outro módulo pode inventar visual próprio;
- a promoção exige **nova emenda**, que atualizaria `variables.css`,
  `frontend/src/components/ui/` e o Princípio VI de uma vez.

Consequência prática para a E6: vale nomear as custom properties por **função**
(`--com-superficie`, `--com-borda`, `--com-texto-fraco`) e não por cor
(`--com-azul`, `--com-cinza`). Nome funcional sobrevive à promoção; nome de cor
vira mentira no primeiro ajuste de paleta.

### 10.2 Complexity Tracking (levar para o `plan.md` da feature)

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
|---|---|---|
| Recálculo ao vivo do levantamento fora do ciclo padrão de formulário | `calculateEstimate` roda a cada tecla sobre ~40 coleções aninhadas; é calculadora, não CRUD | Validar só no submit esconderia margem negativa e erro de dimensionamento até o final do preenchimento |
| `shared/comercial` com passo de build (`tsc`) | 4.529 linhas com ~80 tipos exportados precisam rodar no backend (JS) e no frontend (TS) | `.js` + `.d.ts` à mão, como `shared/schemas/*`, seria fonte dupla de verdade nesse volume |

> A identidade visual saiu desta tabela e virou emenda (§10.1) — exceção desse
> tamanho registrada só no plano da feature não sobreviveria a uma revisão.

---

## 11. Definição de pronto

Além do aceite de cada etapa, vale a "Definição de pronto" de
`docs/PADRAO_MODULO.md` mais o gate da constitution:

- [ ] Artefatos spec-kit em `specs/009-modulo-comercial/`, com Constitution
      Check aprovado e Complexity Tracking preenchido
- [ ] Emenda 1.9.0 à constitution mergeada (§10.1)
- [ ] `checklists/paridade-ux.md` 100% marcado, verificado lado a lado com a
      referência rodando
- [ ] Comparação por screenshot das 3 telas em desktop e mobile sem diferença
      não explicada
- [ ] `/speckit-analyze` sem item do inventário de UI descoberto
- [ ] Toda divergência em relação à referência é um dos 5 desvios aprovados
      (§5.7) — nenhuma divergência não listada
- [ ] CSS do módulo totalmente escopado: nenhum vazamento nos dois sentidos
- [ ] Nenhum comando de servidor executado por agente ou desenvolvedor
- [ ] Formulários com `react-hook-form` + Zod; APIs validadas com Zod
- [ ] Identidade visual idêntica à referência, sob a exceção da emenda 1.9.0
- [ ] Sem scroll horizontal de página em mobile
- [ ] Estrutura de pastas conforme o padrão
- [ ] Permissão modular (`comercial:manager` / `comercial:viewer`)
- [ ] Nenhum arquivo crítico acima do budget
- [ ] Nenhum arquivo novo solto em `backend/src/lib/`
- [ ] Nenhum job exportado de rota
- [ ] Envs validadas em `config/env.js` + `.env.example` + teste
- [ ] Registrado em `shared/modules/registry.json` com registry gerado
- [ ] Tutorial permanente de primeiro acesso
- [ ] Testes automatizados no mesmo PR
- [ ] CI completo verde
- [ ] Paridade numérica e visual comprovada contra o rascunho
- [ ] ROPA/LGPD atualizado (dados de clientes, contatos e propostas)

---

## 12. Ponto de partida

### 12.1 Estado do ambiente (verificado em 2026-07-28)

| Item | Estado |
|---|---|
| Node | **22.22.1** ✔ (a referência exige ≥ 22.13) |
| npm / corepack / Docker | 9.2.0 / 0.24.0 / 29.1.3 ✔ |
| `backend/node_modules` | **ausente** — `npm ci` |
| `frontend/node_modules` | **ausente** — `npm ci` |
| `backend/.env` | **ausente** — só existe `.env.example` |
| Postgres local | subir por `docker-compose.local.yml` |
| pnpm | ausente — `corepack enable` (só para rodar a referência) |

Comandos de Docker ficam com o operador humano, pela leitura conservadora do
Princípio I. `npm ci` e `prisma generate` são trabalho normal de desenvolvimento.

### 12.2 Obstáculo conhecido da E0-7

A referência semeia os usuários com hash PBKDF2 (`drizzle/0006_erike_user.sql`,
`pbkdf2-sha256$600000$...`) e **as senhas em texto não vieram no pacote**. Sem
elas não se passa do login e não há como capturar as telas internas.

Solução: `lib/auth-crypto.ts` expõe `hashPassword` em WebCrypto puro, que roda em
Node 22. Gerar um hash para uma senha local e aplicar `UPDATE` na linha do D1
local. O parser lê as iterações do próprio hash, então não importa a divergência
entre os 600.000 do seed e os 100.000 da constante.

### 12.3 O que trava o quê

| Pendência | Trava | Quem resolve |
|---|---|---|
| ~~Emenda 1.9.0 (§10.1)~~ | ~~E6 em diante~~ | ✅ **aplicada em 2026-07-28** |
| Perguntas da §9 | `/speckit-clarify` (E-1) | Mantenedor |
| Nomes dos models (§4.2) | E3 | Padrão adotado se não houver objeção |
| Ambiente (§12.1) | E0 | Desenvolvedor + operador (Docker) |

> Com a emenda aplicada, **nenhuma pendência de decisão bloqueia a
> implementação.** Restam ambiente (§12.1) e a execução de E0 → E-1.

### 12.4 Primeiro trabalho recomendado

**Goldens do `cost-model` (E0-5).** É o item de maior risco do projeto —
divergência numérica significa proposta com preço errado — e o único que não
depende nem de a referência subir nem de decisão do mantenedor: `cost-model.ts`
é TypeScript puro sem imports e roda direto.

Em paralelo, o mantenedor toca as respostas da §9. (A emenda já saiu — ver E-1,
passo 7.)

### 12.5 Decisões registradas

| # | Questão | Resposta | Data |
|---|---|---|---|
| 1 | `comercial:viewer` vê custo e margem? | **Não.** O levantamento inteiro é restrito a `comercial:manager` | 2026-07-28 |
| 2 | Quem finaliza a proposta? | **Só `comercial:manager`** | 2026-07-28 |
| 3 | Pode editar proposta de outro? | **Só o autor ou um manager** | 2026-07-28 |
| 4 | Lista de vendedores | **Vira cadastro no módulo** | 2026-07-28 |
| 5 | Fonte da numeração | **O próprio módulo** (sequence no Postgres) | 2026-07-28 |
| 6 | Retenção das propostas | **Indefinida**, como registro comercial; só entrada no ROPA | 2026-07-28 |
| 7 | Card do módulo no hub | Resolvida por convenção: oculto para quem não tem role | 2026-07-28 |

**Consequências no escopo (+2 dias, já refletidos no cronograma):**

- **Papéis deixam de ser "gestor × visualizador" e viram "orçamentista ×
  consulta".** Considerar renomear os rótulos no registry para
  `comercial:manager` = "Comercial — Orçamentista" e `comercial:viewer` =
  "Comercial — Consulta", já que o viewer não faz orçamento.
- Rotas de levantamento ficam sob `requireComercialManager` (decisão 1); o viewer
  só alcança propostas, histórico e PDFs.
- Autoria passa a ser verificada em escrita (decisão 3) — **não existe no
  rascunho**, é regra nova, com teste próprio.
- Cadastro de vendedores é **escopo além do porte** (decisão 4): model, rotas,
  tela e permissão.
- Numeração por sequence (decisão 5) simplifica o código — cai a varredura do
  Nectar em `next-number` —, mas exige semear a sequence acima do maior número
  já existente **no Nectar e em `CommercialProposal`**, e cria um risco novo
  (§7): se alguém criar oportunidade direto no Nectar, o número pode colidir.
