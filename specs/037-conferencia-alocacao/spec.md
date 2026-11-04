# Feature Specification: Conferência semanal de alocação

**Feature Branch**: `feat/037-conferencia-alocacao`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Conferência semanal de alocação (módulo Efetivo). Nova tela onde o responsável pela alocação do efetivo confere e corrige, uma vez por semana, onde cada colaborador esteve em cada dia (projeto + CNPJ do cliente, Sede, Folga, Viagem para projeto, Férias, Afastamento, Treinamento). Substitui a planilha Google preenchida manualmente para o DP. O app continua calculando a alocação automaticamente; a tela é só uma camada de verificação humana que confirma ou corrige a alocação automática. Semana não conferida: a alocação automática continua valendo."

**Prévia visual aprovada**: https://claude.ai/artifact/5rbgqhJRqoDMyoyoUQq3ve

## Contexto

Hoje um colaborador da Sede preenche, uma vez por semana, uma planilha Google com uma linha
por dia e duas colunas (Projeto e CNPJ) por colaborador. O DP usa essa planilha. O app já
calcula a alocação diária cruzando ponto (Ponto Mais), RDOs e planejamento do Efetivo, mas
ponto mal marcado ou planejamento desatualizado geram erros que ninguém revisa.

Esta feature acrescenta **verificação humana** por cima do cálculo automático. Ela não
substitui o cálculo: dia conferido vale pela conferência; dia não conferido continua valendo
pela alocação automática, exatamente como hoje.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver a semana já preenchida pelo app e entender o que não bate (Priority: P1)

O responsável pela alocação abre a semana e vê, para cada colaborador e cada dia (segunda a
domingo), onde o app acredita que ele esteve, com o CNPJ do cliente. Os dias em que as fontes
discordam ou em que não há informação ficam destacados, para ele saber onde olhar primeiro.

**Why this priority**: É o que substitui o preenchimento da planilha do zero. Mesmo sem
nenhuma edição, ele já ganha a visão consolidada e a lista de pendências.

**Independent Test**: Abrir uma semana com dados reais de ponto, RDO e planejamento e conferir
que cada célula mostra a sugestão correta, o CNPJ do projeto e os indicadores das três fontes;
que os filtros "Com pendência" e "Não conferidos" e a busca funcionam; e que nada é gravado.

**Acceptance Scenarios**:

1. **Given** um colaborador com ponto etiquetado "5620", RDO aprovado do projeto 5620 e
   planejamento no 5620, **When** a semana é aberta, **Then** o dia mostra "5620 ·
   Thyssenkrupp" com o CNPJ do cliente e os três indicadores como "confirma".
2. **Given** um dia em que o ponto tem etiqueta "5484" e o RDO é do projeto 5620,
   **When** a semana é aberta, **Then** o dia sugere 5620 (o RDO prevalece) e aparece como
   divergência, com o indicador do ponto como "diverge".
3. **Given** um dia útil sem ponto, sem RDO e sem ausência cadastrada, **When** a semana é
   aberta, **Then** o dia aparece como "Sem informação" e conta como pendência.
4. **Given** um dia com ponto batido sem etiqueta de projeto, sem RDO e sem planejamento em
   projeto, **When** a semana é aberta, **Then** o dia sugere "Sede", sem CNPJ.
5. **Given** um sábado ou domingo sem ponto, **When** a semana é aberta, **Then** o dia sugere
   "Folga" e não conta como pendência.
6. **Given** o usuário clica num dia, **When** o painel abre, **Then** ele vê o que cada fonte
   disse: horas normais, horas extras e etiquetas do ponto; número e projeto do RDO; e
   alocação planejada no Efetivo, além de ausência cadastrada quando houver.

---

### User Story 2 - Corrigir dias e conferir a semana de cada colaborador (Priority: P1)

O responsável escolhe onde o colaborador realmente esteve nos dias errados, resolve as
pendências e marca cada linha como conferida. Com todos conferidos, ele fecha a semana.

**Why this priority**: É a função principal da tela e o que torna a alocação confiável para o
DP e para o custo.

**Independent Test**: Numa semana com divergências, corrigir dias pelo painel e pela edição em
massa, conferir as linhas, fechar a semana e verificar que tudo persiste após recarregar e que
a semana fechada não aceita edição.

**Acceptance Scenarios**:

