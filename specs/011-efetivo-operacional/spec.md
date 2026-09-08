# Feature Specification: Efetivo Operacional — Produtividade e Improdutividade Real

**Feature Branch**: `feat/efetivo-operacional`

**Created**: 2026-08-19

**Status**: Draft

**Input**: User description: "Criar a área de Efetivo Operacional. A primeira entrega é o
indicador de Improdutividade Real: referência mensal de 161 HH produtivas; média mensal = total de
HH produtivas válidas ÷ meses analisados; improdutividade individual = max(0, (161 − média) ÷ 161);
improdutividade geral = média simples das taxas individuais. Horas extras não entram e as férias já
estão embutidas na referência anualizada. Um protótipo funcional
(https://efetivo-operacional.erikesimas.chatgpt.site/) demonstra a direção futura do módulo — usar
apenas como referência de funcionalidades e conceitos, nunca de layout ou arquitetura de frontend."

## Contexto

O APP já sincroniza automaticamente a jornada do VR Ponto Mais (feature 010) e usa essas horas para
custo de mão de obra e alocação por missão dentro do módulo Acompanhamento. O que não existe é a
leitura **de gente**: quanto do tempo contratado de cada colaborador operacional virou hora
produtiva, e qual o tamanho da ociosidade do efetivo.

O solicitante forneceu um protótipo funcional que desenha uma área maior — Visão geral, Calendário,
Colaboradores, Missões, Evolução das missões, Simulações, Produtividade e Administração. A
confrontação completa entre o protótipo e o APP está em `research.md` e a classificação de escopo
está na seção **Protótipo x APP atual** do `plan.md`.

**Esta spec cobre apenas a primeira entrega**: a área nasce como módulo próprio, com duas seções —
**Produtividade** (o indicador) e **Férias e ausências** (o cadastro que o indicador e todas as
seções futuras precisam) — e a arquitetura preparada para as demais.

### Dois indicadores que não podem ser confundidos

1. **Improdutividade Real** (esta entrega): olha para o **passado realizado**. Base = HH produtivas
   normais já registradas no ponto, contra a referência de 161 HH/mês.
2. **Disponibilidade / Utilização / Taxa de Alocação** (fora desta entrega): olha para o
   **futuro planejado** — dias úteis, missões, férias, folgas, ASO/ASU, NR, feriados, mobilizações.
   A fórmula definitiva ainda não está definida e **não deve ser presumida**. Nenhuma lógica de
   utilização planejada pode substituir ou alterar a Improdutividade Real.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver a Taxa Geral de Improdutividade e o resultado por colaborador (Priority: P1)

Como gestor, quero abrir a área de Efetivo Operacional e ver a Taxa Geral de Improdutividade do
efetivo operacional e a taxa individual de cada colaborador no período, para saber quanto da
capacidade contratada não virou hora produtiva.

**Why this priority**: é a razão de existir da entrega; sem ela não há indicador nenhum.

**Independent Test**: com o ponto já sincronizado, abrir a seção Produtividade e conferir que a
taxa geral corresponde à média simples das taxas individuais listadas na tabela, e que cada taxa
individual reproduz `max(0, (161 − média mensal) ÷ 161)` a partir das HH exibidas.

**Acceptance Scenarios**:

1. **Given** colaboradores operacionais com ponto sincronizado no período, **When** o gestor abre a
   seção Produtividade, **Then** vê HH produtivas acumuladas, média mensal da equipe, Taxa Geral de
   Improdutividade e a tabela por colaborador.
2. **Given** um colaborador com média mensal de 154 HH, **When** a taxa individual é calculada,
   **Then** ela é `(161 − 154) ÷ 161 = 4,3%`.
3. **Given** um colaborador com média mensal de 168 HH, **When** a taxa individual é calculada,
   **Then** ela é `0%` (piso), e não um valor negativo.
4. **Given** que existem HH extras (HE70/HE100) no período, **When** as HH produtivas são somadas,
   **Then** as extras ficam de fora do numerador e aparecem apenas como informação separada.
5. **Given** taxas individuais de 4%, 2% e 6%, **When** a taxa geral é calculada, **Then** ela é a
   média simples (4%), e não a taxa recalculada sobre a soma das horas.

---

### User Story 2 - Escolher o período analisado (Priority: P1)

Como gestor, quero escolher o ano e o mês de corte da análise para comparar o acumulado do ano com
períodos anteriores.

**Why this priority**: sem recorte de período o indicador não é comparável nem auditável; o
protótipo já nasce com ano e mês de corte, e o APP já tem o padrão de filtros de período da
feature 004.

**Independent Test**: alternar o ano e o mês de corte e confirmar que HH acumuladas, meses
analisados, médias e taxas mudam de forma coerente, e que o filtro sobrevive ao refresh da página.

**Acceptance Scenarios**:

1. **Given** a seção Produtividade aberta, **When** o gestor troca o ano, **Then** todos os
   indicadores passam a considerar apenas os meses daquele ano.
2. **Given** um ano selecionado, **When** o gestor define o mês de corte, **Then** apenas os meses
   até o corte entram no cálculo.
3. **Given** um filtro aplicado, **When** a página é recarregada, **Then** o mesmo período continua
   selecionado (estado em query params).

---

### User Story 3 - Saber quem entra e quem não entra no indicador (Priority: P1)

Como gestor, quero ver explicitamente quem foi considerado no indicador e quem ficou de fora e por
quê, para confiar no número antes de cobrar alguém.

**Why this priority**: um indicador de pessoas que esconde gente perde legitimidade. O protótipo
expõe isso como "Lançamentos pendentes · Não entram na taxa oficial".

**Independent Test**: com pelo menos um registro de ponto sem vínculo com colaborador e um cargo
não marcado como operacional, conferir que ambos aparecem como pendência/exclusão identificada e
que nenhum deles altera a taxa oficial.

**Acceptance Scenarios**:

1. **Given** registros de ponto sem vínculo com `Collaborator`, **When** o indicador é calculado,
   **Then** eles não entram na taxa e aparecem contados como pendência de vínculo, com caminho para
   a tela onde o vínculo é resolvido.
2. **Given** um colaborador cujo cargo não é operacional, **When** o indicador é calculado,
   **Then** ele não entra na taxa geral.
3. **Given** um colaborador operacional sem nenhum mês com ponto no período, **When** o indicador é
   calculado, **Then** ele não entra na média geral e aparece listado como "sem dados no período".
4. **Given** pessoas marcadas como ignoradas no diretório do Ponto Mais, **When** o indicador é
   calculado, **Then** elas continuam fora, como já ocorre no custo.

---

### User Story 4 - Marcar quais funções são operacionais (Priority: P2)

Como gestor, quero marcar quais cargos compõem o efetivo operacional para que o indicador não
misture administrativo com campo.

**Why this priority**: define o denominador do indicador; hoje o APP não tem essa classificação.
É pequeno e habilita a US1 corretamente, mas pode ir junto com um default seguro.

**Independent Test**: desmarcar um cargo como operacional e conferir que as pessoas daquele cargo
saem da taxa geral, sem apagar dado nenhum.

**Acceptance Scenarios**:

1. **Given** a tela de cargos, **When** o gestor marca/desmarca "função operacional", **Then** a
   mudança passa a valer no indicador na próxima consulta.
2. **Given** um cargo sem classificação explícita, **When** o indicador é calculado, **Then** vale
   o padrão definido na migration, sem quebrar o cálculo.
3. **Given** um usuário que administra cargos mas não tem `efetivo:manager`, **When** abre a tela de
   cargos, **Then** vê a marcação de função operacional em leitura e a API recusa a alteração.

---

### User Story 5 - Cadastrar férias e ausências (Priority: P2)

Como gestor, quero cadastrar os períodos de férias de cada colaborador para que o APP passe a saber
quando alguém esteve afastado e a leitura da produtividade deixe de ser cega a isso.

**Why this priority**: hoje o APP não sabe nada sobre férias, e essa cegueira é a maior fragilidade
do indicador. O cadastro não altera a taxa oficial (ver D-8), mas permite sinalizar os meses
afetados e é o pré-requisito de todas as seções futuras do módulo (Calendário, Colaboradores,
Disponibilidade).

**Independent Test**: cadastrar um período de férias para um colaborador, conferir que ele aparece
na listagem, que o período é sinalizado na tela de Produtividade e que a taxa oficial dele NÃO muda
por causa do cadastro.

**Acceptance Scenarios**:

1. **Given** a seção de férias e ausências, **When** o gestor cadastra um período com colaborador,
   data de início e data de fim, **Then** o período fica registrado e listado.
2. **Given** um período cadastrado, **When** o gestor edita ou remove, **Then** a mudança é
   registrada com autor e data, sem apagar a trilha.
3. **Given** um período com data de fim anterior à de início ou sobreposto a outro período do mesmo
   colaborador, **When** o gestor tenta salvar, **Then** o sistema recusa com mensagem no padrão
   visual de campo inválido.
4. **Given** um colaborador com férias dentro do período analisado, **When** o gestor abre a
   Produtividade, **Then** os meses afetados aparecem sinalizados e a taxa oficial dele continua
   calculada sem descontar as férias do denominador.

---

### User Story 6 - Abrir o detalhe mensal de um colaborador (Priority: P3)

Como gestor, quero abrir um colaborador e ver o mês a mês de HH produtivas contra a referência de
161, para entender de onde vem a taxa dele antes de conversar com a pessoa.

**Why this priority**: agrega explicabilidade, mas o indicador já entrega valor sem o detalhe.

**Independent Test**: abrir o detalhe de um colaborador e conferir que a soma dos meses exibidos
bate com as HH acumuladas dele na tabela.

**Acceptance Scenarios**:

1. **Given** a tabela por colaborador, **When** o gestor abre um colaborador, **Then** vê o mês a
   mês com HH normais, HE excluídas e a distância para 161.
2. **Given** o detalhe aberto, **When** a página é recarregada, **Then** o mesmo colaborador
   continua aberto (query param).

---

### Edge Cases

- **Mês corrente parcial**: o mês em curso tem poucos dias de ponto e derruba a média de todo mundo
  (ver decisão D-2).
- **Mês com férias**: por decisão D-8 as férias NÃO são descontadas do denominador (161 já é
  referência anualizada). Em recorte parcial do ano isso penaliza quem tirou férias dentro da
  janela; o mês precisa aparecer sinalizado na tela.
- **Férias cobrindo o mês inteiro**: o mês conta como mês analisado com horas próximas de zero — é
  o caso extremo da distorção acima e o que mais exige a sinalização.
- **Admissão no meio do período**: meses anteriores à admissão não podem contar como meses
  analisados.
- **Desligamento**: o colaborador entra pelos meses em que esteve ativo, com pró-rata no mês do
  desligamento (decisão D-3); depende do campo novo de data de desligamento.
- **Colaborador com média acima de 161**: taxa individual é 0%, nunca negativa.
- **Nenhum colaborador operacional elegível no período**: a taxa geral é exibida como indisponível,
  não como 0%.
- **Correção retroativa do Ponto Mais**: o número de um mês pode mudar depois de publicado; a tela
  precisa informar a data da última sincronização.
- **Cargo do colaborador sem `JobRole` correspondente**: o colaborador não pode sumir silenciosamente
  — vira pendência identificada.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A área **Efetivo Operacional** DEVE existir como área própria do APP, com controle de
  acesso por papéis de módulo, e a primeira entrega DEVE conter as seções **Produtividade** e
  **Férias e ausências**.
- **FR-002**: O sistema DEVE calcular **HH produtivas** a partir das **horas normais** já
  sincronizadas do Ponto Mais, por colaborador e por mês.
- **FR-003**: Horas extras (HE70, HE100 e extras genéricas) NÃO DEVEM entrar nas HH produtivas;
  DEVEM ser exibidas separadamente como "HE excluídas".
- **FR-004**: O adicional noturno NÃO DEVE ser somado nem subtraído das HH produtivas (é adicional
  sobre horas já contadas).
- **FR-005**: O sistema DEVE calcular a **média mensal** de cada colaborador como
  `total de HH produtivas válidas ÷ meses analisados`.
- **FR-006**: O sistema DEVE calcular a **improdutividade individual** como
  `max(0, (161 − média mensal) ÷ 161)`.
- **FR-007**: O sistema DEVE calcular a **improdutividade geral** como **média simples** das taxas
  individuais válidas — nunca ponderada por horas ou por pessoas-mês.
- **FR-008**: A referência de 161 HH/mês DEVE ser exibida na tela junto da explicação de que as
  férias já estão embutidas (`176 HH × 11 meses ÷ 12`) e de que HE não entram.
- **FR-009**: A referência de 161 DEVE ser um parâmetro persistido do módulo (`EfetivoSetting`),
  com 161 como valor vigente, e não um literal espalhado pelo código. O gestor DEVE poder alterar o
  valor pela própria tela, sob o papel `efetivo:manager`, com autor e data registrados; a alteração
  DEVE valer na consulta seguinte do indicador.
- **FR-010**: O indicador DEVE considerar apenas colaboradores de **funções operacionais** que
  estiveram **ativos dentro do período analisado** — os ativos hoje e os desligados cujos meses
  ativos caem na janela (FR-023) —, e o sistema DEVE permitir marcar quais `JobRole` são
  operacionais. A marcação vive na tela de cargos existente, mas alterá-la exige o papel
  `efetivo:manager` — quem administra cargos sem esse papel continua gerenciando o cargo e vê a
  marcação apenas em leitura.
- **FR-011**: O sistema DEVE permitir filtrar por **ano** e por **mês de corte**, refletindo o
  filtro em query params.
- **FR-012**: A tela DEVE exibir, no mínimo: HH produtivas acumuladas, média mensal da equipe,
  Taxa Geral de Improdutividade, quantidade de pendências, evolução mensal contra a referência e
  a tabela por colaborador com HH acumuladas, média mensal, HE excluídas, meses analisados e
  improdutividade.
- **FR-013**: O sistema DEVE identificar e contar como **pendência** (fora da taxa oficial): ponto
  sem vínculo com colaborador, colaborador operacional sem meses analisados e colaborador com cargo
  sem `JobRole` correspondente.
- **FR-014**: A tela DEVE exibir a data da última sincronização do ponto e o alcance do período com
  dados, para que o gestor saiba a validade do número.
- **FR-015**: O acesso à seção Produtividade DEVE ser restrito a papéis de gestão do módulo; o
  papel de visualização DEVE ver os mesmos números sem ações de configuração.
- **FR-016**: O cálculo NÃO DEVE depender de perfil de custo do cargo nem da conciliação
  ponto × RDO — apenas das horas normais do ponto.
- **FR-017**: Nenhuma entrada manual de HH DEVE ser criada (o lançamento manual foi removido pela
  feature 010).
- **FR-018**: O módulo DEVE nascer com tutorial permanente de primeiro acesso e campanha de
  novidade temporária de 10 dias, conforme a constitution.
- **FR-019**: Os **meses analisados** de um colaborador DEVEM ser os meses do período em que ele
  esteve ativo, com pró-rata proporcional apenas no mês de admissão e no mês de desligamento.
- **FR-020**: As férias NÃO DEVEM ser descontadas dos meses analisados (a referência de 161 já é
  anualizada); os meses com férias DEVEM ser sinalizados na tela.
- **FR-021**: O **mês corrente NÃO DEVE entrar** no cálculo; meses ainda dentro da janela de
  reprocessamento de 31 dias do Ponto Mais DEVEM ser exibidos com aviso de que ainda podem mudar.
- **FR-022**: O sistema DEVE permitir cadastrar, editar e remover **períodos de férias** por
  colaborador (início, fim, observação), com autor e data registrados, recusando período invertido
  ou sobreposto ao mesmo colaborador.
- **FR-023**: O cadastro de colaboradores DEVE ganhar **data de desligamento**, usada para delimitar
  os meses analisados; desligados DEVEM continuar aparecendo pelos meses em que estiveram ativos.
- **FR-024**: Todos os `JobRole` DEVEM nascer como função operacional (`isOperational = true`),
  cabendo ao gestor desmarcar os administrativos.

### Key Entities

- **Colaborador operacional**: `Collaborator` cujo `role` casa com um `JobRole` marcado como
  operacional e que esteve ativo em pelo menos um mês do período analisado — inclui desligados nos
  meses em que estiveram ativos (FR-023). Chave para HH: vínculo já existente com os registros do
  Ponto Mais.
- **Função operacional**: `JobRole` com a nova marcação `isOperational`.
- **Mês analisado**: chave `YYYY-MM` com HH produtivas do colaborador; define o denominador da
  média (regra exata em D-1/D-2).
- **Parâmetro do módulo**: referência mensal de HH produtivas (161) e demais constantes do
  indicador.
- **Ausência do colaborador**: período com tipo (nesta entrega apenas **férias**), início, fim,
  observação e autoria. Entidade desenhada para receber folga, afastamento, ASO/ASU e
  treinamento/NR no futuro, sem nova migration estrutural.
- **Data de desligamento**: novo campo do colaborador, usado para fechar os meses analisados.
- **Pendência**: registro de ponto ou colaborador que não pôde entrar no indicador, com motivo.

## Success Criteria *(mandatory)*

- **SC-001**: O gestor obtém a Taxa Geral de Improdutividade do efetivo operacional em uma tela, com
  no máximo dois filtros, sem exportar nada nem abrir planilha.
- **SC-002**: A taxa geral exibida é reproduzível à mão a partir da tabela por colaborador exibida
  na mesma tela (média simples das taxas individuais).
- **SC-003**: Nenhum colaborador operacional ativo com ponto no período fica invisível: ele aparece
  na tabela ou na lista de pendências, sempre com motivo.
- **SC-004**: Trocar o período e recarregar a página preserva o recorte analisado.
- **SC-005**: A tela funciona em celular sem scroll horizontal de página (tabela vira cards).
- **SC-006**: Nenhum número do indicador depende de o cargo ter perfil de custo configurado.
- **SC-007**: Cadastrar férias de um colaborador não altera a taxa oficial dele — apenas sinaliza
  os meses afetados.

## Assumptions

- As HH produtivas são as horas **normais** do Ponto Mais, que já é a verdade do tempo no APP.
- O efetivo operacional é definido por função/cargo, não por pessoa.
- A primeira entrega é de leitura no indicador; o único dado operacional novo cadastrado é o
  período de férias, além da marcação de função operacional, da data de desligamento e do
  parâmetro de referência.

## Decisões de negócio tomadas

*Respondidas pelo solicitante em 2026-08-20. Elas fixam quais meses e quais pessoas entram na conta;
a fórmula em si continua a dos FR-005 a FR-007.*

- **D-1 — "Meses analisados" = meses em que o colaborador esteve ativo**, com pró-rata apenas nos
  meses de admissão e de desligamento (opção b). **E o APP passa a ter cadastro de férias** — ver
  US5, FR-022 e D-8.
- **D-2 — O mês corrente não entra** no cálculo (opção b). Meses ainda dentro da janela de 31 dias
  do Ponto Mais entram, mas com aviso de que podem mudar.
- **D-3 — Desligados entram pelos meses em que estiveram ativos**, e o cadastro de colaboradores
  ganha **data de desligamento** (FR-023).
- **D-4 — Todos os cargos nascem operacionais** (`isOperational = true`); o gestor desmarca
  manualmente os administrativos depois (FR-024).
- **D-5 — Os prazos de folga por permanência contínua em obra são regra da empresa**: 90 dias para
  apoio, operadores e encarregados; 60 dias para supervisores; 30 dias para coordenadores e
  engenheiros. Registrado aqui como regra confirmada; o alerta só pode ser construído quando
  existir alocação por pessoa em missão (fora desta entrega).
- **D-8 — Férias não descontam do denominador.** A referência continua 161 HH/mês, que já é
  anualizada; férias não são descontadas de novo. Consequência aceita: em recorte parcial do ano,
  quem tirou férias dentro da janela aparece mais improdutivo que quem tirou fora dela — por isso
  os meses com férias precisam ficar sinalizados na tela (FR-020).

## Decisões ainda pendentes

*Nenhuma bloqueia a primeira entrega.*

- **D-6 — Fórmula da Taxa de Alocação/Utilização.** Explicitamente **não presumida**. Só será
  especificada quando existirem missões com período, ausências e disponibilidade cadastradas.
- **D-7 — Meta de improdutividade.** Sem meta definida, a tela exibe o número sem semáforo de
  bom/ruim.
- **D-9 — Período aquisitivo e alerta de férias vencidas.** O protótipo mostra "férias vencidas",
  "período aquisitivo até" e "programar até". Depende de regra CLT própria (12 meses aquisitivos +
  12 concessivos) e do histórico de férias que só passará a existir com o cadastro desta entrega.
  Fora do escopo agora.
