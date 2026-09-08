# Data Model: Efetivo Operacional — Planejamento Completo

## Visão geral

O planejamento operacional complementa os cadastros canônicos existentes. `Project`, `Collaborator`, `JobRole`, `User`, `CollaboratorAbsence` e o calendário corporativo permanecem fontes de verdade. Um mesmo grafo relacional representa o plano oficial e cada cenário, evitando patches JSON com regras diferentes. A ausência de legado do Efetivo permite criar diretamente o modelo final; dados já existentes nos cadastros compartilhados continuam sujeitos a migração segura.

```text
EfetivoPlan
├── EfetivoMissionPlan
│   ├── EfetivoMissionDemand
│   └── EfetivoMissionAllocation
└── EfetivoPlannedHire
```

## Enums

### EfetivoPlanKind

- `OFFICIAL`
- `SCENARIO`

### EfetivoPlanStatus

- `ACTIVE`: oficial vigente.
- `DRAFT`: cenário editável.
- `APPLIED`: cenário aplicado; terminal e idempotente.
- `DISCARDED`: cenário descartado; terminal.
- `SUPERSEDED`: oficial antigo ou cenário cuja base não é mais vigente; somente leitura.

### EfetivoMissionScheduleStatus

- `DRAFT`: visível no planejamento, sem consumir capacidade oficial.
- `CONFIRMED`: consome capacidade e participa de calendário/alertas.
- `CANCELLED`: histórico preservado, sem consumir capacidade.

### EfetivoMissionStage

- `STANDBY`
- `MOBILIZATION`
- `EXECUTION`
- `FINAL_MEASUREMENT`
- `FINISHED`

Transições podem avançar ou voltar por decisão do gestor; toda transição é auditada. `FINISHED` permanece em leitura e não apaga a equipe histórica.

### EfetivoAllocationSource

- `MANUAL`
- `AUTOMATIC`
- `SCENARIO_COPY`

## Alterações em entidades existentes

### Collaborator

Atributos centrais:

- `jobRoleId: String` — FK obrigatória e única fonte do cargo atual.
- `efetivoNote: String?` — observação operacional exibida no módulo.

Regras:

- Toda tela que altera o cargo atual grava apenas `jobRoleId` por um serviço cadastral compartilhado.
- Toda tela que exibe o cargo atual lê `jobRole.name`; `role` deixa de ser fallback e é removido após a migração.
- O diagnóstico pré-migração compara o texto atual com `JobRole.name`, aceita somente correspondência normalizada inequívoca e bloqueia o `NOT NULL` enquanto houver ausência/ambiguidade.
- Renomear/desativar um `JobRole` preserva snapshots históricos e invalida projeções/cache que exibem o cargo atual.

Alterar o cargo atual não é bloqueado por missão futura: a alteração incrementa a revisão e marca alocações incompatíveis como pendentes de replanejamento. `jobRoleId` usa `onDelete: Restrict`.

### EpiCollaboratorProfile

Perfil de exceção pertencente somente ao EPI:

- `collaboratorId: String` — PK/FK única para `Collaborator`;
- `roleOverrideJobRoleId: String?` — FK para cargo anterior, inclusive inativo;
- `updatedByUserId: String`;
- `createdAt` / `updatedAt`.

Limpar `roleOverrideJobRoleId` faz novas emissões voltarem ao cargo canônico imediatamente. Nenhum serviço externo ao EPI lê este perfil.

Na migração, valores produtivos de `epiRoleOverride` são resolvidos pela mesma chave normalizada. Ausência ou ambiguidade bloqueia a remoção do texto até decisão explícita; o processo não descarta override existente.

### EpiSignatureRequest / documento EPI

Novo atributo:

- `jobRoleIdSnapshot: String?`, `roleNameSnapshot: String` e `roleSourceSnapshot: CANONICAL | EPI_OVERRIDE` — cargo efetivo do EPI capturado ao criar a solicitação/documento.

Regras:

- Payload público, pré-visualização, assinatura e regeneração do artefato usam o snapshot da solicitação, não o colaborador ao vivo.
- Limpar ou alterar `roleOverrideJobRoleId` afeta apenas novas emissões.
- Artefatos já assinados permanecem imutáveis.

### Report / ReportCollaborator

Novos atributos aditivos nos modelos produtivos:

- `Report.efetivoMissionId: String?` e `efetivoPlanRevision: Int?` — rastreiam qual sugestão originou o prefill, sem obrigar RDOs existentes.
- `ReportCollaborator.jobRoleIdSnapshot: String?` e `jobRoleNameSnapshot: String?` — preservam o cargo exibido no relatório/PDF no momento do lançamento.