1. **Given** um dia com divergência, **When** o usuário escolhe uma das opções do painel e
   salva, **Then** o dia deixa de ser pendência e fica marcado como ajustado quando a escolha
   for diferente da sugestão do app.
2. **Given** o painel aberto num dia, **When** o usuário escolhe uma opção e marca "repetir"
   em dias seguintes da mesma semana, **Then** a mesma escolha é gravada em todos os dias
   marcados.
3. **Given** vários dias selecionados (Shift + clique no desktop ou modo de seleção no
   celular), **When** o usuário escolhe Sede, Folga, Férias ou um projeto na barra de ações,
   **Then** todos os dias selecionados recebem a escolha.
4. **Given** uma linha com pendência, **When** o usuário tenta conferi-la, **Then** a ação
   fica indisponível e mostra quantas pendências faltam.
5. **Given** linhas sem pendência, **When** o usuário aciona "Conferir linhas sem
   pendência", **Then** todas elas ficam conferidas de uma vez, aceitando as sugestões do app.
6. **Given** todos os colaboradores da semana conferidos e a semana já encerrada,
   **When** o usuário fecha a semana, **Then** ela fica travada: nenhum dia pode ser editado e
   nenhuma linha desconferida.
7. **Given** uma semana fechada, **When** um administrador a reabre, **Then** ela volta a
   aceitar edição, mantendo as conferências feitas, e a reabertura fica registrada com autor
   e data.
8. **Given** uma linha conferida e a semana ainda aberta, **When** o usuário desfaz a
   conferência, **Then** a linha volta a ser editável.

---

### User Story 3 - Conferência vale no relatório do DP e no custo dos projetos (Priority: P1)

O que foi conferido passa a valer no relatório Alocação dos colaboradores (Relatórios ›
Estatística) e no custo de mão de obra (HH) dos projetos. Nos dias não conferidos, nada muda.

**Why this priority**: Sem isso a conferência não tem efeito prático. O DP deixa de depender
da planilha porque o relatório existente passa a refletir a verdade conferida.

**Independent Test**: Conferir um dia trocando o projeto de A para B e outro dia trocando
projeto por Sede; abrir o relatório do mês e o custo dos dois projetos e verificar as mudanças;
verificar que um dia não conferido do mesmo mês continua aparecendo como antes.

**Acceptance Scenarios**:

1. **Given** um dia conferido no projeto B em que o RDO aprovado era do projeto A,
   **When** o relatório do mês é gerado, **Then** o colaborador aparece nesse dia no projeto B,
   com o CNPJ do cliente de B, e não aparece no A.
2. **Given** um dia conferido como Sede, Folga, Férias, Afastamento ou Treinamento,
   **When** o relatório do mês é gerado, **Then** o dia aparece com essa situação e sem CNPJ.
3. **Given** um dia conferido como "Viagem para o projeto C", **When** o relatório é gerado,
   **Then** o dia aparece como viagem para C, com o CNPJ do cliente de C, e as horas desse dia
   entram no custo do projeto C.
4. **Given** um dia conferido em projeto diferente do calculado automaticamente,
   **When** o custo HH é recalculado, **Then** as horas do dia saem do projeto antigo e entram
   no conferido.
5. **Given** um dia conferido como Sede, Folga, Férias, Afastamento ou Treinamento em que o
   cálculo automático apontava um projeto, **When** o custo HH é recalculado, **Then** as horas
   do dia deixam de ser apropriadas a qualquer projeto.
6. **Given** um dia não conferido, **When** o relatório e o custo são gerados, **Then** o
   resultado é idêntico ao comportamento atual.

---

### User Story 4 - Envio do relatório mensal espera a conferência (Priority: P2)

O envio automático do relatório mensal de alocação por e-mail, que hoje sai no dia 1º, passa a
esperar a conferência do mês terminar, até o 3º dia útil do mês seguinte.

**Why this priority**: Evita que o DP receba um relatório com a última semana ainda sem
conferência. Depende das histórias anteriores.

**Independent Test**: Simular as datas de um mês cujo dia 1 do mês seguinte é sexta-feira:
com uma semana aberta, o envio não acontece na sexta nem na segunda e acontece na terça (dia 5);
num segundo cenário, fechar todas as semanas na segunda faz o envio acontecer na segunda.

**Acceptance Scenarios**:

