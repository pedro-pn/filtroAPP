# Research — Módulo de Registros de Qualidade

## R1. Geração do Nº Registro (sequencial por Tipo e Ano)

- **Decisão**: Tabela `QualityRecordSeq` com chave única `(type, year)` e campo `lastSeq`.
  Na criação de um registro, dentro da mesma transação Prisma, faz-se `upsert`/`update`
  incrementando `lastSeq` de forma atômica e usa-se o valor para montar `{letra}-{seq:03d}/{AA}`.
- **Rationale**: Garante unicidade sob concorrência sem depender de `COUNT(*)` (que sofre corrida).
  Espelha o padrão já existente `ProjectReportSeq` no schema.
- **Alternativas rejeitadas**: (a) `MAX(numero)+1` por consulta — corrida entre requisições
  simultâneas gera Nº duplicado; (b) sequência global do Postgres — não reinicia por ano nem separa
  por tipo.
- **Letras**: D=Desvio, L=Lição Aprendida, I=Incidente, R=Reclamação de Cliente, M=Melhoria.
- **Ano**: 2 dígitos da **Data do Registro** (ano de lançamento). Reinicia o sequencial por ano.

## R2. Ocorrências 12m / Recorrente? (derivado vs. persistido)

- **Decisão**: Calcular **em tempo de leitura**, não persistir. Para um registro R, Ocorrências =
  número de registros de mesma `natureId` cuja `eventDate` ∈ `[R.eventDate - 12 meses, R.eventDate]`;
  Recorrente = Ocorrências ≥ 3.
- **Rationale**: Recorrência é uma função do conjunto; persistir exigiria recomputar todos os
  registros afetados a cada create/update/delete/renomeação de Natureza. Derivar mantém consistência
  automática. A janela ancorada na `eventDate` de cada registro torna o valor determinístico e
  testável (ver SC-004), diferente de "12 meses a partir de hoje" que muda diariamente.
- **Implementação sem N+1**: na listagem, buscar registros da página, agrupar por `natureId` e, para
  cada natureza envolvida, contar eventos por janela; ou uma consulta agregada por natureza. Em
  `recurrence.js`, função pura testável recebendo a lista de datas por natureza.
- **Alternativas rejeitadas**: campo persistido com recomputação em cascata (frágil e caro); janela
  fixa a partir de `now()` (não reproduzível em teste, muda o valor histórico).

## R3. Vínculo Obra/Projeto + opção "Interno/SGQ"

- **Decisão**: `projectId String?` (nullable) referenciando `Project`. `null` = "Interno/SGQ". A
  lista suspensa carrega projetos ativos via endpoint já existente de projetos + a opção fixa
  "Interno/SGQ" no topo.
- **Rationale**: Vínculo por FK preserva integridade e permite a query da seção Desvios no card.
  Registro sem projeto (null) nunca aparece em card de projeto.
- **Alternativas rejeitadas**: guardar código do projeto como texto (perde integridade e a query da
  US3); tornar projeto obrigatório (contradiz a Legenda: "Interno/SGQ quando não for de obra").

## R4. Natureza como entidade gerenciada (não texto livre)

- **Decisão**: Modelo `QualityNature` (nome único case-insensitive, `isActive`). Registro referencia
  `natureId`. Aba dedicada para CRUD. Exclusão bloqueada quando há registros vinculados (usar
  desativação). Naturezas inativas somem do formulário de novos registros mas persistem nos antigos.
- **Rationale**: A recorrência depende de a mesma categoria ser sempre o mesmo valor; vínculo por FK
  elimina divergência de texto e permite renomear sem quebrar contagem (Legenda R9/R23).
- **Alternativas rejeitadas**: texto livre padronizado "na mão" (o próprio motivo do problema);
  exclusão em cascata (apagaria a categoria de registros históricos).

## R5. Integração no card do projeto (Acompanhamento)

- **Decisão**: Adicionar seção **Desvios** somente-leitura em `ProjectDetailDashboard.tsx`, populada
  por endpoint `GET /qualidade/registros?projectId=<id>&type=DESVIO` (ou um endpoint enxuto
  `GET /qualidade/registros/projeto/:projectId/desvios`). Lista Nº, Natureza, Impacto, Status + link
  para o módulo.