Regras:

- O RDO continua gravando a equipe efetivamente confirmada, mesmo que ela divirja da sugestão.
- RDOs existentes permanecem válidos com campos nulos; novos relatórios capturam snapshots.
- Alterações futuras em missão, cargo ou equipe não reescrevem relatórios já salvos.

### JobRole

Novos atributos:

- `normalizedKey: String` — chave única derivada de nome sem diferenças de caixa, espaços ou acentuação, usada pelo diagnóstico/migração.
- `calendarColor: String` — hexadecimal válido, com cor neutra inicial.
- `continuousWorkLimitDays: Int?` — inteiro de 1 a 365; `null` usa fallback empresarial 90/60/30.

Cargo desativado não pode ser atribuído como cargo canônico novo, mas permanece referenciável por snapshots e pelo override histórico do EPI. Exclusão física é restrita enquanto houver referência.

Durante a centralização inicial, cada nome textual legado não vazio sem correspondência gera um único `JobRole` provisório pela chave normalizada. Todos os colaboradores equivalentes são vinculados a esse registro; o gestor pode renomeá-lo depois. Nome vazio ou duplicidade canônica ambígua continua sendo erro bloqueante.

### CollaboratorAbsence

Sem duplicação por módulo. A superfície libera `FERIAS`, `FOLGA` e `AFASTAMENTO`; `ASO` e `TREINAMENTO` continuam reservados. Adicionar `version`, `updatedByUserId` e índice `(collaboratorId, deletedAt, startDate, endDate)` para concorrência e consultas de conflito. A ausência pode ser registrada sobre uma missão existente porque representa a disponibilidade real; nesse caso, a missão fica pendente/conflitante. O caminho inverso — confirmar/alocar sobre ausência já conhecida — é bloqueado.

### WorkforceCalendarState

Estado singleton compartilhado:

- `id: "global"`;
- `revision: Int` monotônico;
- `updatedAt`.

Alterações de ausência ou feriado manual incrementam esta revisão. Planos/cenários guardam `baseCalendarRevision`; caches incluem a revisão na chave e cenários com base anterior aparecem como obsoletos antes de aplicação.

## Novas entidades

### EfetivoPlan

Contexto comum para o plano oficial e simulações.

| Campo | Tipo/regra |
|---|---|
| `id` | identificador |
| `kind` | `EfetivoPlanKind` |
| `status` | `EfetivoPlanStatus` |
| `name` | obrigatório para cenário; nome estável para oficial |
| `objective` | texto opcional |
| `revision` | inteiro monotônico; inicia em 1 |
| `basePlanId` | FK opcional para o oficial copiado |
| `baseOfficialRevision` | revisão capturada ao criar cenário |
| `appliedPlanId` | FK opcional para o oficial criado na aplicação |
| `createdByUserId` / `appliedByUserId` | autoria |
| `appliedAt` / `discardedAt` / `supersededAt` | estados terminais |
| `createdAt` / `updatedAt` | timestamps |

Garantias:

- Apenas um plano `OFFICIAL/ACTIVE`; impor por índice parcial SQL na migração e por lock transacional.
- Só `SCENARIO/DRAFT` pode ser editado ou aplicado.
- Toda mutação no oficial incrementa `revision` na mesma transação.
- Aplicação de cenário já `APPLIED` retorna `appliedPlanId`, sem duplicar efeitos/auditoria.

### EfetivoMissionPlan

Programação operacional de um projeto dentro de um plano.

| Campo | Tipo/regra |
|---|---|
| `id` | identificador |
| `planId` | FK para `EfetivoPlan` |
| `projectId` | FK para `Project` |
| `scheduleStatus` | `EfetivoMissionScheduleStatus`, default `DRAFT` |
| `stage` | `EfetivoMissionStage`, default `STANDBY` |
| `headquartersResponsibleUserId` | FK obrigatória para `User` ativo no momento da atribuição |
| `headquartersResponsibleName` | texto obrigatório |
| `headquartersResponsibleRole` | texto obrigatório |
| `headquartersResponsibleCollaboratorId` | FK opcional para `Collaborator` |

