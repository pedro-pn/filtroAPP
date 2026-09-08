# Tasks: Recebimento de projetos por webhook

**Input**: Design documents from `/specs/009-project-intake-webhook/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos porque a feature adiciona regras de negócio no backend e validação de formulário no frontend.

**Organization**: As tarefas são agrupadas por história de usuário e ordenadas para permitir validação incremental.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Habilitar a configuração segura da integração sem ativá-la implicitamente.

- [X] T001 Adicionar `PROJECT_INTAKE_WEBHOOK_TOKEN`, default desabilitado e cobertura de parsing em `backend/src/config/env.js`, `backend/.env.example` e `backend/test/env.test.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Criar os blocos compartilhados de contrato, normalização e autenticação usados pelas histórias.

**⚠️ CRITICAL**: Nenhuma história deve prosseguir sem estes contratos estabilizados.

- [X] T002 Criar schema Zod estrito, normalização de CNPJ sem truncamento, seleção pública, defaults seguros e erro de conflito em `backend/src/lib/projects/project-intake.js`
- [X] T003 Criar o router dedicado com autenticação Bearer em tempo constante e montá-lo em `/api/webhooks/projects` usando `backend/src/routes/resources/project-intake-webhook.js` e `backend/src/routes/index.js`

**Checkpoint**: payload e autenticação disponíveis para a implementação das histórias.

---

## Phase 3: User Story 1 - Receber projeto externo sem duplicidade (Priority: P1) 🎯 MVP

**Goal**: Receber um projeto autenticado, criar exatamente um cadastro pendente e responder idempotentemente a repetições.

**Independent Test**: Enviar o payload válido com token, repetir o envio e confirmar HTTP 201/200, um único `Project`, os seis dados normalizados, defaults seguros e `registrationPending=true`.

### Tests for User Story 1

- [X] T004 [P] [US1] Escrever testes HTTP de configuração/token, criação, defaults, trim, CNPJ pontuado, zeros à esquerda e repetição antes/depois da revisão em `backend/test/project-intake-webhook.test.js`
- [X] T005 [P] [US1] Escrever testes de bloqueio de contas e de criação/reassociação de relatórios para projeto pendente em `backend/test/project-visibility.test.js` e no teste de rotas de relatórios correspondente em `backend/test/`

### Implementation for User Story 1

- [X] T006 [US1] Implementar criação idempotente, recuperação de corrida `P2002`, preservação do estado revisado e limpeza de `statisticsProjectsCache` em `backend/src/lib/projects/project-intake.js`
- [X] T007 [US1] Integrar o serviço ao POST e devolver os resultados `created`/`already_exists` em `backend/src/routes/resources/project-intake-webhook.js`
- [X] T008 [US1] Reforçar `registrationPending=false` nos fluxos backend que criam ou reassociam relatórios, preservando o fluxo de Romaneio, em `backend/src/routes/resources/reports.js` e `backend/src/lib/project-visibility.js`

**Checkpoint**: o sistema externo já cria um único projeto que permanece indisponível até revisão.

---

## Phase 4: User Story 2 - Identificar e revisar projetos importados (Priority: P1)

**Goal**: Dar ao gestor uma notificação quantitativa, um cartão destacado e uma confirmação manual clara e acessível.

**Independent Test**: Carregar um projeto pendente, abrir `?tab=projetos`, verificar contador/seção/cartão antes da lista normal, revisar os seis dados e confirmar que salvar remove pendência, aviso e destaque.

### Tests for User Story 2

- [X] T009 [P] [US2] Escrever testes dos seis campos, mensagens genéricas, contagem/partição e janela de novidade em `frontend/test/project-pending-review.test.mjs`

### Implementation for User Story 2

