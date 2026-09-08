# Implementation Plan: Planejamento Completo do Efetivo Operacional

**Branch**: `feat/efetivo-operacional` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-planejamento-efetivo/spec.md`

## Summary

Concluir o módulo Efetivo Operacional e integrá-lo aos cadastros e fatos já canônicos do APP. `Collaborator.jobRoleId` será a única fonte do cargo atual; a exceção `EpiCollaboratorProfile.roleOverrideJobRoleId` ficará restrita ao EPI e cada solicitação/documento capturará o cargo emitido em snapshot. Missões continuarão sendo planejamento ligado a `Project`, enquanto RDO, Acompanhamento e Ponto permanecem fontes do realizado: a equipe planejada será sugerida ao RDO, exibida no Acompanhamento e comparada com pessoas/datas/horas observadas, sem sincronização silenciosa. Ausências e feriados passarão a serviços compartilhados. Como o Efetivo ainda não foi à produção, seus modelos podem nascer diretamente no desenho final; dados produtivos dos demais módulos serão preservados e migrados com diagnóstico e gates de integridade.

## Technical Context

**Language/Version**: Node.js ESM/JavaScript no backend; TypeScript 5.8.3 e React 19 no frontend
**Primary Dependencies**: Express 5.2, Zod 4.4, Prisma 7.9; React Query, React Hook Form, React Router e Driver.js
**Storage**: PostgreSQL 16 por Prisma; datas civis em `@db.Date`; auditoria relacional
**Testing**: `node:test` no backend e frontend, ESLint, TypeScript/Vite build e Playwright para fluxos visuais
**Target Platform**: navegador moderno responsivo e servidor Linux em containers existentes
**Project Type**: aplicação web full-stack em `backend/` e `frontend/`
**Performance Goals**: consultas de dashboard/calendário em até 2 s no volume de referência; interações locais do Kanban e filtros sem espera perceptível
**Constraints**: sem dependência nova para calendário ou DnD; sem scroll horizontal de página; transações atômicas para mutações oficiais; nenhuma HH manual; planejado nunca sobrescreve realizado sem ação explícita; override de cargo nunca sai do EPI
**Scale/Scope**: até 500 colaboradores ativos, 100 missões por plano, horizonte principal de 90 dias, oito seções do módulo e quatro integrações consumidoras (EPI, RDO, Acompanhamento e Ponto)

## Constitution Check

*GATE: aprovado antes da pesquisa e revalidado após o desenho.*

- Operação de servidor/deploy: **PASS** — o plano limita-se a código, migração versionada e comandos locais de validação; aplicação em produção fica documentada para o operador.
- UI pt-BR e mobile-first: **PASS** — tabelas viram cards/agenda, Kanban vira lista com seletor de etapa e grades usam `minmax(min(100%, ...), 1fr)`/`min-width: 0`.
- Validação Zod: **PASS** — contratos compartilhados por schemas equivalentes no frontend/backend e mensagens por campo.
- Prisma migrations: **PASS** — tabelas inéditas do Efetivo podem ser remodeladas diretamente; cadastros produtivos recebem migração versionada, script idempotente com `--dry-run`, materialização de nomes legados não vazios e gate para nomes vazios/associações ambíguas antes de `jobRoleId NOT NULL`/remoção de `role`.
- Testes de negócio: **PASS** — além das regras internas, cargo/EPI, contexto planejado do RDO, projeção planejado × realizado, calendário único e políticas de ausência terão testes em `backend/test`.
- Sistema visual: **PASS** — componentes compartilhados, tokens e shell largo existentes; nenhum port de identidade visual será usado.
- Drag-and-drop: **PASS** — padrão compartilhado com handle, live reorder, placeholder, ghost, cancelamento, Pointer Events e alternativa acessível.
- Novidade/onboarding: **PASS** — campanha de 10 dias a partir de 2026-08-21 e tutorial permanente de primeiro acesso ao módulo expandido.
- Navegação em URL: **PASS** — `section`, data, visão, filtros e seleção compartilháveis usam query params com limpeza dos incompatíveis.

**Required visual evidence when frontend changes are present:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Visão geral e calendário | `ProductivityBoard`, `AcompanhamentoDashboard`, `SedeCostsBoard` e layouts `equip-*` | `Card`, `Button`, `SearchBar`, `field-group`, `efetivo-kpis` | filtros default/focus/disabled/empty | N/A | `section`, `date`, `view`, `role` | novidade 10 dias + etapas do tutorial | grade mensal vira agenda; cards encolhem sem overflow |
| Colaboradores e ausências | `AbsenceFormModal` e tabela responsiva do Efetivo | `Modal`, `Button`, `SearchBar`, novo `SearchCombobox`, `field-invalid`, `field-error` | default/focus/disabled/error/required-empty | N/A | filtros e colaborador em query params | etapa específica no tutorial | tabela vira cards em até 640 px; rodapé fixo no modal |
| Missões e alocação | `ProjectCardsBoard`, `AbsenceFormModal` | `Modal`, `Button`, busca, checkboxes acessíveis, badges e cards | colaboradores pesquisáveis por nome/cargo, loading, empty, disabled, selected e error | N/A | filtros, missão e modal em query params | etapa específica no tutorial | lista de equipe rolável e resumo empilhado no mobile; sem select largo |
| Evolução das missões | `QualityNaturesTab` e `utils/reorderDrag.ts` | handles/ghost/placeholders compartilhados e `Button` | seletor alternativo default/focus/disabled/error | handle + live placeholder/ghost + Pointer Events + cancel | etapa e missão selecionada em query params | etapa específica no tutorial | colunas no desktop; seletor + lista no mobile |
| Simulações e administração | `AcompanhamentoDashboard`, formulários admin e atividade existente | `Modal`, `Button`, `SearchCombobox`, `admin-form-grid`, `field-group` | default/focus/disabled/error/required-empty | N/A | cenário/filtros em query params | etapas específicas no tutorial | comparação em cards; formulários e auditoria quebram texto |

As referências serão reutilizadas somente onde atendem à constituição atual. O novo combobox nasce compartilhado porque o repositório não contém um controle pesquisável compatível com centenas de opções.

## Project Structure

### Documentation (this feature)

```text
specs/012-planejamento-efetivo/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── efetivo-planning.openapi.yaml
│   └── efetivo-integrations.openapi.yaml
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_centralize_workforce_planning/
├── scripts/
│   └── backfill-collaborator-job-roles.mjs
├── src/
│   ├── lib/collaborators/
│   │   ├── job-role-service.js
│   │   └── availability-service.js
│   ├── lib/calendar/
│   │   └── corporate-calendar.js
│   ├── lib/efetivo/
│   │   ├── access.js
│   │   ├── service.js
│   │   ├── date-only.js
│   │   ├── capacity.js
│   │   ├── mission-planning.js
│   │   ├── continuous-stay.js
│   │   ├── vacation-alerts.js
│   │   ├── scenarios.js
│   │   ├── planning-service.js
│   │   ├── official-mission-context.js
│   │   ├── execution-comparison.js
│   │   └── audit.js
│   ├── lib/epi/
│   │   └── collaborators.js
│   └── routes/
│       ├── efetivo-planning.js
│       └── reports.js
└── test/
    ├── collaborator-job-role-*.test.js
    ├── corporate-calendar-*.test.js
    ├── efetivo-integration-*.test.js
    ├── efetivo-planning-*.test.js
    └── epi-role-snapshot-*.test.js