O formulário seleciona o responsável entre contas ativas de coordenador. Nome e cargo são persistidos como snapshots; quando a conta possui `collaboratorId`, o vínculo e o cargo vêm desse colaborador. Sem vínculo na conta, o cargo pode ser informado livremente, mas a identidade responsável continua sendo o `User` selecionado.
| `mobilizationDate` | data civil obrigatória |
| `executionStartDate` | data civil obrigatória |
| `executionEndDate` | data civil obrigatória |
| `returnDate` | data civil obrigatória |
| `version` | concorrência otimista, inicia em 1 |
| `kanbanOrder` | inteiro não negativo por etapa |
| `createdByUserId` / `updatedByUserId` | autoria |
| `deletedAt` | exclusão lógica |
| `createdAt` / `updatedAt` | timestamps |

Validações:

- Restrição única `(planId, projectId)`.
- Projeto não excluído.
- `mobilizationDate ≤ executionStartDate ≤ executionEndDate ≤ returnDate`.
- `CONFIRMED` exige ao menos um colaborador selecionado.
- Mudança de datas/equipe revalida todos os colaboradores antes de persistir.

Índices: `(planId, scheduleStatus, mobilizationDate, returnDate)`, `(planId, stage, kanbanOrder)`, `(planId, deletedAt)`.

### EfetivoMissionDemand

| Campo | Tipo/regra |
|---|---|
| `missionId` | FK para programação |
| `jobRoleId` | FK para função operacional |
| `requiredCount` | inteiro positivo |
| `createdAt` / `updatedAt` | timestamps |

Restrição única `(missionId, jobRoleId)`. Demanda zero remove a linha.

No diálogo de programação, esta entidade é projeção persistida da equipe, não entrada manual: `requiredCount` é a contagem de alocações selecionadas agrupada pelo `jobRoleId` canônico vigente no momento do salvamento. Ela permanece armazenada para preservar as projeções de capacidade e a compatibilidade com cenários.

### EfetivoMissionAllocation

| Campo | Tipo/regra |
|---|---|
| `id` | identificador |
| `missionId` | FK para programação |
| `collaboratorId` | FK para colaborador |
| `jobRoleId` | função/vaga ocupada |
| `jobRoleNameSnapshot` | nome histórico da função |
| `source` | `EfetivoAllocationSource` |
| `createdByUserId` | autoria |
| `deletedAt` | exclusão lógica |
| `createdAt` / `updatedAt` | timestamps |

Restrições:

- Única por `(missionId, collaboratorId)`; restauração atualiza a linha excluída.
- Função precisa existir na demanda e não ultrapassar `requiredCount`, salvo atualização explícita conjunta.
- Colaborador ativo no intervalo, da função correta e sem missão confirmada/ausência sobreposta.
- A edição da programação faz `upsert` das pessoas selecionadas e exclusão lógica das removidas; essas alterações e a recriação da demanda derivada pertencem à mesma transação da missão.

Índices: `(collaboratorId, deletedAt)`, `(missionId, jobRoleId, deletedAt)`.

### EfetivoPlannedHire

Necessidade de contratação dentro de um plano; não cria colaborador fictício.

| Campo | Tipo/regra |
|---|---|
| `id` | identificador |
| `planId` | FK para plano |
| `jobRoleId` | FK para função |
| `quantity` | inteiro positivo |
| `availableFrom` | data civil |
| `createdAt` / `updatedAt` | timestamps |

Restrição única `(planId, jobRoleId, availableFrom)`. Em cenários entra na capacidade simulada; após aplicação permanece como necessidade planejada separada do KPI de colaboradores ativos.

### Holiday (compartilhado)

| Campo | Tipo/regra |
|---|---|
| `id` | identificador |
| `holidayDate` | data civil única |
| `name` | texto obrigatório |
| `source` | `SYSTEM` para calendário nacional gerado; `MANUAL` para complemento cadastrado |
| `scope` | `GLOBAL` nesta entrega; preparado para extensão futura sem alterar consumidores |
| `createdByUserId` / `updatedByUserId` | autoria |
| `deletedAt` | exclusão lógica |
| `createdAt` / `updatedAt` | timestamps |

Registros persistidos representam complementos manuais; feriados nacionais fixos e móveis já considerados pelo RDO são gerados deterministicamente pelo serviço de calendário. O resolvedor por intervalo une ambas as fontes e entrega o mesmo conjunto ao Efetivo, RDO e demais projeções. Recriar a mesma data manual restaura/atualiza o registro excluído.

### EfetivoSetting (extensão)

Adicionar a chave `plannedUtilizationTarget` com default `80`, validada entre 0 e 100. Mudanças incrementam a revisão oficial e são auditadas.

### EfetivoAuditEvent