1. **Given** todas as semanas que têm dias no mês já fechadas, **When** o job de envio roda a
   partir do dia 1º do mês seguinte, **Then** o relatório é enviado.
2. **Given** alguma semana com dias no mês ainda aberta, **When** o job roda antes do 3º dia
   útil do mês seguinte, **Then** o envio é adiado.
3. **Given** chegou o 3º dia útil do mês seguinte e ainda há semana aberta, **When** o job
   roda, **Then** o relatório é enviado com o que houver: conferência nos dias conferidos e
   alocação automática nos demais.
4. **Given** o dia 1º cai numa sexta-feira sem feriado na segunda e na terça, **When** o 3º dia
   útil é calculado, **Then** o resultado é a terça-feira, dia 5.
5. **Given** um feriado cadastrado no calendário do Efetivo entre o dia 1º e o 3º dia útil,
   **When** o limite é calculado, **Then** o feriado não conta como dia útil.
6. **Given** o envio manual ("enviar agora") existente, **When** o gestor o aciona,
   **Then** ele continua funcionando sem esperar a conferência.

---

### User Story 5 - Aviso ao Efetivo para cadastrar ausência (Priority: P2)

Quando o responsável marca Folga, Férias ou Afastamento num dia em que o colaborador não tem
ausência cadastrada, os administradores do módulo Efetivo são avisados para fazer o cadastro.

**Why this priority**: Mantém o cadastro de ausências coerente com a realidade, o que melhora
a sugestão automática nas semanas seguintes. Não bloqueia a conferência.

**Independent Test**: Marcar Férias em três dias de um colaborador sem férias cadastradas,
conferir a linha, verificar que os administradores do Efetivo recebem um aviso com o
colaborador e o período; cadastrar as férias e verificar que o aviso some.

**Acceptance Scenarios**:

1. **Given** o usuário escolhe Folga, Férias ou Afastamento num dia sem ausência cadastrada,
   **When** o painel mostra a escolha, **Then** ele informa que os administradores do Efetivo
   serão avisados quando a linha for conferida.
2. **Given** a linha é conferida, **When** há dias marcados assim, **Then** um aviso é criado
   para os administradores do Efetivo com colaborador, tipo e período (dias consecutivos do
   mesmo tipo viram um único período).
3. **Given** um aviso aberto, **When** a ausência correspondente é cadastrada cobrindo esses
   dias, **Then** o aviso é encerrado automaticamente.
4. **Given** a conferência é desfeita ou o dia é alterado para outra situação antes de a
   ausência ser cadastrada, **When** isso acontece, **Then** o aviso correspondente é
   cancelado.
5. **Given** a escolha foi Folga num sábado ou domingo que o app já sugeria como Folga,
   **When** a linha é conferida, **Then** nenhum aviso é gerado.

---

### Edge Cases

- **Semana em andamento**: a semana corrente pode ser aberta e editada, mas dias futuros não
  podem ser conferidos e a semana só pode ser fechada depois do domingo.
- **Semana que atravessa dois meses** (ex.: 26/10 a 01/11): conta para o envio dos dois meses.
- **Fonte muda depois da conferência** (RDO aprovado depois, ponto reimportado, planejamento
  alterado): a conferência prevalece. O dia mostra que a fonte mudou depois de conferido, para
  o responsável decidir se revisa; a semana não é reaberta sozinha.
- **Mais de um projeto no mesmo dia** (dois RDOs no dia): o dia pode ser conferido com mais de
  um projeto. As horas são divididas entre eles como já acontece hoje no ajuste manual.
- **Projeto sem CNPJ cadastrado**: o dia é conferível. O CNPJ aparece como "não cadastrado" e o
  painel indica o cadastro do projeto como lugar de correção.
- **Turno noturno no RDO**: quando o dia é conferido no mesmo projeto do RDO, o relatório
  mantém o turno do RDO. Quando é conferido num projeto sem RDO no dia, o turno é diurno.
- **Colaborador desligado ou admitido no meio da semana**: aparece só nos dias em que estava
  ativo. Os demais dias ficam indisponíveis e não contam como pendência.
- **Projeto inativo ou encerrado**: não aparece como opção de correção, exceto quando já for
  uma das fontes do dia.
- **Edição concorrente** (duas pessoas na mesma semana): a gravação mais antiga falha com
  mensagem pedindo para atualizar, sem sobrescrever a outra.
