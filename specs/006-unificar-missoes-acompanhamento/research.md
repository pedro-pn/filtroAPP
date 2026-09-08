# Research: Unificar Missões no Acompanhamento

## Decision: Persistir agrupamentos no backend, não em estado local do navegador

**Rationale**: O agrupamento muda a leitura gerencial do Acompanhamento e deve sobreviver a recarregamento/sessões. Persistir no backend também permite aplicar a mesma configuração na aba Projetos e no Dashboard, com permissão e auditoria.

**Alternatives considered**:

- Estado local no frontend: simples, mas cada usuário veria uma versão diferente e a configuração sumiria.
- Querystring/filtro temporário: útil para análise ad hoc, mas não atende "cards selecionados viram um só" de forma reversível e persistente.
- Alterar `Project`: rejeitado porque o agrupamento não é dado operacional do projeto; é uma visão do Acompanhamento.

## Decision: Aplicar grupos como overlay sobre cálculos individuais existentes

**Rationale**: A exigência central é não perder a independência de cálculo. O fluxo atual já calcula cada missão com regras de comercial, Omie, estoque, mão de obra, impostos e avanço. Consolidar depois evita duplicar regra de negócio e mantém cada missão rastreável.

**Alternatives considered**:

- Recalcular tudo diretamente por grupo: aumenta risco de divergência com a missão individual e duplica regras complexas.
- Criar projeto sintético para o grupo: afetaria relatórios, RDOs e integrações, contrariando o escopo.

## Decision: Usar tabelas `AcompanhamentoMissionGroup` e `AcompanhamentoMissionGroupMember`

**Rationale**: A relação grupo→missões é N:N com histórico. Um modelo relacional permite validar membros, listar grupos ativos rapidamente e preservar auditoria de grupos desmesclados.

**Alternatives considered**:

- JSON em `AcompanhamentoSetting`: rápido, mas frágil para validação, auditoria e concorrência.
- Campo direto em `Project`: mistura configuração visual com cadastro operacional.

## Decision: Garantir uma associação ativa por missão com `activeProjectId`

**Rationale**: PostgreSQL permite múltiplos `NULL` em coluna única. Ao manter `activeProjectId = projectId` só enquanto o grupo está ativo e limpar para `NULL` ao desmesclar, uma unique simples impede que uma missão entre em dois grupos ativos, mantendo histórico de associações antigas.

**Alternatives considered**:

- Só validação em serviço: menos robusta em concorrência.
- Índice parcial manual: possível em PostgreSQL, mas fugiria do fluxo Prisma puro exigido pela constitution.
- Unique `[projectId, status]`: bloquearia múltiplos históricos dissolvidos para a mesma missão.

## Decision: Consolidar indicadores por regras explícitas

**Rationale**: Métricas diferentes exigem tratamento diferente. Dinheiro e contagens somam; percentuais devem ser recalculados a partir dos totais; progresso físico preserva cada progresso individual e mostra um resumo ponderado para evitar média simples enganosa.

**Alternatives considered**:

- Média simples de percentuais: rápida, mas distorce grupos com propostas de tamanhos diferentes.
- Mostrar apenas totais monetários e esconder progresso: incompleto para o pedido "tudo".
- Recalcular progresso físico por escopo único do grupo: exigiria unificar escopos heterogêneos e quebraria independência por missão.

## Decision: Mutação restrita a gestor do Acompanhamento

**Rationale**: O agrupamento persistente altera a visão compartilhada do módulo. Leitura pode seguir `requireAcompanhamentoAccess`, mas criar/renomear/desmesclar deve usar `requireAcompanhamentoManager`.

**Alternatives considered**:

- Permitir para qualquer viewer: risco de alterações compartilhadas acidentais.
- Permitir só admin: restritivo demais para o papel de gestor do módulo já existente.

## Decision: Integrar primeiro Projetos e Dashboard; deixar Sede/Custo fora

**Rationale**: O pedido fala em missões/cards do acompanhamento. As abas Projetos e Dashboard exibem missões/projetos; Sede e Custo são outras visões administrativas e não devem ser afetadas.

**Alternatives considered**:

- Alterar só Projetos: atenderia "cards", mas deixaria o Dashboard com linhas divergentes.
- Alterar todos os módulos: ampliaria o escopo e violaria a restrição de afetar apenas o acompanhamento de missões.

## Decision: UI com modo de seleção na aba Projetos

**Rationale**: A aba Projetos já tem cards, filtros e segmentação. Um modo de seleção com ação "Unificar selecionadas" é direto, mobile-friendly e não exige uma nova tela.

**Alternatives considered**:

- Multiselect em modal separado: mais pesado e distante dos cards que o usuário quer agrupar.
- Drag-and-drop: ruim em mobile e desnecessário para o fluxo.
