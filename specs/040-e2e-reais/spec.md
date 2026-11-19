# Feature Specification: Testes ponta a ponta reais (navegador → API → PostgreSQL)

**Feature Branch**: `docs/spec-040-e2e-reais` (plano) → implementação em `test/e2e-reais`

**Created**: 2026-11-19

**Status**: Draft — aguardando decisões do usuário

**Input**: Auditoria "13 pilares", critério 2.1 ("testes de unidade, de banco e **ponta a
ponta**: o fluxo principal do usuário, do clique ao resultado"). Reavaliação de 2026-11-18:
as 42 specs de `frontend/e2e` rodam contra `vite dev`, e 24 arquivos simulam a API com
`page.route`. Nenhum teste atravessa navegador → backend real → banco real.

## Contexto

Os testes de navegador atuais pegam regressões de tela, mas não quebras de contrato entre
frontend e backend (campo renomeado, permissão nova, validação Zod mais estrita, migration
que muda o formato). Essas quebras só aparecem em produção. A suíte de backend (3.300+
testes, parte com PostgreSQL real) cobre a API isolada; falta o elo entre as duas pontas.

Escopo deliberadamente pequeno: poucas jornadas críticas, rápidas e determinísticas. Não
substitui os testes de navegador com mocks (que seguem cobrindo estados de tela).

## User Scenarios & Testing *(mandatory)*

### Jornada 1 — Login com segundo fator (Priority: P1)

Conta ADMIN entra com usuário e senha, recebe o código de 6 dígitos por e-mail (capturado
por uma caixa de teste), confirma e chega ao hub. Prova 4.1 (2FA) e o contrato
`/api/auth/login` → `/api/auth/2fa/verify`.

**Acceptance**: sessão criada só após o código; código errado mostra erro genérico;
"Lembrar este navegador" dispensa o código no login seguinte do mesmo contexto.

### Jornada 2 — RDO do rascunho ao PDF (Priority: P1)

Gestor cria um RDO num projeto do seed, preenche equipe/serviço, envia para emissão e
baixa o PDF. Prova o fluxo principal do produto (`POST /api/reports`,
`PATCH /api/reports/:id/status`, `GET /api/reports/:id/pdf`).

**Acceptance**: PDF baixado é um PDF válido (cabeçalho `%PDF-`, ≥ 1 página) com o código
do relatório; o RDO aparece na listagem com o status esperado.

### Jornada 3 — Efetivo: missão e alocação (Priority: P2)

Gestor do Efetivo cria uma missão e aloca um colaborador; o colaborador aparece na
programação e a alocação conflitante é recusada pela API real.

### Jornada 4 — Permissão negada (Priority: P1)

Colaborador (COLLABORATOR) tenta abrir, pela URL, um RDO de projeto em que não participa
e uma tela de gestão: a API real responde 403/404 e a tela mostra a mensagem de acesso
negado. Prova 5.1 ("chamar a rota direto com usuário sem permissão").

### Jornada 5 — Fumaça do Data Book (Priority: P3, opcional)

Gerar o Data Book de um projeto do seed e conferir que o PDF sai. Depende do gerador Python
(já instalado no job Backend); entra só se couber no orçamento de tempo (decisão D4).

## Requirements *(mandatory)*

- **FR-001**: backend real (`node src/server.js`) e worker desligado, PostgreSQL 16 próprio
  do job, `prisma migrate deploy` completo e seed determinístico dedicado (`e2e-seed.js`).
- **FR-002**: frontend é o build de produção servido por `vite preview` com o proxy já
  existente em `frontend/vite.config.ts` (`preview.proxy`) — o mesmo bundle que vai ao ar.
- **FR-003**: e-mail capturado por uma caixa de teste (Mailpit como *service container* no
  CI, SMTP sem TLS na rede do job); o código é lido pela API HTTP da caixa. Nenhum caminho
  de código "só de teste" no mailer de produção.
- **FR-004**: determinismo — fuso `America/Sao_Paulo`, relógio do navegador fixado por
  `page.clock` onde a jornada depender de data, dados criados com prefixo único por
  execução, banco novo a cada execução do job; **sem retries** (`retries: 0`, pilar 2.3) e
  `forbidOnly`.
- **FR-005**: orçamento — o job inteiro em até ~3 min (meta) e no máximo 5 min (limite
  `timeout-minutes`), rodando em paralelo aos demais (não aumenta o tempo total do CI de
  ~3,5 min se ficar abaixo do caminho crítico).
- **FR-006**: falha deixa artefatos: trace do Playwright, log do backend e e-mails da caixa.
- **FR-007**: localmente, `npm run test:e2e:real` sobe tudo com um banco descartável
  informado por `E2E_DATABASE_URL` (recusa banco cujo nome não termine em `_e2e`).

## Success Criteria

- As jornadas P1 rodam em todo PR e bloqueiam o merge (check obrigatório "E2E (real stack)"),
  conforme decisão D1.
- Uma quebra de contrato injetada (ex.: renomear um campo da resposta de `/api/reports`)
  faz a jornada 2 falhar no CI — validado uma vez durante a implementação.
- 10 execuções seguidas do job sem falha intermitente antes de torná-lo obrigatório.
- Critério 2.1 da régua passa de 🟡 para ✅ na próxima reavaliação.
