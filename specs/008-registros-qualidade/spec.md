# Feature Specification: Módulo de Registros de Qualidade
**Feature Branch**: `008-registros-qualidade`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Novo módulo para registros de informações da qualidade (melhoria, desvio, lição aprendida, incidente, reclamação de cliente), baseado no formulário FR-3-4-11-01. Desvios vinculados a um projeto devem aparecer no card do projeto no Acompanhamento. Listagem em tabela estilo Estoque, com registrar/editar/excluir e uma aba para cadastro de Natureza (categoria)."

## Clarifications

### Session 2026-07-22

- **Tipos de registro**: 5 tipos, com letra-código para o Nº Registro — Desvio (D), Lição Aprendida (L), Incidente (I), Reclamação de Cliente (R), Melhoria (M).
- **Integração com Acompanhamento**: no card do projeto aparecem **somente registros do tipo Desvio** vinculados àquele projeto.
- **Ocorrências 12m / Recorrente?**: calculados **automaticamente** já nesta v1, por Natureza (base = Data do Evento); Recorrente = SIM quando ≥ 3 ocorrências.
- **Nº Registro**: sequencial por Tipo, **reiniciando a cada ano** (ex.: `D-001/26` … `D-045/26`, depois `D-001/27`).
- **Prazo da ação**: campo de **data** (a planilha original era texto livre).
- **Evidência**: lista opcional com um ou mais links e/ou anexos. Anexos aceitos por enquanto:
  imagens e PDFs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar um evento de qualidade (Priority: P1)

O gestor do módulo abre a aba **Registros**, clica em **Registrar**, preenche o formulário
(tipo, origem, projeto, data do evento, natureza, descrição, impacto, disposição, etc.) e
salva. O sistema gera automaticamente o Nº Registro no padrão `{letra do tipo}-{sequencial}/{ano}`
e o registro passa a aparecer na tabela.

**Why this priority**: É o núcleo do módulo — sem cadastrar registros, nada mais tem valor.
Entrega sozinha um MVP: um livro de registros de qualidade pesquisável.

**Independent Test**: Criar um registro do tipo Desvio e confirmar que ele recebe `D-001/26`,
aparece na tabela e persiste após recarregar a página.

**Acceptance Scenarios**:

1. **Given** a aba Registros vazia, **When** o gestor cria um Desvio com data do evento em 2026,
   **Then** o Nº Registro gerado é `D-001/26` e o registro aparece na tabela.
2. **Given** já existe `D-001/26`, **When** o gestor cria outro Desvio em 2026, **Then** o novo
   Nº é `D-002/26`; um Desvio criado com data do evento em 2027 recebe `D-001/27`.
3. **Given** o gestor seleciona Tipo = Melhoria, **When** salva, **Then** o Nº começa com `M-`.
4. **Given** um campo obrigatório vazio (Tipo, Data do Registro, Data do Evento, Natureza,
   Descrição, Impacto, Status, Disposição), **When** o gestor tenta salvar, **Then** o sistema
   bloqueia com mensagem de validação em pt-BR e não cria o registro.
5. **Given** Disposição = "Tratar", **When** o gestor deixa "Ação definida" vazia, **Then** o
   sistema exige o preenchimento da ação.

---

### User Story 2 - Editar e excluir registros (Priority: P1)

Cada linha da tabela oferece **Editar** e **Excluir**. O gestor pode alterar qualquer campo
editável de um registro existente (o Nº Registro permanece fixo) e pode excluir um registro
após confirmação.

**Why this priority**: O usuário pediu registros "completamente editáveis pelo gestor". Correção
de dados é indispensável para um livro de registros de qualidade.

**Independent Test**: Editar a Descrição e o Status de um registro e confirmar a persistência;
excluir um registro e confirmar que some da tabela.

**Acceptance Scenarios**:

1. **Given** um registro existente, **When** o gestor edita o Impacto de Baixo para Alto e salva,
   **Then** a tabela reflete Alto e o Nº Registro não muda.
2. **Given** um registro existente, **When** o gestor clica em Excluir e confirma no diálogo,
   **Then** o registro some da tabela.