- [X] T010 [P] [US2] Criar schema Zod, valores iniciais, mensagens e helpers puros da revisão em `frontend/src/pages/gestor/projectPendingReview.ts`
- [X] T011 [P] [US2] Adicionar tokens globais de alerta, `.field-error`, cartão pendente e regra móvel de uma coluna usando `frontend/src/styles/variables.css` e `frontend/src/styles/base.css`
- [X] T012 [US2] Criar formulário focado com react-hook-form/Zod, código somente leitura, seis campos obrigatórios, `.field-group.field-invalid`, `aria-invalid` e `aria-describedby` em `frontend/src/pages/gestor/PendingProjectReviewForm.tsx`
- [X] T013 [US2] Integrar seção semântica, `aria-live`, texto automático genérico, Local, cartão inteiro destacado e ações “Revisar cadastro”/“Confirmar e salvar” em `frontend/src/pages/gestor/GestorPage.tsx`
- [X] T014 [US2] Implementar card centralizado e tutorial Driver.js com marcador por gestor/navegador e expiração em 2026-08-23 em `frontend/src/pages/gestor/ProjectIntakeWebhookNovelty.tsx`, `frontend/src/auth/moduleNavigation.ts` e `frontend/src/pages/gestor/GestorPage.tsx`

**Checkpoint**: o gestor localiza e conclui a revisão sem documentação externa, em desktop e mobile.

---

## Phase 5: User Story 3 - Corrigir envios inválidos ou conflitantes (Priority: P2)

**Goal**: Rejeitar deterministicamente dados inválidos e reutilização conflitante de número, sem alterar projetos.

**Independent Test**: Enviar campos faltantes, CNPJ de 13/15 dígitos e cada variante divergente de um código existente; confirmar HTTP 400/409, corpo seguro e nenhuma escrita.

### Tests for User Story 3

- [X] T015 [P] [US3] Completar testes de campos ausentes/extras, CNPJ curto/longo, conflito por campo, registro soft-deleted, corrida divergente e resposta sem detalhes internos em `backend/test/project-intake-webhook.test.js`

### Implementation for User Story 3

- [X] T016 [US3] Finalizar respostas 400/409/503 estáveis e seguras, mantendo Zod e falhas inesperadas no handler global, em `backend/src/routes/resources/project-intake-webhook.js` e `backend/src/lib/projects/project-intake.js`

**Checkpoint**: todas as classes de erro do contrato são distinguíveis e não causam mutação.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, consistência visual e validação completa.

- [X] T017 [P] Documentar configuração, contrato, respostas e fluxo de revisão em `README.md`, `backend/.env.example` e `specs/009-project-intake-webhook/quickstart.md`
- [X] T018 Executar os testes backend/frontend, lint, typecheck/build e corrigir regressões nos arquivos tocados conforme `specs/009-project-intake-webhook/quickstart.md`
- [X] T019 Auditar visualmente a aba Projetos em 360/430/768 px e desktop, confirmando campos inválidos, wrapping, ausência de scroll horizontal, `?tab=projetos`, aviso/tour e desaparecimento após revisão conforme `specs/009-project-intake-webhook/plan.md`
- [X] T020 Executar `detect_changes`, `get_affected_flows` e `tests_for` no code-review-graph e resolver riscos ou lacunas de cobertura identificados nos arquivos alterados
- [X] T021 Identificar explicitamente a origem webhook nos avisos de projeto pendente, sem rotular incorretamente pendências do Romaneio, em `frontend/src/pages/gestor/projectPendingReview.ts`, `frontend/src/pages/gestor/GestorPage.tsx` e testes associados

## Phase 7: Seleção automática da revisão comercial

**Purpose**: Usar proposta e revisão recebidas para preencher a proposta padronizada e escolher automaticamente a revisão principal já importada, sem retirar o controle manual do gestor.

- [X] T022 [US1] Atualizar payload, normalização e resposta do webhook com `revision`, proposta “{proposta} Rev. {revisão}” e estado da seleção em `backend/src/lib/projects/project-intake.js` e `specs/009-project-intake-webhook/contracts/project-intake-webhook.openapi.yaml`
- [X] T023 [US1] Permitir que a regra existente de seleção de orçamento seja reutilizada com cliente transacional, preservando o endpoint manual, em `backend/src/lib/acompanhamento/access-import.js`
- [X] T024 [US1] Selecionar automaticamente a proposta principal correspondente quando não houver revisão vigente, preservar escolha manual e repetir a tentativa em reenvio idempotente em `backend/src/lib/projects/project-intake.js`
- [X] T025 [US1] Cobrir formatação, revisão inválida, seleção encontrada/ausente, desempate, reenvio posterior e preservação da escolha manual em `backend/test/project-intake-webhook.test.js` e `backend/test/acompanhamento-access-import.test.js`
- [X] T026 Documentar o payload atualizado, respostas e comportamento de fallback em `README.md`, `specs/009-project-intake-webhook/quickstart.md`, `data-model.md` e `research.md`
- [X] T027 Executar testes, audit, lint, build, architecture check e revisão final no code-review-graph; atualizar a PR #167

