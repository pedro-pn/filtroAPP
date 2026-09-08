# Research: Relatórios de Manutenção e Produção

## Decisão 1 — Reutilizar `Report` somente para o cabeçalho dos RDOs

- **Decision**: Adicionar `RDO_MAINTENANCE` e `RDO_PRODUCTION` ao tipo de relatório. Jornada, colaboradores, projeto, sequência e estado continuam em `Report`; manutenções e limpezas químicas ficam em tabelas próprias.
- **Rationale**: Reaproveita cálculo de horas, filtros e vínculo com projeto sem comprimir dados técnicos em `ReportService.extraData`.
- **Alternatives considered**: Usar `ReportService` tornaria histórico e documento frágeis; criar outro cabeçalho duplicaria jornada.

## Decisão 2 — Isolar as rotas operacionais do pipeline documental legado

- **Decision**: Criar `operational-reports.js` montado no namespace RDO, com schemas, autorização e transições próprias.
- **Rationale**: O roteador legado dispara relatórios derivados, versões, assinaturas, e-mails e PDF geral, efeitos proibidos para estes fluxos.
- **Alternatives considered**: Acrescentar condicionais ao roteador de mais de sete mil linhas aumentaria o risco de efeitos colaterais.

## Decisão 3 — Permissões de emissão como capacidades explícitas

- **Decision**: Persistir enum list (`SITE_RDO`, `MAINTENANCE`, `PRODUCTION`) em `User`, serializar no usuário público e editar por checkboxes independentes.
- **Rationale**: São capacidades ortogonais ao papel do módulo RDO, cujo seletor atual força um único papel por módulo.
- **Alternatives considered**: Novos `ModuleRoleCode` conflitam com a seleção exclusiva; booleans dificultam extensão uniforme.

## Decisão 4 — Backfill conservador

- **Decision**: Conceder `SITE_RDO` às contas internas/admin existentes com papel interno do RDO; nunca conceder manutenção ou produção automaticamente.
- **Rationale**: Mantém acesso vigente sem expor os novos fluxos.
- **Alternatives considered**: Default global alcançaria clientes; ajuste manual bloquearia emissores atuais.

## Decisão 5 — Manutenção como entidade uniforme

- **Decision**: `MaintenanceRecord` usa `reportId` opcional. Vinculada, sincroniza estado/data com RDO 5002; avulsa usa a mesma entidade sem rótulo de origem.
- **Rationale**: Histórico, documento e estatísticas consultam uma única fonte.
- **Alternatives considered**: Tabelas separadas duplicariam regras e consultas.

## Decisão 6 — Snapshots históricos

- **Decision**: Persistir nomes/ordem dos serviços, perfil, nome e assinatura do supervisor no momento da aprovação.
- **Rationale**: Configurações futuras não podem reescrever histórico e documento aprovado.
- **Alternatives considered**: Resolver relações ao baixar alteraria documentos antigos.

## Decisão 7 — Perfis normalizados

- **Decision**: Usar `MaintenanceProfile` e `MaintenanceProfileItem`, associar o perfil ao equipamento e semear os dez perfis revisados.
- **Rationale**: UFP pneu/regular e ULQ diesel/regular tornam-se configuração editável, não regras ocultas por TAG.
- **Alternatives considered**: Inferência por prefixo/TAG impediria ajustes administrativos.

## Decisão 8 — Documento robusto ao modelo oficial

- **Decision**: Clonar linhas de checklist/terceiros no DOCX, substituir tokens tolerando `{{tag}}}`, inserir fotos/assinatura e converter pelo pipeline existente.
- **Rationale**: Preserva o layout e absorve inconsistências sem editar o binário do usuário.
- **Alternatives considered**: PDF direto perde fidelidade; correção manual do modelo cria dependência.

## Decisão 9 — Aprovação idempotente

- **Decision**: Preparar PDFs, aplicar transição condicional e criar anexos com unicidade lógica, limpando arquivos em falha.
- **Rationale**: Evita aprovação parcial visível e documentos duplicados em retry/concorrência.
- **Alternatives considered**: Job assíncrono deixaria manutenção aprovada sem documento.

## Decisão 10 — Indicadores na resposta da Sede

- **Decision**: Preservar cards financeiros e adicionar seção `operational` ao endpoint atual, usando o mesmo período.
- **Rationale**: Um filtro controla toda a aba sem misturar kg/manutenção com dinheiro.
- **Alternatives considered**: Endpoint separado duplicaria estado; converter em custo viola escopo.

## Decisão 11 — Formulário operacional separado

- **Decision**: O fluxo tradicional mantém somente obra; o novo módulo abre manutenção/produção diretamente e reutiliza o componente React Hook Form + Zod já implementado.
- **Rationale**: Reduz regressão no formulário legado grande, elimina a escolha transversal e mantém equipes sem essas permissões totalmente alheias aos fluxos internos.
- **Alternatives considered**: Ramificar cada estado do componente atual aumenta complexidade.

## Decisão 12 — Sem novas bibliotecas

- **Decision**: Reutilizar Prisma, Zod, React Hook Form, TanStack Query, AdmZip, xmldom, driver.js e armazenamento existentes.
- **Rationale**: A stack cobre validação, estado, documento, imagem e tutorial.
- **Alternatives considered**: Novo templating DOCX duplicaria capacidade instalada.

## Decisão 13 — Módulo próprio e abas por capacidade

- **Decision**: Registrar “Manutenção e produção” como módulo independente e derivar abas visíveis estritamente de `MAINTENANCE` e `PRODUCTION`. Supervisor, gestor ou ADMIN também precisa da permissão da área; `canReviewMaintenance` e `canReviewProduction` continuam restringindo aprovação/devolução.
- **Rationale**: Separa a operação do RDO de obra, mantém a visibilidade administrável pelas duas permissões pedidas e evita que emissão implique aprovação.
- **Alternatives considered**: Manter seletor em “Novo relatório” expõe tipos irrelevantes; criar papéis novos duplicaria capacidades já modeladas.

## Decisão 14 — Histórico consolidado como projeção de manutenção

- **Decision**: Consultar `MaintenanceRecord` aprovado diretamente, com paginação, busca normalizada por equipamento/categoria e inclusão do documento, sem criar tabela ou duplicar dados.
- **Rationale**: Registros vinculados e avulsos já compartilham a mesma entidade e os snapshots existentes preservam a informação histórica.
- **Alternatives considered**: Materializar outro histórico criaria sincronização e risco de divergência; agregar pelo frontend impediria paginação eficiente.