- **Relatório já enviado e semana reaberta depois**: o envio automático não é repetido. O
  gestor pode usar o envio manual existente se quiser mandar a versão corrigida.
- **Sem permissão**: usuários sem a nova permissão não veem a tela nem o item de menu.

## Requirements *(mandatory)*

### Functional Requirements

**Tela e sugestão**

- **FR-001**: O sistema MUST oferecer, no módulo Efetivo, a tela "Conferência de alocação",
  organizada por semana de segunda a domingo, com navegação para semanas anteriores e
  seguintes.
- **FR-002**: A tela MUST listar os colaboradores ativos do efetivo operacional na semana, com
  uma célula por dia, agrupáveis por projeto principal da semana ou por nome, com busca por
  colaborador ou projeto e filtros "Todos", "Com pendência" e "Não conferidos".
- **FR-003**: Cada célula MUST mostrar a situação do dia (projeto com código e cliente,
  Viagem para projeto, Sede, Folga, Férias, Afastamento, Treinamento ou Sem informação), o
  CNPJ do cliente quando houver projeto e um indicador por fonte (Ponto, RDO, Efetivo) com os
  estados "confirma", "diverge" ou "sem dado".
- **FR-004**: A sugestão automática de cada dia MUST seguir esta ordem de prioridade:
  1. ausência cadastrada;
  2. RDO do dia;
  3. etiqueta de projeto ou de viagem no ponto;
  4. planejamento do Efetivo, quando houve ponto;
  5. ponto batido sem projeto vira Sede;
  6. sem ponto vira Folga (sábado, domingo, feriado ou folga planejada) ou, nos demais casos,
     Sem informação.
- **FR-005**: O sistema MUST marcar como pendência todo dia em que alguma fonte disponível
  diverge da sugestão e todo dia útil "Sem informação", e MUST mostrar na tela o total de dias
  de acordo, de divergências, sem informação e ajustados, além do progresso de colaboradores
  conferidos.
- **FR-006**: Ao abrir um dia, o sistema MUST mostrar o que cada fonte informou (ponto:
  horas normais, horas extras e etiquetas, porque o app não guarda horário de entrada e saída; RDO: número, projeto e situação; Efetivo: alocação
  planejada; ausência cadastrada) e o motivo da divergência, quando houver.

**Correção e conferência**

- **FR-007**: O usuário MUST poder definir a situação de um dia escolhendo entre os projetos
  citados pelas fontes, Sede, Folga, Férias, Afastamento, Treinamento, Viagem para um
  projeto, ou outro projeto ativo pesquisável, com observação opcional.
- **FR-008**: O usuário MUST poder aplicar a mesma escolha a dias seguintes da mesma semana
  a partir do painel e a vários dias selecionados de uma vez, no desktop e no celular.
- **FR-009**: O sistema MUST registrar, para cada dia salvo, a situação, os projetos, a
  observação, quem gravou e quando, e se a escolha difere da sugestão automática no momento da
  gravação.
- **FR-010**: O usuário MUST poder conferir a semana de um colaborador somente quando a linha
  não tiver pendências, e MUST poder conferir de uma vez todas as linhas sem pendência. Ao
  conferir, os dias não editados ficam gravados com a sugestão automática daquele momento.
- **FR-011**: O usuário MUST poder desfazer a conferência de uma linha enquanto a semana
  estiver aberta.
- **FR-012**: O usuário MUST poder fechar a semana somente quando todas as linhas estiverem
  conferidas e o domingo da semana já tiver terminado. A semana fechada MUST ficar somente
  leitura.
- **FR-013**: Somente administradores do app MUST poder reabrir uma semana fechada. Abertura,
  fechamento e reabertura MUST ficar registrados com autor e data.

**Efeitos da conferência**

- **FR-014**: Para todo dia conferido, o custo de mão de obra (HH) MUST apropriar as horas do
  dia aos projetos conferidos. Viagem conta como custo do projeto de destino. Sede, Folga,
  Férias, Afastamento e Treinamento MUST retirar as horas do dia de qualquer projeto.
- **FR-015**: O relatório Alocação dos colaboradores (Relatórios › Estatística), incluindo a
  tela, o PDF e o e-mail mensal, MUST usar a conferência no lugar das entradas derivadas de
  RDO em todo dia conferido. Dias sem projeto aparecem com a situação e sem CNPJ. Viagem
  aparece com o projeto e o CNPJ do destino.
