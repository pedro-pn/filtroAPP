# Research: Efetivo Operacional — protótipo x APP atual

**Feature**: 011-efetivo-operacional | **Branch**: `feat/efetivo-operacional` | **Data**: 2026-08-19

Este documento registra as evidências levantadas antes do plano: o inventário completo do
protótipo funcional fornecido pelo solicitante e a confrontação com o que existe hoje no APP.

> **Regra de uso do protótipo**: ele foi usado **exclusivamente** como referência de
> funcionalidades, conceitos, fluxos e informações. Layout, identidade visual e arquitetura de
> frontend do protótipo **não** são referência — a UI final segue o kit, os tokens e as telas
> análogas já existentes no APP (Princípio VI da constitution).

---

## 1. Inventário do protótipo

Fonte: `https://efetivo-operacional.erikesimas.chatgpt.site/` (SPA Next.js; o conteúdo das abas é
renderizado no cliente, então o inventário foi extraído navegando pelas 8 abas).

### 1.1 Navegação

`Visão geral · Calendário · Colaboradores · Missões · Evolução das missões · Simulações ·
Produtividade · Administração`. Identificação de usuário no topo com papel ("Administrador").

### 1.2 Visão geral ("Planejamento Operacional")

- Seletor "Posição em <data>" — todos os números são de uma data de referência.
- KPIs: **Efetivo ativo** (18, "16 funções operacionais"), **Alocados** (0, "% do efetivo"),
  **Livres para atendimento** (16, "2 indisponíveis no período"), **Déficit no dia** (0,
  "Todas as vagas cobertas").
- **Permanência contínua em obra / Folgas a programar**: lista de pessoas com dias corridos
  previstos em obra e data-limite para programar folga. Prazos exibidos: "90 dias: apoio,
  operadores e encarregados · 60 dias: supervisores · 30 dias: coordenadores e engenheiros".
- **Capacidade do dia / Disponibilidade por função**: tabela por função com Alocados, Livres e
  Déficit (16 funções listadas).
- **Improdutividade real**: taxa geral (4%) com a legenda "Média oficial das pessoas com
  **competências fechadas**" e link "Abrir produtividade →".
- **Próximas mobilizações**: data, missão, cliente/local, nº de pessoas e status
  ("Equipe completa" / "2 pendentes").
- **Utilização planejada**: "Taxa de alocação · 90 dias" (25,3%), definida como "percentual dos
  dias úteis disponíveis já comprometidos com missões, descontando ausências", com "Meta de
  ocupação: 80%".

### 1.3 Calendário ("Programação integrada")

Grade dia/semana/mês, filtro por função, navegação por mês, botão "+ Programar ausência" e
legenda **Missão / Férias / Folga-afastamento**. Cada dia lista missões em curso e ausências
nominais ("Daniel · Férias", "Michael · Afastado").

### 1.4 Colaboradores ("Base operacional")

Tabela com colunas **Colaborador · Função · Situação na data · Alocação · 90 dias · Admissão**.
Busca, filtro por função, seletor "Férias em <data>", ações "+ Novo colaborador" e
"+ Férias, folga ou afastamento". Cada linha traz um estado de férias derivado do período
aquisitivo: "Sem férias programadas / Período aquisitivo até …", "Férias vencidas / Prazo vencido
em …", "Programar férias / Programar até …". Situação na data: **Livre / Férias / Afastado**.
Cabeçalho: "18 colaboradores cadastrados · 13 alertas críticos de férias".

### 1.5 Missões ("Atendimentos")

Cartões por missão com cliente, local, contagem `alocados x/y`, três marcos
(**Mobilização → Execução (intervalo) → Retorno**) e **composição por função** (`Apoio de
Operação 1/3`, etc.). Status "Confirmada"/"Concluída", alerta "2 vagas ainda precisam de pessoas"
e ação "Alocar disponíveis". Contadores: confirmadas, posições planejadas, posições pendentes.

