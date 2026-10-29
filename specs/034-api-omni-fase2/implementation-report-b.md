# Relatório — Entrega B (2026-10-29)

## Entregue

B1–B5 implementados: medição em coleção/detalhe, notas ligadas ao projeto atual,
romaneios de saída/retorno, pendências agregadas e histórico de descarga.
Confirmação na interface do Efetivo e API com idempotência/simulação da spec 035.
Importação explícita de CT-e do Omie por ID conhecido, separada do faturamento.

Catálogo 2026-10-29.2, 51 escopos AVAILABLE, 54 operações, OpenAPI 1.10.0,
envelope schemaVersion 1.0. Nenhuma credencial real alterada; sem deploy.
Migration 20261029160000_omni_delivery_b criada e aplicada somente a banco descartável.

## Escopos finais

- efetivo.projetos.medicao.read — INTERNAL; sem dependências.
- efetivo.projetos.medicao.valores.read — FINANCIAL; exige o anterior.
- omie.notas.read — FINANCIAL; sem dependências.
- romaneios.read — INTERNAL; sem dependências. romaneios.itens.read permanece futuro.
- omie.pendencias.read — FINANCIAL; sem dependências.
- logistica.descargas.read — PERSONAL; sem dependências.
- logistica.descargas.create — PERSONAL; sem dependência implícita de leitura.

O feed continua exigindo eventos.read mais o escopo de leitura do recurso.
Eventos acrescentados: medicao.alterada, nota.emitida, nota.recebimento_alterado,
pendencia.alterada, descarga.confirmada. romaneio.emitido passa a exigir
romaneios.read e também cobre retorno. Não há backfill.

## Campos e decisões para o Omni

- B1 conserva todos os nomes solicitados; valores financeiros omitidos sem escopo.
  Datas ISO UTC, moeda BRL, valores como strings decimais. Inclui SEM_MEDICAO.
- B2 conserva os nomes solicitados. Ligação exata codigoProjeto → OmieProject.codigo
  → projectId, sem inferir por nome/OS. Cargas idênticas mantêm watermark/eventos;
  upsert em lotes mantém desempenho do snapshot e remove ausentes atomicamente.
- B3 conserva os nomes solicitados; quantidadeItens conta linhas, pesoCarga é decimal
  como string; dados de motorista/placa/assinaturas/arquivos ficam fora.
- B4 cada aPagar/aReceber tem **quantidade, valorEmAberto, proximoVencimento**.
  Valor BRL como string decimal; zero "0.00" sem pendências. Saldo parcial sem dado
  confiável resulta em valorEmAberto null; o Omni não deve interpretar como quitado.
- B5 acrescenta id, projectCode e updatedAt à leitura solicitada, para deduplicação
  e sincronização. cte é null ou **numero, emissao, transportadora**. POST conserva
  romaneioId,tipo,confirmadaEm,confirmadaPorEmail. 201/replay; conflito 409;
  CONFIRMING_USER_NOT_ALLOWED 422 para usuário ausente, inativo, ambíguo ou sem acesso.
  TOTAL repetido reutiliza a confirmação original, sem novo evento. PARCIAL mantém
  histórico, deduplicado por romaneio/tipo/instante; não pode ocorrer após TOTAL.
- Prefer: validate-only e credencial SIMULATE usam operação logistics.unloadings.create.
  would tem romaneioId,tipo,confirmadaEm,confirmadaPorEmail, sem IDs temporários.

Na interface: Efetivo → missão → Ver romaneios → Chegada e descarga. O usuário da
sessão confirma com horário atual. Importar CT-e antes de confirmar; uma referência
inequívoca é capturada no histórico. ID opcional da NF é validado no mesmo projeto;
referência histórica não depende da permanência da NF no snapshot fiscal.

## Validação

- Backend completo com PostgreSQL/Python e configuração equivalente ao CI: 2.577 testes,
  2.551 aprovados, 26 opcionais ignorados, zero falhas. Inclui cenários adicionais de
  rollback de medição, isolamento na escrita e upsert fiscal em lote.
- Matriz de simulação cobre as seis escritas, com HTTP/Prisma/PGlite e comparação
  de todas as tabelas de domínio, contadores, recibos, feed e efeitos externos.
- Testes da Entrega B exercitam HTTP Bearer, projeções/403, recorte antes da paginação,
  notas sem vínculo, remapeamentos, primeira publicação, no-op, saldos exatos/zeros,
  histórico parcial/total, CT-e/XML, acesso por e-mail e rollback.
- PostgreSQL 16 descartável: todo o histórico de migrations aplicado por prisma:deploy.
  Dois testes reais aprovados, incluindo ordem de commit/retomada e confirmações
  concorrentes pela mesma credencial e por credenciais distintas, sem duplicar eventos.
- Frontend completo: 863 aprovados, incluindo histórico, bloqueio após total e horário
  de São Paulo. Lint, build e as quatro regressões Chromium do CI aprovados.
- Jobs PostgreSQL reproduzidos: Omni 31/31; contribuições 106 aprovados e um opcional
  ignorado; planejamento CRM 20/20; notificações 14/14; equipamentos RDO 7/7.
- Data Book Python: 22 aprovados e um ignorado por ausência de referência local.
  Builds Docker backend/nginx, checks HTTPS/IP e auditorias npm no nível high aprovados.
- Prisma validate/generate, architecture:check, OpenAPI/Playground e diff --check aprovados.
- Revisão por detect_changes/get_review_context/get_affected_flows e conferência na
  fonte. O grafo não representa toda a cobertura via HTTP/PGlite e gatilhos SQL.
- Drift: comparar o banco migrado com schema.prisma acusa divergências preexistentes
  (enum EfetivoMissionStage.DEMOBILIZATION, defaults, FKs e nomes longos de índices).
  Comparação com cópia anterior do schema e banco sem estruturas B produz o MESMO SQL
  de drift. A Entrega B não acrescenta diferenças. Não foram alterados itens fora do escopo.

## Limites e trabalho posterior

CT-e é consultado por ID conhecido via ObterCTe em /produtos/dfedocs/; sem descoberta
ou varredura automática. A documentação consultada em /produtos/cte/ fornece
ListarNFeTransp, que lista NF-e. Fonte oficial:
https://app.omie.com.br/api/v1/produtos/dfedocs/.
Sem CT-e único vinculado no momento da confirmação, cte fica null. Não escolher um
transportador por aproximação nem retroativamente alterar histórico confirmado.

B6: US6 (condições), demais agregações da US7 e responsáveis estruturados da US8
permanecem planejados. US4 dispensada. Migração/publicação e concessão dos escopos
ao token Omni – desenvolvimento permanecem ações operacionais posteriores.