- **FR-016**: Dias não conferidos MUST continuar produzindo exatamente o mesmo resultado de
  hoje no custo HH e no relatório.
- **FR-017**: O painel de auditoria de alocação existente MUST indicar quando um dia foi
  definido pela conferência semanal.

**Envio do relatório mensal**

- **FR-018**: O envio automático do relatório mensal de um mês MUST acontecer no primeiro
  momento, a partir do dia 1º do mês seguinte, em que todas as semanas com dias naquele mês
  estejam fechadas, e no mais tardar no 3º dia útil do mês seguinte.
- **FR-019**: O 3º dia útil MUST ser contado a partir do dia 1º, inclusive, desconsiderando
  sábados, domingos e os feriados cadastrados no calendário do Efetivo. Exemplo: dia 1º
  sexta-feira, sem feriados, dá limite na terça-feira, dia 5.
- **FR-020**: No 3º dia útil, o envio MUST acontecer mesmo com semanas abertas, usando a
  conferência nos dias conferidos e a alocação automática nos demais. O envio manual existente
  MUST continuar disponível sem essa espera.

**Aviso ao Efetivo**

- **FR-021**: Ao conferir uma linha, o sistema MUST gerar aviso aos administradores do módulo
  Efetivo para cada período de dias consecutivos marcados como Folga, Férias ou Afastamento
  pela conferência, sem ausência cadastrada e diferente da sugestão automática.
- **FR-022**: O aviso MUST identificar colaborador, tipo e período, MUST levar ao cadastro de
  ausências do colaborador e MUST ser encerrado automaticamente quando uma ausência do mesmo
  tipo cobrir o período, ou cancelado se a conferência for desfeita ou o dia alterado.

**Acesso**

- **FR-023**: A tela MUST ser acessível somente a usuários com uma nova permissão dedicada de
  conferência de alocação, atribuível pela gestão de usuários, e a administradores do app.

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Tela Conferência de alocação (cabeçalho, resumo, filtros, grade semanal) | `frontend/src/components/projects/AllocationAuditPanel.tsx`, `UnallocatedDaysPanel.tsx`, páginas de `frontend/src/pages/efetivo/`, prévia aprovada | Kit `components/ui/ds` (Card, Badge, Button, Field, Input, Select, MetricCard, ProgressBar, EmptyState, Alert), `SearchBar`, shell largo do Efetivo, tokens de `variables.css` | Busca pelo `SearchBar`; filtros em segmentado do kit | N/A | `?semana=AAAA-MM-DD&mostrar=...&agrupar=...&q=...` na URL | Aviso de novidade de 10 dias + tutorial guiado mostrando célula, painel, seleção múltipla, conferir linha e fechar semana | Desktop: tabela com coluna de colaborador fixa e rolagem horizontal interna ao contêiner. Celular (≤ 640px): um card por colaborador com os 7 dias empilhados; CNPJ quebra linha; filtros quebram linha; sem scroll horizontal de página |
| Painel do dia (fontes + escolha) | `Modal.tsx` e padrões de painel lateral do Efetivo | `Modal` do kit (lateral no desktop, tela cheia no celular, rodapé fixo), `Field`, `Select`/`SearchCombobox` para "outro projeto", `Textarea`, `Alert` para divergência e aviso de ausência | `field-group` / `field-invalid` / `field-error` quando "outro projeto" ou "viagem" é escolhido sem projeto | N/A | Dia aberto não persiste na URL (estado transitório) | Coberto pelo tutorial da tela | Rodapé de ações fixo e corpo rolável; rótulos longos de projeto quebram linha |
| Barra de ações em massa | Barras de ação do Acompanhamento | `Button`, `Select` do kit | Select do kit | N/A | N/A | Coberto pelo tutorial | No celular, entrada por botão "Selecionar dias" em vez de Shift + clique; barra fixa no rodapé quebra em duas linhas |
| Diálogo Fechar/Reabrir semana | `ConfirmDialog.tsx` | `ConfirmDialog` / `useConfirmDialog` | N/A | N/A | N/A | N/A | Padrão do ConfirmDialog |
| Aviso ao Efetivo | Pendências/avisos existentes do Efetivo | Badge de contagem na navegação + lista no padrão de pendências do módulo | N/A | N/A | Seção na URL conforme padrão do módulo | N/A (é aviso operacional) | Lista vira cards no celular |

