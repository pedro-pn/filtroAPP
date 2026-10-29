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

## Backlog original após Entrega A (substituído pelo plano B abaixo)

US5: projetar histórico de chegada/descarga parcial e total e vínculo CT-e do Omie.
US6/US7: contratar condições mínimas e agregações de Gestão com recorte por projeto.
US8: planejar FKs de vendedor/documentação/mobilização e data independente de viagem.
US4 é dispensada pelo Omni, que mantém calendário próprio. Nenhum desses escopos é liberado.

## Validação

node --test para serviços, rotas, escopos, paginação/retomada, idempotência concorrente,
auditoria e rollback dos gatilhos em PostgreSQL via PGlite. Suítes de contrato
OpenAPI/Playground e regressões anteriores; Prisma validate/generate;
npm run architecture:check e verificações frontend quando houver mudança.

## Entrega B — implementação (2026-10-29)

Ordem contratada: B1 medição → B2 notas → B3 romaneios → B4 pendências → B5 descarga/CT-e.
B6 (US6, demais escopos de US7 e US8) permanece em backlog; US4 dispensada.

- Leituras registradas em operational-resources.js, catálogo, OpenAPI e Playground.
  Coleções usam cursor assinado e filtros comuns antes do limite. Sem contagens globais.
- B1 inclui projetos sem medição (SEM_MEDICAO). Datas definem a situação, com prioridade
  approvedAt > sentAt > preparedAt. Saldo compara decimais; valores BRL somente com
  efetivo.projetos.medicao.valores.read, dependente do escopo base. Mudanças na medição
  atualizam o watermark do projeto e emitem medicao.alterada transacionalmente.
- B2 liga OmieInvoice.codigoProjeto = OmieProject.codigo → OmieProject.projectId.
  Sem vínculo atual, projeto excluído ou fora do recorte: excluir antes da paginação.
  Snapshot fiscal mantém upserts estáveis e remove ausentes atomicamente após leitura
  completa; syncedAt não representa mudança de negócio. Ledger interno conserva a
  primeira publicação por nota/projeto, inclusive após cancelamento/reimportação.
  Gatilhos emitem nota.emitida e nota.recebimento_alterado sem duplicar a cada sync.
- B3 projeção agregada de Romaneio com quantidade de linhas, sem pessoas/arquivos.
  Emissão de saída e retorno; eventos anteriores preservados, sem backfill.
- B4 somente agregado por projeto, inclusive zeros. Valores decimais em BRL;
  títulos cancelados/quitados excluídos, parcial usa saldo confiável do payload.
  Ausência de saldo parcial confiável deve ser explícita (valor nulo), nunca zero.
  Mudanças e exclusões financeiras atualizam watermark e evento pendencia.alterada.
- B5 histórico imutável PARCIAL/TOTAL por saída, confirmação de usuário ativo com
  acesso ao projeto; interface usa a sessão, integração resolve email sem caixa.
  Recibo durável por credencial+UUID e chave natural evitam duplicação; TOTAL encerra
  a trilha. Auditoria e evento descarga.confirmada na mesma transação, rollback 035.
- CT-e separado de OmieInvoice. A API Omie documenta ObterCTe por nIdCTe em
  /produtos/dfedocs/, mas não listagem de CT-es em /produtos/cte/ (ListarNFeTransp
  lista NF-e). Importação explícita por ID Omie e romaneio selecionado, com XML
  validado e vínculo fiscal explícito; não inventar endpoint de descoberta automática.
  Fonte: https://app.omie.com.br/api/v1/produtos/dfedocs/.
- Migração aditiva; sem deploy nem alteração de tokens reais. schemaVersion 1.0.

Validação: testes reais Prisma/PGlite para filtros, paginação, gatilhos/no-op/rollback,
remapeamento fiscal, idempotência e simulação; contratos; arquitetura; suítes backend
frontend e Prisma validate/generate. UI segue controles compartilhados e novidade 10 dias.