frontend/
├── src/
│   ├── api/
│   │   ├── efetivoPlanning.ts
│   │   └── reports.ts
│   ├── components/ui/
│   │   └── SearchCombobox.tsx
│   ├── pages/efetivo/
│   │   ├── EfetivoPage.tsx
│   │   ├── EfetivoTutorial.tsx
│   │   ├── EfetivoPlanningNovelty.tsx
│   │   ├── components/
│   │   │   ├── OverviewBoard.tsx
│   │   │   ├── OperationalCalendar.tsx
│   │   │   ├── CalendarDayDetail.tsx
│   │   │   ├── CollaboratorsBoard.tsx
│   │   │   ├── OperationalCollaboratorModal.tsx
│   │   │   ├── MissionsBoard.tsx
│   │   │   ├── MissionFormModal.tsx
│   │   │   ├── MissionAllocationModal.tsx
│   │   │   ├── MissionKanban.tsx
│   │   │   ├── ScenariosBoard.tsx
│   │   │   ├── ScenarioFormModal.tsx
│   │   │   ├── ScenarioComparison.tsx
│   │   │   ├── AdministrationBoard.tsx
│   │   │   ├── HolidayManager.tsx
│   │   │   └── EfetivoActivityList.tsx
│   │   └── efetivo.css
│   └── utils/
│       ├── planningNavigation.ts
│       ├── calendarGrid.ts
│       └── missionKanban.ts
└── test/
    ├── efetivo-planning-*.test.ts
    └── mission-kanban-*.test.ts