3. **Given** um usuário com papel Viewer, **When** ele acessa o módulo, **Then** não vê os botões
   Registrar/Editar/Excluir (apenas leitura).

---

### User Story 3 - Ver Desvios no card do projeto (Priority: P2)

No Acompanhamento de Projetos, ao abrir o detalhe de um projeto, o gestor vê uma seção
**Desvios** listando (somente leitura) os registros do tipo Desvio vinculados àquele projeto,
com Nº, Natureza, Impacto e Status, e um link para o módulo de Qualidade.

**Why this priority**: É o principal ganho de integração pedido, mas depende de já existirem
registros (P1). Agrega valor sem ser pré-requisito do MVP.

**Independent Test**: Vincular dois Desvios ao projeto X, abrir o card de X no Acompanhamento e
confirmar que ambos aparecem na seção Desvios; um Desvio vinculado a "Interno/SGQ" não aparece.

**Acceptance Scenarios**:

1. **Given** dois Desvios vinculados ao projeto X, **When** o gestor abre o card de X, **Then** a
   seção Desvios lista os dois com Nº, Natureza, Impacto e Status.
2. **Given** um registro do tipo Melhoria vinculado ao projeto X, **When** o gestor abre o card,
   **Then** esse registro **não** aparece (apenas Desvios).
3. **Given** um projeto sem Desvios, **When** o gestor abre o card, **Then** a seção mostra estado
   vazio ("Nenhum desvio registrado").

---

### User Story 4 - Gerenciar Naturezas (categorias) (Priority: P2)

O módulo tem uma aba **Naturezas** onde o gestor cadastra, renomeia, ativa/desativa e (quando não
usada) exclui as categorias de Natureza. O formulário de registro usa essa lista padronizada.

**Why this priority**: A Natureza padronizada é a base do cálculo de recorrência; sem controle
sobre ela, o texto diverge e a contagem quebra. Depende do módulo existir (P1).

**Independent Test**: Cadastrar a Natureza "Atraso de mobilização", criar um registro usando-a e
confirmar que ela aparece na lista suspensa do formulário.

**Acceptance Scenarios**:

1. **Given** a aba Naturezas, **When** o gestor cadastra "Atraso de mobilização", **Then** ela
   passa a aparecer na lista suspensa do formulário de registro.
2. **Given** uma Natureza já usada por registros, **When** o gestor tenta excluí-la, **Then** o
   sistema impede a exclusão e sugere desativá-la.
3. **Given** duas Naturezas com o mesmo nome, **When** o gestor tenta salvar a segunda, **Then** o
   sistema bloqueia por duplicidade (nome único, case-insensitive).

---

### User Story 5 - Recorrência automática (Priority: P3)

Ao listar/abrir registros, os campos **Ocorrências 12m** e **Recorrente?** são calculados
automaticamente: o sistema conta quantos registros da **mesma Natureza** têm Data do Evento dentro
da janela de 12 meses anteriores (inclusive) à Data do Evento do registro; se o total for ≥ 3,
Recorrente = SIM.

**Why this priority**: Automatiza uma regra do SGQ (6.3.4), mas o módulo já é útil sem ela. É um
enriquecimento apoiado nos dados de P1/P2.

**Independent Test**: Criar 3 registros de mesma Natureza com datas de evento dentro de 12 meses e
confirmar Ocorrências = 3 e Recorrente = SIM em cada um dentro da janela.

**Acceptance Scenarios**:

1. **Given** 2 registros de Natureza "Stand By" dentro de 12 meses, **When** listados, **Then**
   Ocorrências 12m = 2 e Recorrente = não.
2. **Given** um 3º registro de "Stand By" dentro da janela de 12 meses, **When** listado, **Then**
   Ocorrências 12m = 3 e Recorrente = SIM.
3. **Given** um registro de "Stand By" com data do evento fora da janela de 12 meses dos demais,
   **When** listado, **Then** ele não conta para (nem herda) a recorrência dos outros.

---

### User Story 6 - Exportar registros para xlsx (Priority: P3)

