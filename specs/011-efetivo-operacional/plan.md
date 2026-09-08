# Implementation Plan: Efetivo Operacional — Produtividade e Improdutividade Real

**Branch**: `feat/efetivo-operacional` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/011-efetivo-operacional/spec.md` · Evidências: [research.md](./research.md)

## Summary

Criar a área **Efetivo Operacional** como módulo próprio do APP, entregando de início duas seções:
**Produtividade** — Improdutividade Real por colaborador e Taxa Geral do efetivo operacional — e
**Férias e ausências**, o cadastro que o indicador sinaliza e que todas as seções futuras exigem. O cálculo lê as horas normais já sincronizadas do Ponto Mais
(`PontoPeriodSummary` → `mergePontoPeriods`), sem novo importador, sem lançamento manual e sem
depender do motor de custo. A arquitetura nasce com espaço para as demais seções do protótipo
(Visão geral, Calendário, Colaboradores, Missões, Evolução, Simulações, Administração), mas nenhuma
delas é implementada agora.

## Technical Context

**Language/Version**: Node.js + Express (ESM) no backend; React 19 + Vite + TypeScript no frontend

**Primary Dependencies**: Prisma + PostgreSQL, Zod, @tanstack/react-query, react-hook-form

**Storage**: PostgreSQL via Prisma; leitura de `PontoPeriodSummary`, `Collaborator`, `JobRole`

**Testing**: `backend/test/*.test.js` (`npm test`), `frontend/test/*.test.mjs`,
`npm run architecture:check`

**Target Platform**: Web (desktop e mobile), autenticado

**Project Type**: Módulo novo (backend + frontend + registry compartilhado)

**Performance Goals**: consulta do indicador de um ano inteiro em uma requisição, com p95 abaixo
de 1,5 s para ~60 colaboradores × 12 meses; sem N+1 por colaborador

**Constraints**: nenhum comando de servidor executado pelo agente; migration Prisma obrigatória
para qualquer mudança de schema; UI pt-BR e mobile-first

**Scale/Scope**: 1 módulo, 2 seções, ~9 endpoints, 1 migration

## Constitution Check

*Gate avaliado contra a constitution v1.9.0.*

| Princípio | Situação |
|-----------|----------|
| I — Operação de servidor é sagrada | ✅ Migration e deploy entregues como blocos "rode no servidor"; o agente não executa nada |
| II — UI pt-BR e mobile-first | ✅ Tabela por colaborador vira cards em telas estreitas; abas/filtros do módulo com quebra ou `select` no mobile; sem scroll horizontal de página |
| III — Zod nas duas pontas | ✅ Query params do indicador, CRUD de férias (datas, sobreposição) e marcação de função operacional validados com Zod no backend; formulário com react-hook-form + resolver Zod |
| IV — Banco só via Prisma | ✅ `JobRole.isOperational`, `Collaborator.terminationDate`, `CollaboratorAbsence` e o parâmetro de referência entram por migration versionada; nenhum backfill destrutivo |
| V — Testes no backend | ✅ `backend/test/efetivo-produtividade.test.js` cobre a fórmula (piso 0%, média simples, exclusão de HE, pró-rata de admissão/desligamento, exclusão do mês corrente); `efetivo-permissao.test.js` cobre a permissão do módulo; `efetivo-ausencias.test.js` cobre validação de período e sobreposição |
| VI — Consistência visual | ✅ Kit `components/ui/`, tokens de `variables.css`, tela análoga = `AcompanhamentoPage` + `SedeCostsBoard`; navegação em `?section=`/`?colaborador=`; tutorial permanente de módulo novo + novidade de 10 dias. **A exceção de identidade portada NÃO se aplica** — o protótipo não é um app aprovado em porte, é referência funcional |

**Sem violações a registrar em Complexity Tracking.** A única escolha que merece justificativa é
criar módulo novo em vez de reaproveitar o Acompanhamento (ver abaixo).

## Decisão de arquitetura: módulo próprio, não uma aba do Acompanhamento

**Escolha**: novo módulo `efetivo` no `shared/modules/registry.json`, com papéis
`efetivo:manager` e `efetivo:viewer`.

**Por quê**:

- O `docs/PADRAO_MODULO.md` já define o caminho (scaffold `npm run new:module`, registry como fonte
  de verdade, permissão modular) e o CI valida a sincronia registry ↔ Prisma ↔ frontend.
- A direção futura do protótipo (Calendário, Missões, Simulações, Administração própria) é sobre
  **pessoas e capacidade**, enquanto o Acompanhamento é sobre **missões e dinheiro**. Empilhar
  isso como quinta aba do Acompanhamento agravaria uma tela que já tem quatro seções e um motor de
  custo pesado.
- A permissão é diferente: hoje quem vê o Acompanhamento vê custo de projeto. Produtividade
  individual é dado de pessoas e merece papel próprio (e é dado pessoal sob a ótica de LGPD, ver
  `LGPD_ROPA.md`).

**Custo aceito**: o módulo novo consome `backend/src/lib/acompanhamento/labor-cost.js` como
biblioteca de leitura de ponto. Isso cria uma dependência entre módulos que hoje não existe.

**Mitigação**: o módulo novo **não** importa o motor de custo — importa apenas as funções puras de
leitura do ponto (`mergePontoPeriods`, `filterIgnoredPontoPeriods`). Se essa fronteira incomodar,
o passo seguinte é mover essas duas funções para `backend/src/lib/ponto/` e ambos os módulos
passarem a consumir de lá — refatoração pequena, sem mudança de comportamento.

**Alternativa descartada**: nova seção `?section=produtividade` dentro do Acompanhamento. Entrega
mais rápido, mas prende a área a um módulo cujo escopo é outro e obriga migração depois, quando o
Calendário e as Missões chegarem.

## Estrutura da implementação

### Registry e permissão

```text
shared/modules/registry.json         → módulo "efetivo" (id, badge, título, card do hub, rotas, papéis)
npm run modules:generate             → frontend/src/modules/registry.generated.ts
backend/prisma/schema.prisma         → AppModule.EFETIVO, ModuleRoleCode.EFETIVO_MANAGER/EFETIVO_VIEWER
frontend/src/modules/moduleRoutes.tsx→ rota /efetivo
```

### Backend

```text
backend/src/lib/efetivo/
  access.js          → requireEfetivoManager / requireEfetivoViewer
  productivity.js    → funções puras do indicador (sem Prisma)
  absences.js        → regras de período de ausência (validação, sobreposição, meses afetados)
  service.js         → orquestra Prisma + productivity.js + absences.js. Lê `PontoPeriodSummary`
                       em duas passadas: as linhas COM `collaboratorId` passam por
                       `filterIgnoredPontoPeriods` + `mergePontoPeriods`; as linhas SEM
                       `collaboratorId` — que `mergePontoPeriods` descarta em `labor-cost.js:338` —
                       são retidas à parte para a pendência de vínculo (FR-013)
  settings.js        → parâmetro de referência (161 HH/mês): leitura com fallback e escrita
                       (`upsert` com `updatedByUserId`), no padrão de
                       `lib/acompanhamento/settings.js`
backend/src/routes/resources/efetivo.js
backend/test/efetivo-produtividade.test.js
backend/test/efetivo-permissao.test.js
backend/test/efetivo-ausencias.test.js
```

`productivity.js` (puro, testável sem banco):

```text
buildMonthlyProductiveHours(periods)            → Map<collaboratorId, Map<'YYYY-MM', horasNormais>>
selectAnalyzedMonths(monthly, { year, cutoff, admissionDate, terminationDate, currentMonth })
  → meses ativos do período, pró-rata só em admissão/desligamento, mês corrente fora (D-2);
    férias NÃO reduzem o denominador (D-8), apenas marcam o mês
computeIndividualRate({ totalHours, analyzedMonths, reference })
computeGeneralRate(individualRates)             → média simples das taxas válidas
buildProductivityReport({ collaborators, jobRoles, periods, filters, reference })
```

Regras fixadas em código (FR-005 a FR-007): HE fora do numerador; piso 0% na taxa individual; taxa
geral = média simples. A referência vem de parâmetro, não de literal (FR-009).
`buildMonthlyProductiveHours` normaliza os **dois formatos** de `monthly` que `mergePontoPeriods`
devolve: v1 (mapa plano `{ "YYYY-MM": {...} }`) e v2 (`{ schemaVersion: 2, months: {...} }`).

### Frontend

```text
frontend/src/api/efetivo.ts
frontend/src/pages/efetivo/EfetivoPage.tsx           → shell + navegação por ?section=
frontend/src/pages/efetivo/components/
  ProductivityBoard.tsx                              → KPIs + evolução mensal + tabela/cards
  ProductivityCollaboratorDetail.tsx                 → detalhe por ?colaborador=
  ReferenceSettingModal.tsx                          → edição da referência (só efetivo:manager)
  ProductivityPendingList.tsx                        → pendências (FR-013)
  AbsencesBoard.tsx                                  → seção ?section=ausencias: lista + formulário
  AbsenceFormModal.tsx                               → Modal do kit + react-hook-form + Zod
frontend/src/pages/efetivo/utils/productivityPeriods.ts
frontend/test/efetivo.test.mjs
```

Reaproveitar: `components/ui/` (Modal, Button, SearchBar, Skeleton, Toast), tokens de
`styles/variables.css`, o padrão de filtros de período de `frontend/src/utils/sedePeriods.ts`
(feature 004) e a estrutura visual de `components/projects/SedeCostsBoard.tsx`. Tutorial permanente
de módulo novo no padrão de `AcompanhamentoTutorial.tsx` e novidade de 10 dias no padrão de
`AcompanhamentoHubNovelty.tsx` / `QualidadeHubNovelty.tsx`.

### Banco (migration única)

```prisma
enum CollaboratorAbsenceType {
  FERIAS        // única exposta na primeira entrega
  FOLGA         // reservada — não exposta na UI ainda
  AFASTAMENTO   // reservada
  ASO           // reservada
  TREINAMENTO   // reservada
}

model JobRole {
  // ...
  isOperational Boolean @default(true)   // D-4: todos nascem operacionais
}

model Collaborator {
  // ...
  terminationDate DateTime?              // D-3: delimita os meses analisados
  absences        CollaboratorAbsence[]
}

model CollaboratorAbsence {
  id              String                  @id @default(cuid())
  collaboratorId  String
  type            CollaboratorAbsenceType @default(FERIAS)
  startDate       DateTime                @db.Date
  endDate         DateTime                @db.Date
  note            String?
  createdByUserId String?
  deletedAt       DateTime?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt
  collaborator    Collaborator            @relation(fields: [collaboratorId], references: [id], onDelete: Cascade)

  @@index([collaboratorId, startDate])
  @@index([type, startDate])
  @@index([deletedAt])
}

model EfetivoSetting {
  key             String   @id
  numberValue     Float?
  updatedByUserId String?
  updatedAt       DateTime @default(now()) @updatedAt
}
```

O enum já nasce com os demais tipos para que folga, afastamento, ASO/ASU e NR entrem depois sem
migration estrutural — mas **apenas `FERIAS` é exposta na UI desta entrega**. Sobreposição de
períodos do mesmo colaborador é recusada na validação (não há constraint de exclusão no Postgres via
Prisma). Soft delete preserva a trilha.

Parâmetro de referência: **`EfetivoSetting`** (chave/valor no padrão de `AcompanhamentoSetting`),
criado **na mesma migration** — a referência mensal vive na chave `efetivo.referenciaMensalHH`, com
fallback 161 na leitura quando a chave ainda não existe. Nenhum backfill de dado existente é
necessário; as demais mudanças apenas adicionam coluna com default.

### Contrato de API (rascunho)

```text
GET  /api/efetivo/produtividade?ano=2026&ateMes=8
     → { referenciaMensalHH, periodo, ultimaSincronizacao,
         resumo: { hhAcumuladas, mediaMensalEquipe, taxaGeral, pendencias },
         evolucaoMensal: [{ mes, mediaHH, referencia }],
         colaboradores: [{ id, nome, cargo, hhAcumuladas, mediaMensal, heExcluidas,
                           mesesAnalisados, improdutividade }],
         pendentes: [{ tipo, descricao, referencia }] }

GET  /api/efetivo/produtividade/:collaboratorId?ano=2026
     → detalhe mês a mês

GET  /api/efetivo/parametros
     → { referenciaMensalHH, atualizadoEm, atualizadoPor }
PUT  /api/efetivo/parametros  { referenciaMensalHH }   (requireEfetivoManager, FR-009)

PATCH /api/job-roles/:id  { isOperational }    (rota existente, campo novo; alterar `isOperational`
                                               exige `efetivo:manager` — ver FR-010)

GET    /api/efetivo/ausencias?colaborador=&ano=
POST   /api/efetivo/ausencias        { collaboratorId, type, startDate, endDate, note }
PATCH  /api/efetivo/ausencias/:id    { startDate, endDate, note }
DELETE /api/efetivo/ausencias/:id    (soft delete)

PUT    /api/collaborators/:id  { terminationDate }   (rota existente, campo novo)
```

Validação Zod nos query params (`ano` inteiro plausível, `ateMes` 1–12) e no corpo do PATCH.

## Protótipo x APP atual

Classificação de cada funcionalidade/conceito do protótipo contra o que o APP realmente tem.

### Já existe / reutilizar

| Conceito do protótipo | O que o APP já tem |
|---|---|
| HH produtivas realizadas por pessoa e por mês | `PontoPeriodSummary.monthly` + `mergePontoPeriods()` (`labor-cost.js:331`), alimentado pela sincronização diária do Ponto Mais |
| Separação entre horas normais e horas extras | `workedMinutes` vs `he70Minutes`/`he100Minutes`/extras genéricas, já separadas na origem |
| Base de colaboradores, cargo e admissão | `Collaborator` (`name`, `role`, `admissionDate`, `isActive`) e `JobRole` |
| Cadastro de funções (aba Administração do protótipo) | `JobRoleManager.tsx` + `routes/resources/job-roles.js` — falta só a marcação de operacional |
| Filtros por ano/período | `utils/sedePeriods.ts` e o padrão da aba Sede (feature 004) |
| Controle de acesso por papéis | Registry de módulos com `<modulo>:manager` / `<modulo>:viewer` |
| Onde a pessoa esteve (alocação realizada) | Cruzamento ponto × RDO já existente (`classifyProjectHours`, `rdoDataByCollaboratorFromReports`) e relatório mensal de alocação (`allocation-monthly-report.js`) |
| Missões com cliente, local e mobilização | `Project` com `clientName`, `location`, `mobilizationDate`, `startDate`; fim previsto derivado em `avanco.js` |
| Agrupamento de missões | `AcompanhamentoMissionGroup` |
| Trilha de auditoria | Padrão já usado em outros módulos (`ReportAuditLog`, `EpiSignatureRequestAuditLog`) |

### Necessário para a primeira entrega

| Item | Observação |
|---|---|
| Módulo `efetivo` no registry + papéis + rota + card do hub | Scaffold `npm run new:module` |
| `JobRole.isOperational` (migration + UI no `JobRoleManager`) | Define o denominador do indicador (D-4) |
| Motor `productivity.js` com a fórmula oficial | 161 HH; HE fora; piso 0%; taxa geral = média simples |
| Endpoint `GET /api/efetivo/produtividade` (+ detalhe) | Zod, permissão modular |
| Tela Produtividade (KPIs, evolução mensal, tabela/cards, detalhe) | Kit e tokens do APP; sem cópia do layout do protótipo |
| Lista de pendências (ponto sem vínculo, sem meses, cargo sem `JobRole`) | Equivalente ao "Lançamentos pendentes" do protótipo |
| Parâmetro configurável da referência mensal | Evita 161 espalhado no código |
| **Cadastro de férias** (`CollaboratorAbsence`, tipo `FERIAS`) + seção "Férias e ausências" | Decisão D-1: o APP passa a saber quando alguém esteve de férias |
| **Data de desligamento** no colaborador | Decisão D-3: fecha os meses analisados de quem saiu |
| Testes de fórmula e permissão + tutorial/novidade | Constitution V e VI |

### Preparar arquitetura (agora), implementar depois

| Item | Como preparar sem implementar |
|---|---|
| Seções futuras (Visão geral, Calendário, Colaboradores, Missões, Evolução, Simulações, Administração) | `EfetivoPage` navega por `?section=`, com apenas `produtividade` registrada; adicionar seção é adicionar entrada, não refatorar a página |
| Conceito de "efetivo operacional" | Nasce como propriedade de `JobRole`, reutilizável por qualquer indicador futuro |
| Leitura do ponto como biblioteca | `productivity.js` consome funções puras; se a fronteira entre módulos incomodar, mover `mergePontoPeriods`/`filterIgnoredPontoPeriods` para `backend/src/lib/ponto/` |
| Parâmetros do módulo | Um lugar único para constantes (161 hoje; prazos de folga, metas e janelas amanhã) |
| Competência mensal | O serviço já expõe "meses analisados" e a data da última sincronização — se o fechamento formal for aprovado (D-2), ele vira um filtro sobre a mesma lista, não uma reescrita |
| Demais tipos de ausência (folga, afastamento, ASO/ASU, NR) | O enum `CollaboratorAbsenceType` já nasce com os tipos; a UI expõe só `FERIAS`. Habilitar um tipo depois é liberar opção, não migrar schema |
| Período aquisitivo / alerta de férias vencidas | O histórico de férias passa a existir com esta entrega; a regra CLT fica para depois (D-9) |

### Futuro / fora do escopo desta entrega

| Item do protótipo | Por quê fica fora |
|---|---|
| Visão geral com efetivo ativo, alocados, livres, indisponíveis e déficit do dia | Depende de alocação **planejada** e de ausências, que não existem no APP |
| Calendário operacional (dia/semana/mês, ausências, conflitos) | Exige cadastro de ausências, feriados e alocação planejada |
| Missões com composição por função em **pessoas**, retorno e "alocar disponíveis" | Hoje a previsão por cargo é em **horas** (`ProjectPlannedNormalHours`), não em cabeças; não há data de retorno nem alocação planejada por pessoa |
| Kanban de evolução das missões (stand by → … → finalizados) | Não existe status de ciclo de vida em `Project`; é feature própria e toca o Acompanhamento |
| Simulações de cenário com contratações hipotéticas | Depende de missões planejadas e disponibilidade futura |
| Alertas de permanência contínua em obra / folgas a programar | **A regra foi confirmada** (90/60/30 por nível de função, D-5), mas o alerta depende de alocação por pessoa em missão, que não existe |
| Taxa de alocação / utilização planejada (90 dias, meta 80%) | Indicador distinto; fórmula explicitamente **não presumida** (D-6) |
| "+ Lançar HH" (entrada manual de horas) | Contraria a feature 010, que eliminou o lançamento manual — Ponto Mais é a verdade do tempo |
| Papéis "Planejador"/"Leitor" e convites do protótipo | O APP já tem seu próprio modelo de papéis; adotar `manager`/`viewer` |

### Regra de negócio: o que já foi decidido e o que falta

Decidido pelo solicitante em 2026-08-20 (detalhe em [spec.md](./spec.md)):

| Tema | Decisão |
|---|---|
| "Meses analisados" | Meses ativos com pró-rata só em admissão/desligamento — **e o APP ganha cadastro de férias** (D-1) |
| Competências abertas | O mês corrente fica fora; meses dentro da janela de 31 dias entram com aviso (D-2) |
| Desligados | Entram pelos meses ativos; novo campo de data de desligamento (D-3) |
| Cargos operacionais | Todos nascem operacionais; o gestor desmarca depois (D-4) |
| Prazos de folga por permanência em obra | 90 dias apoio/operadores/encarregados · 60 supervisores · 30 coordenadores/engenheiros — **regra confirmada da empresa** (D-5) |
| Férias no denominador | **Não descontam**; 161 permanece e os meses com férias são sinalizados (D-8) |

Ainda em aberto, sem bloquear a entrega:

| Tema | Decisão |
|---|---|
| Fórmula da Taxa de Alocação/Utilização | D-6 — **não presumir** |
| Meta de improdutividade (semáforo na tela) | D-7 |
| Período aquisitivo e alerta de férias vencidas | D-9 |

## Roadmap de expansão (referência conceitual, não compromisso)

```text
Efetivo Operacional
├── Produtividade            ← ENTREGA 1 (esta feature)
├── Férias e ausências       ← ENTREGA 1 (cadastro de férias; demais tipos preparados)
├── Administração            ← Entrega 2: trilha e demais parâmetros (referência mensal e marcação
│                               de função operacional já saem na Entrega 1)
├── Colaboradores            ← Entrega 3: base + situação na data (usa o cadastro da entrega 1)
├── Calendário               ← Entrega 4: exige feriados + alocação planejada
├── Missões                  ← Entrega 5: exige necessidade por função em pessoas e retorno
├── Visão Geral              ← Entrega 6: só faz sentido quando 3–5 existirem
├── Evolução / Histórico     ← Entrega 7: status de ciclo de vida da missão
└── Simulações               ← Entrega 8: depende de 4–6
```

Ordem proposta pelo custo de pré-requisito: quase tudo na Visão Geral do protótipo depende de dois
cadastros que hoje não existem — **ausências** e **alocação planejada por pessoa**. A entrega 1
resolve o primeiro (começando por férias); o segundo continua sendo o gargalo de Calendário,
Missões, Visão Geral, Simulações e do alerta de folga da regra 90/60/30.

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Recorte parcial do ano penaliza quem tirou férias dentro da janela | Indicador injusto entre pessoas com férias em meses diferentes | Decisão D-8 mantém 161 sem novo desconto; a tela **sinaliza** os meses com férias a partir do cadastro novo. Se incomodar na prática, existe a base equivalente (176 com férias fora do denominador) já analisada |
| Sobreposição ou digitação errada no cadastro de férias | Sinalização errada e, no futuro, disponibilidade errada | Validação Zod de período invertido e sobreposto; soft delete com autoria |
| Correção retroativa do Ponto Mais muda número já divulgado | Perda de confiança | Exibir data da última sincronização e alcance do período (FR-014) |
| Cargo sem `JobRole` correspondente esconde pessoa | Indicador incompleto | Pendência explícita (FR-013) |
| Dado pessoal (produtividade individual) exposto a papel amplo | LGPD | Papel próprio do módulo; revisar `LGPD_ROPA.md` ao implementar |
| Dependência do novo módulo em `lib/acompanhamento` | Acoplamento entre módulos | Importar só funções puras; extrair para `lib/ponto/` se crescer |

## Próximos passos

1. ✅ Decisões **D-1 a D-5 e D-8** respondidas pelo solicitante em 2026-08-20 e incorporadas à spec.
2. Rodar `/speckit-tasks` para gerar `tasks.md` a partir desta spec e deste plano.
3. Implementar em uma única PR: registry + migration + backend + frontend + testes.
4. Migration e deploy entregues como blocos "rode no servidor" (Princípio I).