## Phase 8: Terminologia Proposta

**Purpose**: Corrigir o nome histórico do identificador comercial sem migrar o campo interno persistido e antes de publicar o webhook.

- [X] T028 [US1] Alterar o contrato externo do webhook de `contractCode` para `proposalCode`, sem alias legado, e mapear entrada/saída para o campo interno existente em `backend/src/lib/projects/project-intake.js`
- [X] T029 [P] [US1] Atualizar testes backend para exigir `proposalCode`, rejeitar `contractCode` e devolver somente a terminologia nova em `backend/test/project-intake-webhook.test.js`
- [X] T030 [P] [US2] Trocar labels, ajudas, mensagens e validações visíveis de “Contrato” para “Proposta” nas superfícies de projetos e acompanhamento em `frontend/src/` e `backend/src/lib/zod-error.js`
- [X] T031 [P] [US2] Trocar a terminologia em e-mails, PDF e mapas de modelos, preservando textos jurídicos e contratos de API, em `backend/src/lib/email-templates.js`, `backend/src/lib/report-pdf.js` e `Modelos/definitivos/*.txt`
- [X] T032 Atualizar OpenAPI, README, quickstart, modelo de dados e especificações de negócio relacionadas em `specs/009-project-intake-webhook/`, `specs/006-unificar-missoes-acompanhamento/` e `README.md`
- [X] T033 Executar testes backend/frontend, lint, build, audits, architecture check e revisão final no code-review-graph; atualizar a PR #167

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: inicia imediatamente.
- **Foundational (Phase 2)**: depende de T001 e bloqueia as histórias.
- **US1 (Phase 3)**: depende da base; entrega o MVP de recebimento seguro.
- **US2 (Phase 4)**: depende de o estado pendente produzido por US1; seus testes/helpers e CSS podem avançar em paralelo.
- **US3 (Phase 5)**: depende do serviço de US1 e completa os ramos negativos.
- **Polish (Phase 6)**: depende das histórias selecionadas completas.

### User Story Dependencies

```text
Setup → Foundation → US1 (MVP) → US2
                         └──────→ US3
US1 + US2 + US3 → Polish
```

### Within Each User Story

- Escrever e executar os testes antes da implementação correspondente.
- Estabilizar schema/serviço antes de ligar a rota.
- Aplicar os helpers e tokens antes de integrar o JSX.
- Validar cada checkpoint antes de avançar.

### Parallel Opportunities

- T004 e T005 usam arquivos de teste diferentes.
- T009 pode avançar em paralelo com o backend depois da fundação.
- T010 e T011 usam arquivos independentes.
- US2 e US3 podem avançar em paralelo depois de US1.
- T017 pode avançar antes da verificação final.

## Parallel Examples

### User Story 1

```text
T004: testes do contrato e da idempotência do webhook
T005: testes dos bloqueios operacionais
```

### User Story 2

```text
T010: schema e helpers de revisão
T011: tokens e estilos responsivos
```

### User Story 3

```text
T015: matriz de erros e conflitos enquanto US2 trabalha no frontend
```

## Implementation Strategy

### MVP First

1. Completar Setup e Foundation.
2. Implementar US1 e validar criação/idempotência/bloqueios.
3. Só então integrar a revisão visível de US2 e os erros avançados de US3.

### Incremental Delivery

1. Configuração e contrato seguro.
2. Recebimento idempotente com projeto pendente.
3. Notificação e revisão manual completa.
4. Matriz de erros/conflitos e endurecimento final.

## Notes

- `[P]` marca arquivos que podem ser tratados sem dependência de uma tarefa incompleta.
- `[USn]` mantém rastreabilidade com `spec.md`.
- Nenhum comando de servidor, Docker, deploy ou banco faz parte da execução.
- Todas as 20 tarefas usam o formato obrigatório com checkbox, ID, rótulo quando aplicável e caminho explícito.