Na aba Registros há um botão **Exportar**. Ao clicar, o sistema gera e baixa uma planilha `.xlsx`
com todos os registros (respeitando os filtros ativos), no layout do formulário de referência
FR-3-4-11-01 (mesma ordem de colunas), incluindo as colunas derivadas Ocorrências 12m e Recorrente?.

**Why this priority**: Facilita relatórios e auditoria do SGQ fora do app, mas o módulo já é útil
sem isso. Apoia-se nos dados de P1–P3.

**Independent Test**: Com alguns registros cadastrados, clicar em Exportar e confirmar que o arquivo
baixado abre no Excel/LibreOffice com uma linha por registro e as colunas na ordem da referência.

**Acceptance Scenarios**:

1. **Given** N registros na tabela, **When** o gestor clica em Exportar, **Then** baixa um `.xlsx`
   com cabeçalho no padrão FR-3-4-11-01 e N linhas de dados.
2. **Given** um filtro ativo (ex.: type = Desvio), **When** o gestor exporta, **Then** a planilha
   contém apenas os registros que atendem ao filtro.
3. **Given** a tabela sem registros, **When** o gestor exporta, **Then** baixa uma planilha só com o
   cabeçalho (sem linhas de dados) e sem erro.

---

### Edge Cases

- **Ano do sequencial**: o ano do Nº Registro segue a **Data do Registro** (não a Data do Evento).
  Registros lançados em 2027 recebem `/27` mesmo que descrevam evento de 2026.
- **Concorrência na numeração**: dois cadastros simultâneos do mesmo tipo/ano não podem gerar o
  mesmo Nº — a geração do sequencial precisa ser atômica (transação + unicidade).
- **Projeto = Interno/SGQ**: registro sem projeto vinculado é válido e nunca aparece em card de
  projeto.
- **Projeto excluído/arquivado**: um registro vinculado a projeto posteriormente inativado
  permanece válido; a listagem ainda mostra o nome/código do projeto.
- **Natureza renomeada**: renomear uma Natureza afeta todos os registros que a referenciam (via
  vínculo, não por cópia de texto) e recalcula a recorrência coerentemente.
- **Exclusão de Natureza em uso**: bloqueada (ver US4).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE permitir ao gestor do módulo criar um registro de qualidade com os
  campos: Data do Registro, Tipo, Origem, Obra/Projeto, Data do Evento, Natureza, Descrição do
  evento, Impacto, RNC vinculada, Disposição, Ação definida, Responsável pela ação, Prazo da ação,
  Evidências, Verificação do resultado e Status.
- **FR-002**: O sistema DEVE gerar o **Nº Registro** automaticamente no formato
  `{letra}-{sequencial de 3 dígitos}/{ano de 2 dígitos}`, onde a letra é D (Desvio), L (Lição
  Aprendida), I (Incidente), R (Reclamação de Cliente) ou M (Melhoria), o sequencial é único e
  crescente **por tipo e por ano**, reiniciando a cada ano (base = ano da Data do Registro).
- **FR-003**: O Nº Registro DEVE ser somente leitura e imutável após a criação.
- **FR-004**: A geração do sequencial DEVE ser atômica, impedindo Nº duplicado sob concorrência.
- **FR-005**: O campo **Tipo** DEVE ser lista suspensa com os 5 tipos definidos; **Impacto**
  (Alto/Médio/Baixo), **Disposição** (Tratar/Monitorar/Arquivar-Divulgar) e **Status** (Aberto/Em
  triagem/Em observação/Em ação/Fechado/Divulgado) também DEVEM ser listas suspensas.
- **FR-006**: O campo **Obra/Projeto** DEVE ser preenchido a partir da lista de projetos
  cadastrados no app, permitindo também a opção **"Interno/SGQ"** (sem projeto vinculado).
- **FR-007**: O campo **Natureza** DEVE ser preenchido a partir da lista de Naturezas gerenciada no
  módulo (vínculo por referência, não texto livre).
- **FR-008**: **Prazo da ação**, **Data do Registro** e **Data do Evento** DEVEM ser campos de data.
- **FR-009**: Quando **Disposição = "Tratar"**, o campo **Ação definida** DEVE ser obrigatório.
- **FR-010**: O sistema DEVE permitir ao gestor **editar** qualquer campo de um registro existente,
  exceto o Nº Registro, e persistir as alterações.
