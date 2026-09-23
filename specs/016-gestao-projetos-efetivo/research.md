# Pesquisa e decisões

- Decisão: usar ProjectWorkflow único por Project, sem planId. Motivo: EfetivoPlan é copiável e aplicável por simulações; aceite/pendências não podem ser sobrescritos. Alternativa rejeitada: ampliar EfetivoMissionStage diretamente.
- Decisão: primeira entrega termina na entrada em planejamento, mantendo Kanban operacional na outra visão. Motivo: gates de mobilização dependem de reservas, documentos e liberações ainda inexistentes; evitar falso sinal de autorização.
- Decisão: aceite pelo próprio líder; gestor pode designar/substituir. Liderança usa contas com acesso Efetivo, independente de colaborador de campo. Alternativa rejeitada: aceitar em nome de terceiro.
- Decisão: ações transacionais com versão e auditoria próprias, usando updateMany por projectId/version. Motivo: evitar sobrescrita entre checklists, resposta crítica e avanço.
- Decisão: catálogo versionado compartilhado, respostas relacionais e não aplicável justificado. Motivo: gates conhecidos pelo backend e rótulos iguais no frontend.
- Decisão: resposta positiva cria uma pendência por pergunta, e nunca apaga uma pendência se resposta mudar. Motivo: preservar rastreabilidade e evitar duplicação.
- Decisão: previsão própria de mobilização para marcos, sem alterar datas reais de Project ou equipe. Motivo: planejamento progressivo e segregação das fontes.
- Pesquisa via grafo da main e leitura direcionada: efetivo/access.js, planning/plan-context.js, planning/errors.js, resources/efetivo.js, Modal.tsx, MissionCompletionModal.tsx, driver.js e efetivoGuideCoordinator.ts. Worktree nova tem grafo vazio; baseline main usado para relações existentes.
- Hooks: .specify/extensions.yml ausente. Sem hooks antes/depois das skills.
- Nenhuma dependência nova ou investigação externa necessária: seguir versões instaladas e padrões locais.