| Campo | Tipo/regra |
|---|---|
| `id` | identificador |
| `planId` | FK opcional para plano |
| `actorUserId` | FK opcional para usuário |
| `action` | ação estável (`MISSION_CREATE`, `ALLOCATION_ADD`, etc.) |
| `entityType` | tipo do alvo |
| `entityId` | id do alvo |
| `summary` | descrição curta em pt-BR |
| `beforeData` / `afterData` | snapshots JSON opcionais e minimizados |
| `ipAddress` / `userAgent` | evidência opcional da requisição |
| `createdAt` | timestamp |

Índices: `(createdAt)`, `(entityType, entityId, createdAt)`, `(actorUserId, createdAt)`, `(planId, createdAt)`.

Dados sensíveis ou segredos nunca entram nos snapshots.

## Regras derivadas (sem persistência duplicada)

### Contexto de planejamento por projeto/data

Projeção compartilhada, sem nova tabela:

- entrada: `projectId` e data civil;
- missão oficial confirmada cujo intervalo inclusivo contém a data;
- datas planejadas, etapa planejada e revisão do plano;
- equipe planejada com `collaboratorId`, `jobRoleId` e `jobRoleNameSnapshot`;
- ausências sobrepostas relevantes;
- `null` explícito quando não existir missão confirmada aplicável.

O RDO usa essa projeção somente como sugestão inicial. Após confirmação, `ReportCollaborator` continua sendo o snapshot do realizado.

### Execução observada da missão

Read model calculado por `missionId` e intervalo, sem copiar dados:

- planejamento: quatro datas, etapa, equipe e revisão de `EfetivoMissionPlan`;
- projeto: datas operacionais existentes e progresso exposto pelo Acompanhamento;
- RDO: primeiro/último relatório e conjunto de `ReportCollaborator` efetivamente registrados;
- Ponto: pessoas/horas atribuídas ao projeto, sem alterar a fórmula de Produtividade;
- divergências: início/fim, pessoas planejadas sem evidência, pessoas não planejadas e trabalho durante ausência;
- `observedStageSuggestion`: sugestão derivada, nunca atualização automática da etapa planejada.

### Disponibilidade compartilhada

`CollaboratorAbsence` mantém uma única linha por fato e é consumida com políticas distintas:

- Efetivo: bloqueio transacional ao alocar/confirmar sobre ausência; ausência nova sobre missão existente é salva e cria pendência de replanejamento;
- RDO: aviso bloqueante até o usuário registrar justificativa, armazenada na auditoria do relatório;
- Ponto: indicador de inconsistência, preservando horas importadas;
- Acompanhamento: sinalização visual na equipe e no período.

Ausência criada ou alterada incrementa `WorkforceCalendarState.revision`, invalida as projeções relacionadas e torna cenários baseados em revisão anterior obsoletos.

### Situação na data

1. Fora do vínculo ativo: não compõe o efetivo.
2. Ausência ativa: `INDISPONIVEL`.
3. Alocação em missão confirmada: `ALOCADO`.
4. Caso contrário: `LIVRE`.

### Déficit por função

`max(0, demanda confirmada − alocações válidas)` para a data, agrupado por `jobRoleId`.

### Utilização de 90 dias

- Janela inclusiva `[data, data + 89 dias]`.
- Denominador: dias úteis do vínculo operacional, removendo feriados e ausências.
- Numerador: pares pessoa/dia distintos ocupados por missão confirmada.
- Resultado: `numerador ÷ denominador`; sem denominador retorna `null`.
- Contratações planejadas aparecem em projeção separada e nunca aumentam efetivo ativo.

### Permanência contínua

- Unir intervalos confirmados sobrepostos ou adjacentes por pessoa.
- Uma lacuna de ao menos um dia civil inteiro ou `FOLGA` explícita quebra a sequência.
- Contar dias corridos inclusivos; férias e afastamentos não viram dias de permanência.

### Aplicação de cenário

1. Bloquear cenário e plano oficial em uma única transação.
2. Se `APPLIED`, retornar `appliedPlanId` existente.
3. Confirmar `DRAFT` e comparar `baseOfficialRevision` com a revisão ativa.
4. Revalidar cronologia, demanda, vínculo, função, ausências e sobreposições do cenário materializado.
5. Clonar o cenário validado como novo `OFFICIAL/ACTIVE`, marcar o oficial anterior `SUPERSEDED` e o cenário `APPLIED`.
6. Gravar auditoria e vínculos de aplicação na mesma transação.
7. Se a base divergir, não alterar o oficial e marcar o cenário `SUPERSEDED`, retornando conflito 409.