### 1.6 Evolução das missões

Kanban com colunas **Stand by → Mobilização → Execução → Medição final → Finalizados**,
arrastar cartões entre colunas, responsável da sede por missão (com marca "também na obra") e
link "Ver responsável e equipe (n)".

### 1.7 Simulações ("Planejamento futuro")

Cenários em rascunho com missões alteradas e **contratações hipotéticas**, ações "Comparar
capacidade" e "Validar e aplicar". Texto: "Contratações e mudanças permanecem isoladas até você
validar e aplicar o cenário".

### 1.8 Produtividade ("Horas realizadas") — **a aba que origina esta feature**

- Filtros: **Ano** (2026/2025) e **mês de corte** ("Até Jan" … "Até Dez").
- Legenda fixa: "Referência: 161 HH/mês · Férias já consideradas na média anual".
- KPIs: **HH produtivas acumuladas** (19.468, "Horas extras excluídas"), **Média mensal da
  equipe** (155, "Por mês equivalente fechado"), **Taxa geral de improdutividade** (4%, "Média
  das taxas individuais válidas"), **Lançamentos pendentes** (0, "Não entram na taxa oficial").
- **Evolução mensal**: média de HH produtivas por mês contra a meta 161.
- **Como calculamos**: `(161 − média realizada) / 161`; "A meta é proporcional somente em
  admissões ou desligamentos no meio do mês. Férias não são descontadas novamente";
  `176 HH × 11 meses = 1.936 HH/ano`.
- Tabela "Resultado por colaborador" com o rodapé "Somente competências fechadas compõem a taxa
  oficial" e colunas **Colaborador · HH acumuladas · Média mensal · HE excluídas · Meses equiv. ·
  Improdutividade · Situação** (situação = "Fechado"). "Meses equiv." aparece com casas decimais
  (7,00), coerente com pró-rata de admissão/desligamento.
- Ação "+ Lançar HH" (entrada manual de horas).

### 1.9 Administração

Cadastro de **funções operacionais** (ativa/inativa), **controle de acesso** com três papéis
(Admin, Planejador, Leitor) e **rastreabilidade** com atividade recente — onde aparece o registro
"**Competência jul/2026 fechada por Erike Simas**".

---

## 2. O que existe hoje no APP (evidências)

### 2.1 Origem das horas — Ponto Mais já é integrado e automático

A feature 010 (`specs/010-integracao-pontomais/`) substituiu o upload manual de planilha pela
integração com o VR Ponto Mais e já está em `main` (migrations `20260814150000_add_pontomais_sync`
até `20260818010000_add_pontomais_data_revision`).

- `backend/src/lib/pontomais/job.js` — carga histórica em lotes de 31 dias desde a admissão mais
  antiga e sincronização diária às 03h (`DAILY_HOUR = 3`, `buildPontoMaisSyncWindow`), reprocessando
  a janela dos 31 dias encerrados no dia anterior.
- `backend/prisma/schema.prisma:376` — `PontoPeriodSummary` guarda por colaborador/snapshot:
  `workedMinutes` (normais), `he70Minutes`, `he100Minutes`, `nightMinutes`, `workedDates[]` e
  `monthly` (Json por `YYYY-MM`, com `days[]`, `normalMinutes`, `extrasMinutes`, etiquetas).
- `backend/src/lib/acompanhamento/labor-cost.js:331` — `mergePontoPeriods()` consolida os
  snapshots por colaborador, resolve sobreposição por data (o snapshot mais recente vence) e
  devolve o agregado mensal já separado entre normais e extras.
- `filterIgnoredPontoPeriods()` remove pessoas marcadas como ignoradas
  (`PontoExternalEmployee.ignoredAt`), e `PontoPeriodSummary.collaboratorId` é nulo enquanto o nome
  não for vinculado a um `Collaborator`.

**Conclusão**: as HH produtivas normais por colaborador e por mês **já existem**, sem novo
importador e sem lançamento manual.

### 2.2 Cálculo de custo/alocação já cruza ponto × RDO

`computeCollaboratorRates()` (`labor-cost.js:1326`) produz, por colaborador e por mês: horas
normais, HE70/HE100, custo, alocação por projeto (eixo contábil e analítico), horas de **sede** e
de **folga** (`countFolgaWeekdays`, `labor-cost.js:109` — dia útil sem ponto = folga). A
apropriação por projeto usa etiquetas do Ponto Mais, RDOs, agrupamentos de missão e overrides
manuais (`PontoDayProjectOverride`).

**Limitação relevante para esta feature**: esse resultado só é preenchido quando o cargo do
colaborador tem perfil de custo (`roleParams.hasProfile(role)`). Para o indicador de
improdutividade isso seria um filtro indevido — o cálculo precisa ler as horas de
`mergePontoPeriods()` diretamente, sem depender de perfil de custo nem da conciliação com RDO.

### 2.3 Cadastro de pessoas e funções

- `Collaborator` (`schema.prisma:259`): `code`, `name`, `role` (texto que casa com `JobRole.name`),
  `admissionDate`, `isActive`, vínculos com ponto (`PontoNameAlias`, `PontoExternalEmployeeLink`).
  **Não existe** data de desligamento, situação (férias/afastamento) nem período aquisitivo.
- `JobRole` (`schema.prisma:530`): `name`, `order`, `isActive`, perfil de custo. **Não existe**
  marcação de função operacional.
- Gestão pela UI: `frontend/src/components/projects/JobRoleManager.tsx` e
  `backend/src/routes/resources/job-roles.js`.

### 2.4 Missões (projetos) e alocação

- `Project` (`schema.prisma:556`): `code`, `name`, `clientName`, `location`, `mobilizationDate`,
  `startDate`, `offshore`, `laborCollaboratorIds`, arquivamento do Acompanhamento.
- Previsão de equipe por cargo já existe em **horas**, não em cabeças:
  `ProjectPlannedNormalHours` / `ProjectPlannedOvertime` (`schema.prisma:2041` e `:2060`), com
  `jobRoleId` e `hours`.
- Fim previsto é derivado (`avanco.js:235`: `expectedEndDate = startDate + plannedDays`); prazo de
  mobilização vem da proposta (`mobilizationLeadDays`, `access-import.js`).
- Alocação realizada por dia/colaborador/projeto já é montada em
  `backend/src/lib/allocation-monthly-report.js` (relatório mensal de alocação em PDF, a partir de
  RDOs aprovados/assinados) e em `rdoDataByCollaboratorFromReports()` (`labor-cost.js:514`).
- Agrupamento de missões: `AcompanhamentoMissionGroup` (`schema.prisma:653`).

**Não existe**: status de ciclo de vida da missão (stand by / mobilização / execução / medição
final / finalizado), data de retorno/desmobilização, necessidade de efetivo **por pessoa** por
função, nem vínculo planejado colaborador↔missão em período futuro. `laborCollaboratorIds` é uma
lista manual de colaboradores no cronograma do Acompanhamento, não uma alocação com período.

### 2.5 Ausências, férias, feriados, ASO/NR

Busca por `férias|feriado|afastamento|atestado|ASO|ASU|treinamento|NR-` em `backend/src`,
`frontend/src` e `shared` só retorna:

- `salary.js:14` — "ferias" como palavra-chave de **verba de folha** ignorada na leitura de custo;
- `settings.js:64` — custo anual de **exames e treinamentos** (parâmetro monetário);
- `overtime.js:60` — `isBrazilHoliday()` para classificar HE de feriado no RDO.

**Conclusão**: o APP **não tem** cadastro de férias, período aquisitivo, afastamento, folga
programada, ASO/ASU, treinamento/NR nem calendário de feriados operacional. Tudo que o protótipo
mostra nessas áreas seria criação nova.

> **Atualização (2026-08-20)**: ao responder D-1, o solicitante determinou que o **cadastro de
> férias entra na primeira entrega**. A feature passa a criar `CollaboratorAbsence` (tipo `FERIAS`
> exposto; folga, afastamento, ASO e treinamento reservados no enum) e o campo
> `Collaborator.terminationDate`. Os demais itens desta seção continuam inexistentes.

### 2.6 Módulos, permissão e UI

- Módulos são declarados em `shared/modules/registry.json` (fonte de verdade de id, papéis, card
  do hub, rotas e grupos de acesso), com `npm run modules:generate` e scaffold
  `npm run new:module` (`scripts/new-module.mjs`). Regras em `docs/PADRAO_MODULO.md`.
- Módulos atuais: RDO, ADMIN, EQUIPAMENTOS, ESTOQUE, QUALIDADE, ACOMPANHAMENTO, ROMANEIO, EPI,
  PRIVACY. Papéis no padrão `<modulo>:manager` / `<modulo>:viewer`.
- Padrão de tela análoga para esta feature: `frontend/src/pages/acompanhamento/AcompanhamentoPage.tsx`
  (navegação por `?section=`), `components/projects/SedeCostsBoard.tsx` (KPIs + tabela + filtros de
  período) e `utils/sedePeriods.ts` (mês/trimestre/semestre/ano/personalizado, da feature 004).
- Novidade e tutorial: `components/AcompanhamentoTutorial.tsx`, `AcompanhamentoHubNovelty.tsx`,
  `PontoMaisSyncNovelty.tsx` (campanha de 10 dias exigida pela constitution).

---

## 3. Ponto específico investigado: "competências fechadas"

O protótipo condiciona a Taxa Geral de Improdutividade a pessoas com **competências fechadas** e
mostra, na aba Administração, o evento "Competência jul/2026 fechada por Erike Simas". As cinco
perguntas foram investigadas no código:

| # | Pergunta | Resposta | Evidência |
|---|----------|----------|-----------|
| 1 | Existe conceito de competência mensal? | **Não como entidade.** O mês (`YYYY-MM`) é usado como chave de agregação em vários pontos (`PontoPeriodSummary.monthly`, `entry.months` do motor de custo, relatório mensal de alocação), mas não há registro de competência. | `schema.prisma:376`; `labor-cost.js:1420+`; `allocation-monthly-report.js` |
| 2 | Existe status aberto/fechado? | **Não.** Nenhum modelo tem `closedAt`, `lockedAt` ou equivalente. A única ocorrência da palavra "Competência" no código é rótulo de e-mail. | busca por `compet[êe]ncia\|fechamento\|closedAt\|lockedAt` em `backend/src` |
| 3 | O ponto é fechado/consolidado mensalmente? | **Não.** O ponto é sincronizado continuamente; não há ato de fechamento. | `pontomais/job.js` |
| 4 | Indicadores existentes consideram só competências fechadas? | **Não.** Custo, custo/hora e alocação usam todo o período disponível do ponto, inclusive o mês corrente parcial (há apenas proporcionalização do custo fixo pelo trecho coberto, `monthCoverage`). | `labor-cost.js:957` e `:1420+` |
| 5 | Existem alterações retroativas depois do "fechamento"? | **Sim, por construção.** A sincronização diária reprocessa os 31 dias encerrados no dia anterior, e uma correção do normalizador (`dataRevision`) faz o backend reler **todo** o histórico. | `pontomais/job.js` (`buildPontoMaisSyncWindow`, `CURRENT_DATA_REVISION`); `PontoSyncState` (`schema.prisma:443`) |

### Influência possível no indicador

1. **O mês corrente é sempre parcial.** Incluir o mês em curso derruba a média mensal e infla
   artificialmente a improdutividade de todo mundo. Isso vale mesmo sem conceito de competência: é
   consequência direta da fórmula `média = total ÷ meses`.
2. **Os últimos ~31 dias ainda mudam.** Um número publicado hoje para o mês passado pode mudar
   amanhã, porque a janela diária reprocessa correções de ponto lançadas com atraso. Um mês só
   estabiliza depois que a janela de 31 dias o ultrapassa (e ainda pode mudar em uma releitura por
   `dataRevision`).
3. **Existe um proxy natural de "competência fechada" sem criar entidade nova**: um mês é
   considerado consolidado quando `PontoSyncState.lastDailySyncDate` já ultrapassou o último dia
   do mês em mais de 31 dias. Isso dá o mesmo efeito prático do protótipo sem inventar um ritual de
   fechamento manual.
4. Se o negócio quiser o fechamento **explícito** (com autor, data e trilha, como no protótipo),
   isso é uma entidade nova (`competência` com status, `closedByUserId`, `closedAt`) e um fluxo de
   reabertura — escopo próprio, não obrigatório para a primeira entrega.

> **Não foi alterada a fórmula nem excluída nenhuma competência automaticamente.** A escolha entre
> (a) usar todos os meses com ponto, (b) excluir o mês corrente, (c) exigir mês estabilizado pela
> janela de 31 dias ou (d) criar fechamento manual está registrada como decisão de negócio pendente
> (D-2 no `spec.md`).

---

## 4. Riscos analíticos detectados na fórmula

Registrados aqui porque afetam a leitura do indicador, não a sua implementação:

- **Mês com férias entra com horas quase nulas.** A referência de 161 HH/mês já é anualizada
  (`176 × 11 ÷ 12`), ou seja, as férias já estão diluídas. Se um mês em que a pessoa esteve de
  férias entrar na média como um mês qualquer, ela é penalizada duas vezes. Como o APP não tem
  cadastro de férias (§2.5), hoje **não há como identificar esse mês** — só o padrão de horas
  sugere. **Decidido em 2026-08-20 (D-8)**: as férias continuam **sem descontar** o denominador —
  161 permanece como referência —, e o cadastro novo serve para **sinalizar** os meses afetados. A
  base equivalente (referência 176 com férias fora do denominador), que elimina a distorção em
  recortes parciais, foi analisada e não foi adotada.
- **Admissão e desligamento no meio do período.** O protótipo usa "meses equivalentes" com
  pró-rata. O APP tem `admissionDate`, mas **não tinha data de desligamento** — apenas
  `isActive = false`. Decisão D-3: o campo passa a existir e o pró-rata vale para os dois extremos.
- **Adicional noturno não é hora extra.** `nightMinutes` é adicional sobre horas já contadas em
  `workedMinutes`; não deve ser somado nem descontado das HH produtivas.
- **Pessoas sem vínculo no ponto** (`collaboratorId = null`) e pessoas ignoradas
  (`PontoExternalEmployee.ignoredAt`) precisam aparecer como pendência explícita, equivalente ao
  KPI "Lançamentos pendentes" do protótipo — caso contrário o indicador esconde gente.

---

## 5. Decisões técnicas tomadas nesta pesquisa

| Decisão | Escolha | Alternativa descartada |
|---------|---------|------------------------|
| Fonte das HH produtivas | `mergePontoPeriods()` sobre `PontoPeriodSummary` (normais, sem HE) | `computeCollaboratorRates()` — só devolve meses de quem tem perfil de custo, o que excluiria pessoas do indicador |
| Entrada manual de HH ("+ Lançar HH" do protótipo) | **Fora do escopo** — contraria a feature 010, que removeu o lançamento manual | Reintroduzir lançamento manual |
| Recorte do efetivo operacional | Novo `JobRole.isOperational` (migration + gestão no `JobRoleManager`) | Lista fixa de nomes de cargo no código |
| Onde a área nasce | Módulo próprio no `shared/modules/registry.json` | Nova aba dentro do Acompanhamento (ver justificativa no `plan.md`) |