- **FR-011**: O sistema DEVE permitir ao gestor **excluir** um registro, com diálogo de confirmação.
- **FR-012**: O sistema DEVE listar os registros em **tabela** (estilo Estoque), com colunas
  correspondentes aos campos e ações de Editar/Excluir por linha, com alternativa empilhada em
  telas estreitas (cards) conforme o padrão mobile do app.
- **FR-013**: O sistema DEVE calcular automaticamente **Ocorrências 12m** = número de registros da
  mesma Natureza cuja Data do Evento cai na janela de 12 meses anteriores (inclusive) à Data do
  Evento do registro, e **Recorrente? = SIM** quando esse total for ≥ 3. Ambos são somente leitura.
- **FR-014**: O sistema DEVE oferecer uma aba **Naturezas** para criar, renomear, ativar/desativar
  e excluir Naturezas. O nome DEVE ser único (case-insensitive).
- **FR-015**: O sistema DEVE **impedir a exclusão** de uma Natureza referenciada por qualquer
  registro, orientando o gestor a desativá-la.
- **FR-016**: Naturezas **desativadas** NÃO DEVEM aparecer como opção em novos registros, mas
  DEVEM continuar exibidas em registros existentes que já as usam.
- **FR-017**: No detalhe do projeto no Acompanhamento, o sistema DEVE exibir (somente leitura) a
  seção **Desvios** com os registros do tipo **Desvio** vinculados àquele projeto (Nº, Natureza,
  Impacto, Status) e link para o módulo de Qualidade; com estado vazio quando não houver.
- **FR-018**: O acesso ao módulo DEVE respeitar dois papéis: **Gestor** (CRUD completo de registros
  e naturezas) e **Visualizador** (somente leitura), seguindo o padrão de papéis por módulo do app.
- **FR-019**: Toda entrada de API DEVE ser validada no backend com Zod; formulários no frontend
  DEVEM usar react-hook-form com resolver Zod.
- **FR-020**: A Data do Registro DEVE ter valor padrão = data atual ao abrir o formulário de criação.
- **FR-021**: O sistema DEVE permitir **exportar todos os registros para um arquivo `.xlsx`** (botão
  na aba Registros), respeitando os filtros ativos, com as colunas na ordem do formulário de
  referência FR-3-4-11-01 (incluindo Nº Registro, Ocorrências 12m e Recorrente?). A exportação é
  permitida para Gestor e Visualizador (é leitura).

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|------------------------|---------------------------|------------------------------|
| Página do módulo (shell + abas Registros/Naturezas) | `frontend/src/pages/estoque/EstoquePage.tsx`; `frontend/src/pages/acompanhamento/AcompanhamentoPage.tsx` (nav `.equip-nav-item` + `select` mobile) | `.equip-page` shell largo; abas `.equip-nav-item` + `select` mobile | abas via query param | Aba ativa em `?tab=` (URL/query param) | Tutorial permanente de primeiro acesso do módulo (padrão módulo novo) | Barra de abas cabe na largura do módulo; usa `select` mobile; sem scroll horizontal de página |
| Tabela de Registros (com botão Exportar) | `frontend/src/pages/estoque/StockItemsTab.tsx` / `StockMovementsTab.tsx` | tabela padrão + `SearchBar`, `Skeleton`, `ConfirmDialog`, `Button` de `components/ui/` | ações por linha (Editar/Excluir); botão Exportar (`Button` secundário) que dispara download `.xlsx` | filtros/página em query param | coberto pelo tutorial do módulo | tabela vira cards em telas estreitas; barra de ações (Registrar/Exportar) quebra sem estourar; sem `nowrap` sem `max-width` |
| Modal de Registro (criar/editar) | `frontend/src/pages/estoque/StockItemFormModal.tsx`; `StockMovementFormModal.tsx` | `Modal` (rodapé fixo, corpo rolável), `Button`, inputs globais de `base.css`, `select` estilizado do kit | react-hook-form + resolver Zod; `select` estilizado (Tipo/Impacto/Disposição/Status/Projeto/Natureza) | N/A (modal) | N/A | modal com rodapé de ações fixo e corpo rolável; grid de campos com `min-width:0` |
| Aba/Modal de Natureza | `frontend/src/pages/estoque/StockCategoriesTab.tsx`; `StockCategoryFormModal.tsx` | mesmos componentes do kit | react-hook-form + Zod; inline/admin form | aba via query param | coberto pelo tutorial do módulo | tabela→cards; sem overflow |
| Seção Desvios no card do projeto | `frontend/src/components/projects/ProjectDetailDashboard.tsx` | classes/cards já usados no detalhe do projeto | somente leitura (sem form) | herda navegação do Acompanhamento | aviso de novidade 10 dias (função nova visível), padrão card `driver.js` (DDS) | lista de desvios empilha em mobile; badges/Nº truncam sem estourar o card |

