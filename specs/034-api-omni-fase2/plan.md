# Implementation Plan: Omni fase 2 — Entrega A

**Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

## Escopo e ordem

Implementar US1, US2 e US3 conforme `../omni/docs/integracoes/prompt-filtroapp-fase2.md`.
Primeiro contratar API e persistência; depois migration, serviços, rotas, catálogo,
Playground, OpenAPI e testes. Mudanças aditivas; schemaVersion permanece 1.0.

## Decisões

- Feed próprio IntegrationEvent, independente de NotificationEvent e leitura humana.
  Gatilhos PostgreSQL registram mudanças de Report, ProjectWorkflow, QualityRecord,
  QualityEvidence, Romaneio e Project na mesma transação. Evidências e registro
  compartilham uma marca local à transação para evitar eventos/auditoria duplicados.
  Sem backfill de eventos anteriores.
- Contador transacional global bloqueado até commit: evita que uma transação confirme
  sequência maior antes de outra e seja pulada pelo cursor. IDs `evt_<UUID>`;
  a sequência interna não é exposta nos itens para não revelar contagem de outros projetos.
- Janela pública de 30 dias, sem apagar eventos nesta entrega (retenção física maior
  é permitida). Cursor assinado, vinculado à credencial, política e escopos; cursor
  atrasado retorna 410 CURSOR_EXPIRED. Cursor terminal sempre retornado para polling.
  Sem cursor começa na janela; feed é vivo, não snapshot congelado. IDs são deduplicáveis.
- Filtrar tipos pelos escopos de recurso e projetos antes de limitar/paginar. Romaneio
  é persistido, mas permanece invisível enquanto romaneios.itens.read estiver bloqueado.
- Rascunhos vivem em ReportDraft e nunca entram no feed nem na consulta de Report.
  Envio inicial e reenvio para PENDING geram rdo.criado. Saída OUTBOUND é emitida
  quando recebe documento (PDF/DOCX); edição posterior não reemite.
- Novo escopo de RDO é independente do anterior e suficiente para a mesma listagem.
  Campos submittedAt/signedAt persistidos por gatilho; legado usa createdAt e datas
  de assinatura/auditoria disponíveis. updatedAt muda em toda transição de status.
  approvedAt já faz parte do contrato anterior e permanece nele.
- Qualidade entra em EM_TRIAGEM sem natureza, permitido pelo schema atual. Usar a
  mesma numeração transacional. Resolver User ativo por email sem diferenciar caixa;
  ambiguidade retorna 422. Manter actionOwner textual e actionOwnerUserId como FK.
- Idempotência durável por credencial+UUID, com bloqueio da credencial na transação,
  hash canônico do corpo e resposta armazenada. Sem prazo de expiração nesta entrega.
  ExternalRef é persistida; origin é fixo OMNI e corpo estrito rejeita origin enviado.
- Auditoria de Qualidade comum à interface e API por gatilho, com usuário ou credencial
  e origem. Não atribuir ação da API ao administrador que emitiu a credencial.
- Cotas mantêm o mesmo contrato, com update neutro no upsert para usar ON CONFLICT
  nativo e evitar colisão no primeiro par de requisições simultâneas.

## Contrato visual

Como na 033, o catálogo e o formulário existentes recebem descritores. O header
Idempotency-Key usa o mesmo controle genérico; a confirmação de POST já existente
é preservada. Sem nova página, navegação, identidade visual ou campanha de novidade.

## Entrega B — apenas planejamento

US5: projetar histórico de chegada/descarga parcial e total e vínculo CT-e do Omie.
US6/US7: contratar condições mínimas e agregações de Gestão com recorte por projeto.
US8: planejar FKs de vendedor/documentação/mobilização e data independente de viagem.
US4 é dispensada pelo Omni, que mantém calendário próprio. Nenhum desses escopos é liberado.

## Validação

node --test para serviços, rotas, escopos, paginação/retomada, idempotência concorrente,
auditoria e rollback dos gatilhos em PostgreSQL via PGlite. Suítes de contrato
OpenAPI/Playground e regressões anteriores; Prisma validate/generate;
npm run architecture:check e verificações frontend quando houver mudança.