- **Rationale**: Aditivo, sem tocar na lógica de custo/missões do Acompanhamento. Reusa os cards/
  badges do detalhe do projeto (sem componente novo). Filtro por tipo Desvio conforme decisão do
  usuário.
- **Alternativas rejeitadas**: embutir todos os tipos (usuário pediu só Desvios); duplicar dados no
  módulo Acompanhamento (fonte única deve ser o módulo Qualidade).

## R6. Permissões e Hub

- **Decisão**: Novo `AppModule.QUALIDADE` e papéis `QUALIDADE_MANAGER` (CRUD) / `QUALIDADE_VIEWER`
  (leitura). Middleware `requireQualidadeAccess` / `requireQualidadeManager` espelhando
  `requireEstoqueAccess`/`requireEstoqueManager`. Módulo registrado em `hubModules.ts`.
- **Rationale**: Consistência total com Estoque/Equipamentos; enforcement no backend (SC-005), não
  só na UI.
- **Alternativas rejeitadas**: reaproveitar papel do Acompanhamento (mistura domínios e permissões).

## R7. Campos de formulário e tipos

- **Decisão**:
  - Datas: Data do Registro (default hoje), Data do Evento, Prazo da ação → `DateTime`/date input.
  - Selects: Tipo, Impacto (Alto/Médio/Baixo), Disposição (Tratar/Monitorar/Arquivar-Divulgar),
    Status (Aberto/Em triagem/Em observação/Em ação/Fechado/Divulgado), Projeto, Natureza.
  - Texto livre/listas: Origem, Descrição, RNC vinculada, Ação definida, Responsável pela ação,
    Evidências (links/anexos), Verificação do resultado.
  - Regra condicional: Ação definida obrigatória quando Disposição = "Tratar" (validada no Zod
    compartilhado com `superRefine`).
- **Rationale**: Segue a Legenda da planilha, com o ajuste pedido (Prazo da ação vira data) e
  permite anexar várias fotos/documentos sem impedir links externos.
- **Alternativas rejeitadas**: Origem/Responsável como listas fechadas (a Legenda os marca como
  Manual; listas podem virar fase posterior).

## R8. Exportação para xlsx

- **Decisão**: Gerar o `.xlsx` no **backend** montando o pacote OOXML com `adm-zip` (já dependência),
  em `lib/qualidade/export-xlsx.js`, e servir via `GET /qualidade/registros/export` com
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` e
  `Content-Disposition: attachment`. Usa **inline strings** na worksheet (dispensa `sharedStrings`).
  Reaplica os mesmos filtros do `GET /registros`. Colunas na ordem da referência FR-3-4-11-01:
  Nº Registro, Data do Registro, Tipo, Origem, Obra/Projeto, Data do Evento, Natureza, Descrição,
  Impacto, Ocorrências 12m, Recorrente?, RNC vinculada, Disposição, Ação definida, Responsável pela
  ação, Prazo da ação, Evidência, Verificação do resultado, Status.
- **Rationale**: O projeto já trata planilha como ZIP de XML com `adm-zip`+`@xmldom/xmldom` (ver
  `lib/acompanhamento/ponto-parser.js`) e evita libs pesadas de spreadsheet. Manter o mesmo padrão
  respeita a Constituição (reuso de padrão existente) e não adiciona dependência. Backend garante que
  a exportação respeita permissão e filtros de forma consistente com a listagem.
- **Alternativas rejeitadas**: (a) `exceljs`/`sheetjs` — nova dependência pesada, contra o padrão
  atual; (b) exportar CSV — o usuário pediu `.xlsx` no layout da referência; (c) gerar no frontend —
  duplicaria regra de filtro/derivados e exporia lógica de montagem no cliente.
- **Detalhe de robustez**: escapar XML (`& < >`), formatar datas como texto `dd/mm/aaaa` (célula de
  texto, evitando serial de data), e Recorrente? como "SIM"/"não" (coerente com a UI).