### Key Entities *(include if feature involves data)*

- **Registro de Qualidade (QualityRecord)**: um evento registrado. Atributos: Nº Registro (gerado),
  Data do Registro, Tipo (enum de 5), Origem (texto), vínculo opcional com Projeto (ou Interno/SGQ),
  Data do Evento, vínculo com Natureza, Descrição, Impacto (enum), RNC vinculada (texto), Disposição
  (enum), Ação definida (texto), Responsável pela ação (texto), Prazo da ação (data), Evidências
  (links/anexos), Verificação do resultado (texto), Status (enum). Ocorrências 12m e Recorrente? são
  **derivados** (não armazenados). Relaciona-se com Projeto (0..1) e Natureza (1).
- **Natureza (QualityNature)**: categoria padronizada de evento. Atributos: nome (único,
  case-insensitive), ativo/inativo, timestamps. Base de agrupamento para a recorrência. Relaciona-se
  com muitos Registros.
- **Sequência de Registro (QualityRecordSeq)**: controle atômico do sequencial por (Tipo, Ano) para
  gerar o Nº Registro sem colisão.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O gestor consegue cadastrar um registro completo em menos de 2 minutos, com o Nº
  gerado automaticamente e correto para o tipo/ano.
- **SC-002**: 100% dos Nº Registro gerados são únicos por (tipo, ano) mesmo sob cadastros
  simultâneos (sem duplicidade em teste de concorrência).
- **SC-003**: Ao abrir o card de um projeto, todos os Desvios vinculados a ele aparecem na seção
  Desvios, e nenhum registro de outro tipo ou de outro projeto aparece.
- **SC-004**: Para qualquer conjunto de registros de mesma Natureza, Ocorrências 12m e Recorrente?
  correspondem exatamente à regra de janela de 12 meses (verificável por teste de backend).
- **SC-005**: Um Visualizador nunca consegue criar, editar ou excluir registros/naturezas (bloqueio
  no backend, não só na UI).
- **SC-006**: A exportação gera um `.xlsx` válido (abre em Excel/LibreOffice) com uma linha por
  registro filtrado e as colunas na ordem do formulário FR-3-4-11-01.

## Assumptions

- **Evidências** aceitam múltiplos links e múltiplos anexos; nesta fase os anexos permitidos são
  imagens e PDFs, reaproveitando o padrão de anexos do Estoque/Equipamentos.
- **Origem** e **Responsável pela ação** são texto livre na v1 (a Legenda os marca como "Manual").
- A **janela de recorrência** ancora na Data do Evento de cada registro (12 meses anteriores,
  inclusive), tornando o valor por-registro estável e reproduzível — interpretação de "últimos 12
  meses" da Legenda para efeito de teste determinístico.
- O ano do sequencial usa a **Data do Registro** (data de lançamento no sistema), coerente com o
  sufixo `/AA` do exemplo `D-001/26`.
- Reaproveita o sistema de autenticação e o padrão de papéis por módulo já existentes (Estoque como
  referência: `MANAGER`/`VIEWER`).
- O módulo aparece no Hub como um novo módulo, com permissão própria concedida via administração de
  papéis existente.
- A geração do `.xlsx` reaproveita o padrão do projeto de tratar planilha como ZIP de OOXML com
  `adm-zip` (já dependência, usado no parser de ponto), sem adicionar biblioteca de spreadsheet.