```

**Structure Decision**: manter a arquitetura web existente e expandir o bounded context `efetivo`, extraindo apenas conceitos realmente corporativos: cargo atual, disponibilidade e calendário. Regras exclusivas do plano continuam em `backend/src/lib/efetivo`; EPI consome o cargo canônico mais seu override local; RDO e Acompanhamento consomem um contexto sanitizado por serviços internos e suas próprias permissões, sem exigir papel do Efetivo. Nenhuma regra contábil do Ponto será duplicada no novo módulo.

## Design and Delivery Strategy

### Persistence and transactions

- Criar `EfetivoPlan` com um único oficial ativo, revisão monotônica e cenários materializados.
- Serializar mutações oficiais bloqueando a linha do plano dentro de `$transaction`; aplicar cenários por compare-and-swap de `baseOfficialRevision`.
- Bloquear por colaborador e revalidar sobreposições antes de gravar ausência, alocação ou confirmação de missão.
- Na criação/edição da missão, adquirir locks dos colaboradores em ordem estável, derivar `EfetivoMissionDemand` pelos cargos canônicos selecionados e sincronizar `EfetivoMissionAllocation` dentro da mesma transação.
- Gravar `EfetivoAuditEvent` na mesma transação, com snapshots sanitizados antes/depois.
- Centralizar o cargo em `Collaborator.jobRoleId NOT NULL`; primeiro migrar consumidores para a relação, depois executar diagnóstico/backfill idempotente, materializar uma função provisória por nome legado ausente, bloquear somente nomes vazios/ambiguidades e então remover `Collaborator.role`.
- Migrar a exceção textual atual para `EpiCollaboratorProfile.roleOverrideJobRoleId`, acessível somente ao EPI, preservando overrides produtivos por diagnóstico normalizado; adicionar snapshots de ID/nome/origem à solicitação/documento; limpar o override afeta apenas emissões futuras.
- Adicionar snapshots de cargo a `ReportCollaborator` para que RDOs/PDFs históricos não mudem quando o cargo canônico for alterado.
- Persistir `headquartersResponsibleUserId` obrigatório na missão e manter nome/cargo como snapshots históricos.
- Substituir `EfetivoHoliday` por calendário corporativo compartilhado; tabelas/migrations inéditas do Efetivo serão ajustadas diretamente, sem camadas de compatibilidade.
- Adicionar revisão global de disponibilidade/calendário e capturá-la nos cenários; ausência nova sobre missão existente é persistida e cria pendência, enquanto novas alocações sobre ausência continuam bloqueadas.
- Preservar `Project.laborCollaboratorIds` e demais dados produtivos; qualquer novo rastreio de prefill em `Report` será aditivo e anulável.

### Query and projection strategy

- Carregar projetos, missões, demandas, alocações, ausências, calendário resolvido, cargos e vínculos em consultas em lote por horizonte.
- Projetar capacidade, utilização e calendário por conjuntos `collaboratorId|date` para deduplicar dias e impedir taxas acima de 100%.
- Reutilizar a mesma projeção pura na visão geral, calendário e comparação de cenário.
- Criar `getOfficialMissionContext(projectId, date)`, restrito a plano `OFFICIAL/ACTIVE` e missão `CONFIRMED`, para sugerir datas/equipe sem vazar cenários ou auditoria.
- Criar read model de execução por missão que reutiliza as agregações existentes do Acompanhamento/Ponto e retorna planejamento, observado, divergências e freshness; não copiar esses fatos para tabelas do Efetivo.
- Tratar `Project.laborCollaboratorIds` como exceção/manual do Acompanhamento, nunca como equipe planejada ou realizada do Efetivo.
- Produtividade permanece no endpoint e modelos existentes do Ponto Mais.

### API and compatibility

- Expor projetos mínimos e cargos operacionais pelo escopo `efetivo:viewer`, sem conceder acesso RDO.
- Restringir mutações cadastrais do Efetivo a nome, `jobRoleId`, admissão/desligamento e observação; o mesmo serviço central atende as demais superfícies autorizadas.
- Erros de conflito retornam código estável, pessoa, origem, período e IDs navegáveis.
- `MissionInput` passa a receber `collaboratorIds`; a resposta continua expondo demandas derivadas e alocações para capacidade, calendário, cenários e clientes de leitura.
- Expor `GET /planning/missions/{missionId}/execution` ao Efetivo e um contexto mínimo sob as rotas de Reports/Acompanhamento com autorização do módulo consumidor; usuários de RDO não precisam receber `efetivo:viewer`.
- No RDO novo, aplicar precedência: seleção/draft já alterado pelo usuário → equipe da missão oficial confirmada → último RDO. Mudanças posteriores no plano nunca reescrevem silenciosamente um draft já tocado.
- Ausências são compartilhadas com políticas distintas: bloqueio de nova alocação no plano; ausência superveniente gera pendência; alerta com justificativa/auditoria no RDO; divergência informativa no Ponto; sinalização no Acompanhamento.

### Validation and tests

- Datas: ano bissexto, data impossível, limites inclusivos, DST e intervalos invertidos.
- Capacidade: fins de semana, feriados, vínculo parcial, ausência, denominador zero e deduplicação.
- Conflitos: ausência × ausência, ausência × missão, missão × missão, função/vínculo e corrida concorrente.
- Missões: cronologia, seleção direta da equipe, derivação de demanda, sincronização atômica, autoalocação legada, déficit parcial e idempotência.
- Permanência/férias: intervalos adjacentes, lacunas, FOLGA, limites e janelas aquisitiva/concessiva.
- Cenários: comparação isolada, rollback integral, revisão obsoleta, retry e aplicação concorrente.
- Cargo: todas as leituras atuais pela FK, backfill seco/ambíguo, remoção do fallback textual, renome de cargo e invalidação de revisão/cache.
- EPI: override não altera o canônico, snapshot sobrevive à limpeza/renome, solicitação e PDF usam o mesmo valor e documentos assinados permanecem imutáveis.
- Integração: lookup ignora cenário/rascunho/cancelado, prefill respeita precedência e RBAC, divergência de equipe não altera missão, datas planejadas não alteram `Project` e vice-versa.
- Calendário/ausências: RDO e Efetivo recebem o mesmo feriado; plano bloqueia ausência, RDO exige justificativa e Ponto preserva horas com flag.
- Regressão do Acompanhamento: planejamento não supera override/tag/RDO no rateio, não vira janela contábil e preserva `laborCollaboratorIds` existente.
- Frontend: navegação por URL, calendário, cards mobile, formulários inválidos, Kanban com cancelamento/toque e alternativa acessível.

## Implementation Phases

### Phase 1 — Fundamentos compartilhados

- Criar o serviço canônico de colaborador/cargo e migrar todos os leitores/escritores de cargo atual para `jobRoleId`/`JobRole.name`.
- Entregar diagnóstico `--dry-run`, resolver pendências, impor a FK obrigatória e remover `Collaborator.role` somente após o gate.
- Extrair disponibilidade e calendário corporativo compartilhados, preservando a regra nacional já usada pelo RDO.

### Phase 2 — Exceções e snapshots históricos

- Isolar a edição de `roleOverrideJobRoleId` no perfil EPI e capturar ID/nome/origem na solicitação/documento.
- Adicionar snapshot de cargo a `ReportCollaborator` e migrar PDFs/leitores históricos para o snapshot.
- Adicionar a FK obrigatória de `User` responsável e os índices finais diretamente ao modelo inédito da missão.

### Phase 3 — Contexto planejado nos módulos consumidores

- Implementar o resolvedor de missão oficial por projeto/data.
- Integrar o prefill do RDO com precedência e rastreio da missão/revisão usada.
- Exibir no Acompanhamento o bloco planejado, sem alterar rateio do Ponto nem `laborCollaboratorIds`.

### Phase 4 — Planejado × realizado

- Implementar o agregador de execução por missão reutilizando Project, RDO, Acompanhamento e Ponto.
- Expor diferenças de datas/equipe, trabalho fora da janela, ausências e freshness da importação.
- Exibir sugestão de etapa observada sem movimentar automaticamente o Kanban.

### Phase 5 — Consistência, cenários e entrega

- Ligar mudanças de cargo à revisão do plano e mudanças de ausência/calendário à revisão global usada por caches e pela obsolescência de cenários impactados.
- Completar testes de integração, migração, concorrência, RBAC e regressão dos cálculos produtivos.
- Executar os gates do quickstart e entregar migrações/scripts ao operador, sem deploy ou reinício de produção.

## Operational Handoff

A implementação produzirá migração Prisma, diagnóstico/backfill idempotente e comandos locais de validação. O handoff exigirá: relatório seco sem nomes vazios/ambiguidades, ciência dos cargos provisórios listados em `rolesToCreate`, backup/procedimento de rollback do operador, materialização e vínculo automáticos, imposição da FK e somente então remoção da coluna textual. Tabelas inéditas do Efetivo podem ser recriadas diretamente. Não serão executados deploy, migração em produção nem reinício de serviços nesta fase; o quickstart separa os comandos de desenvolvimento dos passos do operador.

## Complexity Tracking

Não há violações constitucionais a justificar. A complexidade adicional está limitada a três conceitos compartilhados que eliminam duplicação real: serviço canônico de cargo, disponibilidade/calendário corporativo e projeção planejado × realizado. O perfil EPI e os snapshots de EPI/RDO são necessários para manter exceções e documentos históricos fora da fonte do cargo atual. Nenhum fato financeiro ou realizado é transferido de dono.
