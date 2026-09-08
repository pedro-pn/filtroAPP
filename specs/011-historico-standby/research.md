# Research: Histórico de standby por projeto

## Consulta sob demanda

**Decision**: Criar uma rota de leitura específica para o histórico e carregá-la somente quando o diálogo for aberto.

**Rationale**: O módulo já executa consultas custosas para produzir o quadro e o dashboard, mas transferir todo o histórico aumentaria permanentemente os payloads mesmo quando ninguém consulta standby. Uma consulta dedicada mantém as telas leves e permite estados próprios de carregamento, erro e nova tentativa.

**Alternatives considered**:

- Incluir `standbyHistory` no detalhe carregado pelo dashboard: elimina uma requisição, porém transfere dados históricos mesmo quando o diálogo não é aberto e não oferece feedback isolado.
- Reaproveitar o detalhe completo do projeto: retorna muito mais dados que a tabela necessita e não inclui motivo nem efetivo diário no formato solicitado.

## Seleção dos relatórios válidos

**Decision**: Aplicar `selectRealizedSourceReportData` aos relatórios não excluídos antes de montar o histórico.

**Rationale**: O Acompanhamento já usa essa seleção para incluir RDOs e relatórios de serviço independentes, excluindo relatórios técnicos derivados de um RDO. Reusar a mesma regra evita duplicar uma ocorrência de standby que foi copiada para um relatório derivado.

**Alternatives considered**:

- Considerar somente `reportType = RDO`: excluiria relatórios independentes que também são fonte operacional válida.
- Considerar todos os relatórios: duplicaria dados derivados por `parentRdoId`.

## Agregação por dia

**Decision**: Produzir no máximo uma linha por data UTC do relatório. Somar as durações positivas das fontes válidas do dia, unir motivos distintos na ordem de leitura e deduplicar identificadores de colaboradores. Quando não houver identificadores, usar o maior `daytimeCount` positivo do dia; se também estiver ausente, retornar `null`.

**Rationale**: A solicitação é orientada a dias, e mais de um relatório-fonte pode existir na mesma data. A soma preserva o tempo informado, a união evita perder motivos e a deduplicação impede inflar o efetivo. O fallback por maior efetivo é conservador e não inventa quantidade para dados legados.

**Alternatives considered**:

- Uma linha por relatório: poderia repetir o mesmo dia e contrariar a leitura diária esperada.
- Somar `daytimeCount`: inflaria o efetivo quando as mesmas pessoas aparecem em fontes diferentes.
- Forçar efetivo igual a 1 quando não há informação: seria útil para cálculos de homem-hora, mas incorreto para exibição factual.

## Formato e ordenação

**Decision**: O backend retorna `date` como `YYYY-MM-DD`, `standbyMinutes` como inteiro positivo, `collaboratorCount` anulável e `reason` anulável; a lista vem em ordem decrescente. O frontend formata data em pt-BR e duração como `HH:MM`.

**Rationale**: Valores canônicos evitam ambiguidade de fuso e permitem que a interface controle a apresentação sem perda dos minutos.

**Alternatives considered**:

- Retornar duração já formatada: acopla contrato e apresentação.
- Ordenar somente no cliente: permitiria consumidores inconsistentes e repetiria regra.

## Diálogo e responsividade

**Decision**: Usar `Modal` e `Button` compartilhados, com o padrão estrutural `acp-manage-*`. A tabela terá classes específicas baseadas em tokens; em até 640 px cada linha vira um registro empilhado por meio de `data-label`.

**Rationale**: O `Modal` existente já implementa foco inicial, armadilha de foco, Escape e restauração de foco. O padrão `acp-manage-*` mantém corpo rolável e rodapé fixo. Classes específicas evitam herdar a regra da tabela geral que trata a primeira coluna como título de missão.

**Alternatives considered**:

- Criar overlay local: duplicaria acessibilidade já resolvida no kit.
- Manter tabela larga com rolagem horizontal: viola o requisito mobile-first do projeto.

## Divulgação temporária

**Decision**: Estender `ProjectTrackingNovelties` com uma campanha de histórico de standby válida até 2026-09-04 23:59:59 no fuso de São Paulo, marcada por usuário no `localStorage` somente quando o Driver.js inicia.

**Rationale**: Usa um aviso dedicado no dashboard, coordenado pelo bloqueio global do Driver.js para evitar apresentações simultâneas, e atende a regra constitucional de 10 dias sem criar onboarding permanente.

**Alternatives considered**:

- Criar novo orquestrador independente: aumentaria o risco de duas campanhas disputarem o foco.
- Não divulgar: viola o contrato visual vigente.