### Key Entities *(include if feature involves data)*

- **Semana de conferência**: semana (segunda a domingo) identificada pela data da segunda.
  Guarda a situação (aberta ou fechada), quem fechou e quando, e o histórico de reaberturas.
- **Dia conferido**: colaborador + data. Guarda a situação (Projeto, Viagem, Sede, Folga,
  Férias, Afastamento, Treinamento), os projetos (um ou mais; um para viagem), a observação,
  se difere da sugestão automática, a sugestão naquele momento, quem gravou e quando, e se a
  linha da semana está conferida.
- **Aviso de ausência a cadastrar**: colaborador, tipo (Folga, Férias, Afastamento), período,
  origem (semana de conferência) e situação (aberto, encerrado por cadastro, cancelado).
- **Relações com o que já existe**: projeto (código, cliente, CNPJ), colaborador, ausência do
  colaborador, feriados do calendário do Efetivo, ajuste manual de dia do ponto (usado pelo
  custo HH) e relatório mensal de alocação com seus envios.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O responsável confere uma semana de 40 colaboradores em até 20 minutos, contra o
  preenchimento manual atual da planilha.
- **SC-002**: Em uma semana típica, pelo menos 80% das linhas ficam conferidas sem nenhuma
  edição, aceitando a sugestão do app.
- **SC-003**: 100% dos dias conferidos aparecem no relatório Alocação dos colaboradores e no
  custo HH com a situação, o projeto e o CNPJ conferidos.
- **SC-004**: Dias não conferidos têm resultado idêntico ao atual no relatório e no custo,
  verificado por comparação antes e depois em um mês de referência.
- **SC-005**: O relatório mensal nunca é enviado automaticamente antes do fechamento de todas
  as semanas do mês, exceto no limite, e nunca depois do 3º dia útil do mês seguinte.
- **SC-006**: Após dois meses de uso, a planilha Google deixa de ser preenchida e o DP passa a
  usar só o relatório do app.

## Assumptions

- A semana vai de segunda a domingo, igual à prévia aprovada.
- "Administradores do módulo Efetivo", que recebem os avisos, são os usuários com papel de
  gestor do Efetivo e os administradores do app. "Administrador", para reabrir semana, é a
  conta administradora do app.
- Os feriados considerados no 3º dia útil são os do calendário do Efetivo, o mesmo usado no
  planejamento.
- Entram na grade os colaboradores ativos do efetivo operacional. Os colaboradores excluídos da
  simulação de custo continuam aparecendo, porque o DP precisa da alocação deles.
- Folga, Férias, Afastamento e Treinamento aparecem no relatório sem CNPJ, como a Sede
  (decisão do usuário estendida às demais situações sem projeto).
- Não haverá exportação nova nem importação do histórico da planilha; o relatório existente é
  o meio de entrega ao DP.
- A conferência não cria nem altera RDO, ponto ou planejamento. Ela só é gravada e passa a
  prevalecer na leitura.
- A partir da implantação, o envio automático passa a esperar a conferência. Meses anteriores
  já enviados não são reenviados.

## Ajustes após validação (2026-11-04)

- **Viagem nunca vai para a Sede**: etiqueta "em viagem" (inclusive "Sede/Em viagem") sugere viagem
  para o projeto de origem ou destino — etiqueta de projeto real do dia, missão do Efetivo no dia ou
  o projeto do dia vizinho mais próximo (até 7 dias antes ou depois). Empate entre dois projetos
  diferentes sugere o de depois e fica pendente para confirmar. Etiquetas que apontam para centros de
  custo da Sede (5000, 5002, 5003, 5004) contam como Sede, não como projeto.
- **Agrupamento**: "Por nome" vem primeiro e é o padrão; "Por projeto" é opcional.
- **Visão do mês** (`?visao=mes&mes=AAAA-MM`): grade colaborador × dias do mês (somente leitura), com
  a situação das semanas, totais de dias por projeto/situação e clique para abrir a semana. No
  celular, um calendário por colaborador.
- **Cabeçalho fixo**: a tabela rola dentro do próprio contêiner; a linha dos dias e a coluna do
  colaborador ficam fixas.
- **Cores**: cada situação combina fundo, borda e barra lateral com tokens do app (verde, azul,
  cinza, tracejado, hachurado, laranja e vermelho), para a diferença não depender só da cor.
