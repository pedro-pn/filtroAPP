# Remover o webhook de projetos (`/api/webhooks/projects`)

- **Data:** 2026-11-25
- **Decisão:** remover o webhook de recebimento de projetos — o caminho original `POST /api/webhooks/projects` (spec 009, ago/2026) e a versão `POST /api/webhooks/v1/projects` criada na fase 4 da spec 042 (#658) — junto com o token `PROJECT_INTAKE_WEBHOOK_TOKEN`, a variável `PROJECT_WEBHOOK_LEGACY_SUNSET`, o contador de uso e o card "Webhook do PrismaCRM" do painel de Operações. A lógica de recebimento (`receiveProjectIntake` em `backend/src/lib/projects/project-intake.js`) **fica**, porque é usada pela API de integração v1 e pelos eventos de planejamento do CRM.
- **Contexto:** a auditoria dos 13 pilares atribuiu o webhook ao ComercialAPP e a fase 4 da spec 042 o versionou. Conferido em 2026-11-25: o ComercialAPP só chama `/api/acompanhamento/comercial/comercialapp/*`, e o PrismaCRM — o único cliente externo que cria projetos — usa `POST /api/integracoes/v1/efetivo/projetos` (credencial "Prisma CRM", escopo `efetivo.projetos.create`) desde outubro.
- **Evidências:**
  - os 5 projetos criados por integração desde 2026-11-04 (5857, 5858, 5859, 5860, 5861) correspondem a chamadas `efetivo.projects.create` registradas em `ApiRequestLog`;
  - os outros 4 projetos com `integrationDefaults` (5824, 5839, 5855, 9997) são manuais: `values` vazio e só `overrides` de edição pelo gestor;
  - o contador de uso do caminho antigo (#658, em produção desde 2026-11-25) não registrou chamadas;
  - o desenvolvedor do PrismaCRM confirmou que o código ativo não chama o webhook.
- **Critério da régua:** 7.6 já estava atendido pela API `/api/integracoes/v1`; 8.5 (nenhum endpoint aberto sem necessidade) passa a valer também para este caminho.
- **Riscos aceitos:** não há log de acesso completo (o Caddy registra só erros e os logs do nginx/backend são recriados a cada deploy), então um chamador desconhecido em ago–set não pode ser descartado. Mitigação: o token foi desativado em produção antes do merge (o endpoint respondia 503) e o PR só é mesclado depois de duas semanas sem reclamação.
- **Quando revisar:** se algum sistema voltar a precisar criar projetos fora da API v1 — nesse caso, usar uma credencial da API v1 com o escopo `efetivo.projetos.create`, e não reabrir o webhook.
