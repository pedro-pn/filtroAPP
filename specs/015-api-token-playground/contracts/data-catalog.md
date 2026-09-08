# Catálogo de dados para API de integração

## Finalidade e regra de publicação

Este catálogo cobre os **126 modelos Prisma** existentes em `backend/prisma/schema.prisma` em 2026-09-04. Ele responde quais dados podem ser avaliados para endpoint, quais exigem revisão reforçada e quais nunca devem ser expostos por tokens desta funcionalidade.

Mapeamento não concede acesso. Um escopo só aparece habilitado no painel quando estiver `DISPONÍVEL` e possuir contrato versionado, projeção por allowlist, autorização, limites, auditoria e testes de concessão/negação.

### Estados

- **DISPONÍVEL**: endpoint homologado e escopo concedível. Na primeira entrega, somente Qualidade.
- **PLANEJADO**: candidato legítimo a leitura, ainda sem endpoint externo homologado.
- **SENSÍVEL**: candidato condicionado a finalidade específica, minimização e aprovação de privacidade/negócio.
- **RESERVADO**: dado operacional ou administrativo interno; não entra na API geral e exige uma especificação própria para mudar de estado.
- **PROIBIDO**: segredo, credencial, material criptográfico, trava/contador interno ou detalhe de infraestrutura que não pode virar campo/escopo desta API.

Quando um modelo mistura campos, a coluna descreve a classificação por subconjunto. Toda futura projeção deve listar os campos, nunca retornar o modelo integral.

## Matriz completa por domínio

**Atualização 2026-09-08:** a matriz abaixo preserva a classificação inicial de 2026-09-04. O primeiro subconjunto operacional (15 coleções, 12 escopos) está em [operational-read.md](operational-read.md); a expansão autorizada de relatórios, estoque e manutenção (13 coleções, 3 downloads e 16 escopos) está em [operational-expanded-read.md](operational-expanded-read.md). São 33 escopos disponíveis no total e 49 candidatos bloqueados. O catálogo executável marca somente os modelos/projeções contratados como disponíveis; disponibilidade não concede todos os campos de um modelo.

| # | Domínio e modelos cobertos | Estado por subconjunto | Escopos candidatos | Projeção mínima candidata | Exclusões obrigatórias |
|---|---|---|---|---|---|
| 1 | **Pessoas, cargos e acesso** — `Collaborator`, `CollaboratorJobRoleHistory`, `CollaboratorSignatureNoticeLog`, `JobRole`, `User`, `ModuleRole`, `ProjectAuthorizedUser` | `JobRole` e identificação operacional de `Collaborator`: PLANEJADO; histórico funcional e diretório de usuários: SENSÍVEL; logs de aviso/autorizações/admin: RESERVADO | `colaboradores.operacional.read`, `colaboradores.pii.read`, `cargos.read`, `usuarios.diretorio.read` | IDs estáveis, código/nome operacional, cargo, ativo; usuário por nome/status/papéis somente se justificado | senha/hash, assinatura/imagem, documento, e-mail/telefone sem escopo PII, preferências de segurança, metadados de sessão, conteúdo de notificações |
| 2 | **Projetos, clientes e configurações** — `ClientSegment`, `Project`, `AcompanhamentoSetting`, `EfetivoSetting` | Projeto e segmento: PLANEJADO; configurações globais: RESERVADO | `projetos.read`, `clientes.segmentos.read`, `projetos.contatos.read` | id, código, nome, status, segmento, local e datas; contato somente em escopo sensível separado | CNPJ, e-mail, telefone, códigos externos e configurações internas sem finalidade explícita |
| 3 | **Ponto e presença** — `CollaboratorAbsence`, `PontoImport`, `PontoPeriodSummary`, `PontoNameAlias`, `PontoSyncRun`, `PontoSyncState`, `PontoExternalEmployeeLink`, `PontoExternalEmployee`, `PontoProjectTagAlias`, `PontoIgnoredProjectTag`, `PontoDayProjectOverride` | Resumos e ausências: SENSÍVEL; importação, pessoas externas, aliases, override e sincronização: RESERVADO | `ponto.resumos.read`, `ponto.ausencias.read`, `ponto.sincronizacoes.read` | totais por período/projeto e estado resumido de sincronização; ausências apenas com finalidade de RH | arquivo/payload bruto, hash de arquivo, erros brutos, identificadores externos pessoais, justificativas/documentos médicos, aliases e regras internas |
| 4 | **Planejamento de efetivo** — `EfetivoPlan`, `EfetivoMissionPlan`, `EfetivoMissionCycle`, `EfetivoMissionDemand`, `EfetivoMissionAllocation`, `EfetivoAllocationCycle`, `EfetivoPlannedHire`, `WorkforceHoliday`, `WorkforceCalendarState`, `EfetivoAuditEvent` | Planos/demandas/feriados: PLANEJADO; alocações e contratações: SENSÍVEL; estado de calendário: PROIBIDO; auditoria: RESERVADO | `efetivo.planos.read`, `efetivo.demandas.read`, `efetivo.alocacoes.read`, `efetivo.contratacoes.read`, `efetivo.feriados.read` | períodos, missões, quantidade/posição, capacidade e alocação operacional minimizada | salários/custos pessoais, observações livres com PII, estado técnico, evento bruto e dados de ator sem escopo de auditoria |
| 5 | **Acompanhamento e custos** — `CostProfile`, `CostParameterSet`, `ProjectManualProgressHistory`, `ProjectManualCost`, `ProjectManagementNote`, `AcompanhamentoMissionGroup`, `AcompanhamentoMissionGroupMember` | Progresso e grupos: PLANEJADO; custo, parâmetros e notas: SENSÍVEL | `acompanhamento.progresso.read`, `acompanhamento.grupos.read`, `acompanhamento.custos.read`, `acompanhamento.notas.read` | progresso por projeto/período, agrupamentos e valores consolidados conforme finalidade | margens/precificação sem escopo financeiro, notas livres com PII, parâmetros internos e identidade do editor sem necessidade |
| 6 | **RDO e relatórios** — `DdsTheme`, `ProjectReportSeq`, `Report`, `ReportApprovalPostProcessingJob`, `ClientReportReview`, `ReportVersion`, `ReportSignature`, `ReportAuditLog`, `ReportCollaborator`, `ReportService`, `ReportDraft`, `ReportAttachment` | Relatórios/versões/serviços/DDS: PLANEJADO; assinaturas, revisões e auditoria: SENSÍVEL; sequência/job/rascunho: RESERVADO ou PROIBIDO; anexo: SENSÍVEL | `rdo.relatorios.read`, `rdo.versoes.read`, `rdo.equipe.read`, `rdo.servicos.read`, `rdo.dds.read`, `rdo.anexos.metadata.read`, `rdo.anexos.download`, `rdo.assinaturas.read`, `rdo.auditoria.read` | dados operacionais aprovados, projeto, data, serviço, equipe minimizada e metadado de anexo | contador sequencial, payload/job, rascunho não publicado, caminho do arquivo, token/link permanente, imagem da assinatura, IP/user-agent e prova de assinatura por padrão |
| 7 | **Manutenção e produção** — `MaintenanceProfile`, `MaintenanceProfileItem`, `MaintenanceConfiguration`, `MaintenanceRecord`, `MaintenanceThirdPartyService`, `MaintenanceAttachment`, `ChemicalCleaning`, `OperationalReviewAudit` | Perfis, registros, serviços e limpeza química: PLANEJADO; configuração: RESERVADO; anexos e auditoria: SENSÍVEL | `manutencao.registros.read`, `manutencao.perfis.read`, `manutencao.terceiros.read`, `producao.limpezas.read`, `manutencao.anexos.metadata.read`, `manutencao.anexos.download`, `manutencao.auditoria.read` | identificação, projeto, datas, equipamento, execução, resultado e estado de revisão | caminhos, arquivos sem endpoint autenticado, valores/contatos de terceiro sem finalidade, payload de auditoria e campos internos de configuração |
| 8 | **Equipamentos, calibração e inibição** — `Equipment`, `InhibitionVessel`, `InhibitionSystem`, `Unit`, `Manometer`, `ParticleCounter`, `CalibrationCertificate`, `CalibrationNotificationLog`, `EquipmentCategory`, `CompanyEquipment`, `EquipmentNotificationRecipient`, `EquipmentNotificationConfig`, `RdoEquipmentSlot`, `EquipmentAttachment` | Cadastros, categorias, unidades e certificados: PLANEJADO; destinatários/configurações/logs: RESERVADO; documentos e anexos: SENSÍVEL | `equipamentos.read`, `equipamentos.categorias.read`, `equipamentos.calibracoes.read`, `equipamentos.certificados.metadata.read`, `equipamentos.documentos.download`, `equipamentos.inibicao.read` | patrimônio/identificação técnica, categoria, condição, calibração e validade | e-mails de notificação, regras internas, caminho/URL/token de arquivo, logs de envio, anexos sem escopo, relação interna de slot sem necessidade |
| 9 | **Estoque** — `StockItem`, `StockItemDocument`, `StockCategory`, `StockBatch`, `StockMovement` | Cadastro/categoria/lote/movimento: PLANEJADO; documentos e custos: SENSÍVEL | `estoque.itens.read`, `estoque.lotes.read`, `estoque.movimentos.read`, `estoque.documentos.metadata.read`, `estoque.documentos.download`, `estoque.custos.read` | item, unidade, categoria, lote, validade, quantidades e movimento | custo sem escopo financeiro, nota livre com PII, caminho/token de documento e identidade de ator por padrão |
| 10 | **Qualidade** — `QualityNature`, `QualityRecord`, `QualityEvidence`, `QualityRecordSeq` | Natureza/registro: DISPONÍVEL; evidência: DISPONÍVEL por escopos separados; sequência: PROIBIDO | `qualidade.naturezas.read`, `qualidade.registros.read`, `qualidade.evidencias.metadata.read`, `qualidade.evidencias.download`, `qualidade.excluidos.read` | contrato detalhado na seção “Qualidade v1” | `storagePath`, `publicToken`, sequência interna, relações de usuário completas, hash/segredo e arquivo sem autorização |
| 11 | **EPI** — `EpiCatalogItem`, `EpiRecord`, `EpiSignatureRequest`, `EpiCollaboratorProfile`, `EpiSignatureRequestAuditLog` | Catálogo e entrega minimizada: PLANEJADO/SENSÍVEL; perfil, solicitação e auditoria de assinatura: RESERVADO | `epi.catalogo.read`, `epi.entregas.read`, `epi.documentos.download` | EPI, quantidade, datas, colaborador por ID/nome operacional e situação de entrega | token/hash, assinatura/imagem, CPF, IP/user-agent, caminho de PDF, erro/log de envio e perfil de assinatura |
| 12 | **Romaneios** — `Romaneio`, `RomaneioItem`, `RomaneioChecklist`, `RomaneioCatalogItem`, `RomaneioCatalogSyncState`, `RomaneioNotificationRecipient` | Romaneio/item/checklist/catálogo: PLANEJADO; estado de sync: PROIBIDO; destinatários: RESERVADO | `romaneios.read`, `romaneios.itens.read`, `romaneios.checklist.read`, `romaneios.catalogo.read`, `romaneios.documentos.download` | identificação, projeto, datas, itens, quantidades e checklist | sequência/estado técnico, e-mails de notificação, payload de sincronização e caminho/token de documento |
| 13 | **Relatórios de alocação e entregas** — `AllocationReportRecipient`, `AllocationReportDelivery`, `AllocationReportRecipientDelivery` | Entrega agregada: PLANEJADO; destinatários e detalhe de envio: RESERVADO/SENSÍVEL | `alocacao.relatorios.read`, `alocacao.entregas.read` | período, projeto, situação, contagens e timestamps de entrega | e-mail/destinatário por padrão, mensagem de erro bruta, conteúdo do arquivo e configuração de distribuição |
| 14 | **Operações, retenção e jobs** — `DataRetentionRun`, `JobRun`, `JobLock`, `IntegrationSyncRun` | Estados sanitizados de execução/sync: RESERVADO; trava: PROIBIDO | `operacoes.jobs.read`, `operacoes.integracoes.read`, `operacoes.retencao.read` | nome conhecido, início/fim, situação, totais e erro redigido | lock/lease, stack trace, segredo/configuração, payload/raw metadata, comando e caminho de backup |
| 15 | **Pesquisa de satisfação** — `SatisfactionSurvey`, `SatisfactionSurveyQuestion` | Agregados anônimos: PLANEJADO; respostas individuais/identidade: SENSÍVEL | `pesquisas.agregados.read`, `pesquisas.respostas.read` | pergunta, período, contagem e métricas; resposta individual apenas com base/finalidade aprovada | token/hash/material criptográfico, destinatário/contato, vínculo identificável, IP/user-agent e texto livre sem revisão |
| 16 | **Autenticação e tokens internos** — `NotificationPreferenceToken`, `PasswordResetToken`, `EmailChangeToken`, `UserSession` | PROIBIDO | nenhum | nenhuma | todos os campos; nem hash, seletor, validade, sessão, e-mail pendente ou metadados viram endpoint de integração |
| 17 | **Privacidade/LGPD** — `DataSubjectRequest`, `DataSubjectRequestResponseAttempt` | RESERVADO e SENSÍVEL; fora da API geral | eventual `privacidade.solicitacoes.read` somente após especificação jurídica própria | nenhuma na v1 | identidade/contato do titular, documento, prova, anexos, resposta, tentativas de entrega, IP/user-agent, justificativas e trilha completa |
| 18 | **Comercial, orçamento e planejamento** — `CommercialProposal`, `AccessImport`, `ProjectBudget`, `ProjectAdditionalProposal`, `ProjectPlannedService`, `ProjectPlannedServiceSystem`, `ProjectPlannedNormalHours`, `ProjectPlannedOvertime` | Proposta/orçamento/horas/custos: SENSÍVEL; importação bruta: RESERVADO | `comercial.propostas.read`, `comercial.orcamentos.read`, `comercial.servicos-planejados.read`, `comercial.horas.read`, `comercial.contatos.read` | projeto, versão, estado, composição e valores somente conforme finalidade financeira | `rawRow`, arquivo/hash de importação, contato/e-mail/CNPJ sem escopo, observação livre, custo/margem sem escopo e identidade interna desnecessária |
| 19 | **Integração Omie** — `OmieProject`, `OmieCategory`, `OmiePurchase`, `OmieReceivable` | Projetos/categorias: PLANEJADO; compras/recebíveis: SENSÍVEL | `omie.projetos.read`, `omie.categorias.read`, `omie.compras.read`, `omie.recebiveis.read` | IDs externos necessários, projeto/categoria, documento, datas, situação e valores com escopo financeiro | credencial Omie, payload bruto, logs técnicos, dados bancários/fiscais excessivos e contato sem finalidade |
| 20 | **Assinaturas avulsas** — `SignatureDocument`, `SignatureDocumentSigner`, `SignatureDocumentField`, `SignatureDocumentAuditLog`, `SignatureDocumentFilePurge`, `SignatureDocumentCompletionNotification` | Documento/status/campos: SENSÍVEL; auditoria, purge e notificação: RESERVADO | `assinaturas.documentos.read`, `assinaturas.signatarios.read`, `assinaturas.campos.read`, `assinaturas.arquivos.download`, `assinaturas.auditoria.read` | título, estado, datas, signatários minimizados e definição de campos quando justificado | token/hash/cifra/IV/auth tag, assinatura desenhada, CPF/documento, IP/user-agent, caminho do arquivo, prova integral, erro e configuração de notificação |

**Cobertura**: 7 + 4 + 11 + 10 + 7 + 12 + 8 + 14 + 5 + 4 + 5 + 6 + 3 + 4 + 2 + 4 + 2 + 8 + 4 + 6 = **126 modelos**.

## Famílias de endpoints candidatas

Todas as famílias abaixo são `GET` e vivem sob `/api/integracoes/v1`. Apenas as marcadas **DISPONÍVEL** entram no primeiro marco; as demais são endereços reservados de planejamento, não rotas ativas.

| Domínio | Famílias propostas | Estado inicial |
|---|---|---|
| Projetos/clientes | `/projetos`, `/projetos/{id}`, `/clientes/segmentos` | PLANEJADO |
| Pessoas/cargos | `/colaboradores`, `/colaboradores/{id}`, `/cargos` | PLANEJADO/SENSÍVEL |
| Usuários/acessos | `/usuarios`, `/usuarios/{id}/modulos` | RESERVADO |
| Ponto | `/ponto/resumos`, `/ponto/ausencias`, `/ponto/sincronizacoes` | SENSÍVEL/RESERVADO |
| Efetivo | `/efetivo/planos`, `/efetivo/demandas`, `/efetivo/alocacoes`, `/efetivo/feriados` | PLANEJADO/SENSÍVEL |
| Acompanhamento | `/acompanhamento/progresso`, `/acompanhamento/grupos`, `/acompanhamento/custos`, `/acompanhamento/notas` | PLANEJADO/SENSÍVEL |
| RDO | `/rdo/relatorios`, `/rdo/relatorios/{id}`, `/rdo/versoes`, `/rdo/servicos`, `/rdo/anexos/{id}/download` | PLANEJADO/SENSÍVEL |
| Manutenção/produção | `/manutencao/registros`, `/manutencao/perfis`, `/manutencao/terceiros`, `/producao/limpezas`, `/manutencao/anexos/{id}/download` | PLANEJADO/SENSÍVEL |
| Equipamentos | `/equipamentos`, `/equipamentos/calibracoes`, `/equipamentos/inibicao`, `/equipamentos/documentos/{id}/download` | PLANEJADO/SENSÍVEL |
| Estoque | `/estoque/itens`, `/estoque/lotes`, `/estoque/movimentos`, `/estoque/documentos/{id}/download` | PLANEJADO/SENSÍVEL |
| Qualidade | `/qualidade/registros`, `/qualidade/registros/{id}`, `/qualidade/naturezas`, `/qualidade/evidencias/{id}/download` | **DISPONÍVEL** |
| EPI | `/epi/catalogo`, `/epi/entregas`, `/epi/documentos/{id}/download` | PLANEJADO/SENSÍVEL |
| Romaneios | `/romaneios`, `/romaneios/{id}`, `/romaneios/catalogo`, `/romaneios/documentos/{id}/download` | PLANEJADO |
| Alocação | `/alocacao/relatorios`, `/alocacao/entregas` | PLANEJADO/RESERVADO |
| Operações | `/operacoes/jobs`, `/operacoes/integracoes`, `/operacoes/retencao` | RESERVADO |
| Pesquisas | `/pesquisas/agregados`, `/pesquisas/respostas` | PLANEJADO/SENSÍVEL |
| Privacidade | `/privacidade/solicitacoes` | RESERVADO; exige especificação jurídica |
| Comercial | `/comercial/propostas`, `/comercial/orcamentos`, `/comercial/servicos-planejados`, `/comercial/horas` | SENSÍVEL |
| Omie | `/omie/projetos`, `/omie/categorias`, `/omie/compras`, `/omie/recebiveis` | PLANEJADO/SENSÍVEL |
| Assinaturas | `/assinaturas/documentos`, `/assinaturas/signatarios`, `/assinaturas/campos`, `/assinaturas/arquivos/{id}/download` | SENSÍVEL/RESERVADO |
| Autenticação/tokens internos | nenhuma família | PROIBIDO |

## Qualidade v1 — escopos concedíveis

| Escopo | Operações | Dependência | Efeito |
|---|---|---|---|
| `qualidade.registros.read` | listar e obter registro | nenhuma | Campos públicos do registro ativo e referências minimizadas de projeto/natureza |
| `qualidade.naturezas.read` | listar naturezas | nenhuma | Naturezas ativas/inativas conforme filtro permitido, sem configuração interna |
| `qualidade.evidencias.metadata.read` | incluir metadados de evidência no registro | `qualidade.registros.read` | id, tipo, rótulo, nome seguro, MIME, posição e data; sem URL/caminho/token |
| `qualidade.evidencias.download` | baixar arquivo por ID | `qualidade.registros.read` e metadados | Streaming autenticado, sujeito ao projeto e ao estado do registro |
| `qualidade.excluidos.read` | incluir tombstones/registros excluídos | `qualidade.registros.read` | Inclui `deletedAt` e dados mínimos de sincronização; nunca restaura o registro |

### Projeção pública de registro

| Campo público | Origem/regra |
|---|---|
| `id` | `QualityRecord.id` |
| `number` | número funcional; não deriva de `QualityRecordSeq` na resposta |
| `type` | tipo do registro |
| `registeredAt` | data de cadastro funcional |
| `origin` | origem controlada |
| `project` | somente `{ id, code, name }`, respeitando projetos permitidos |
| `eventDate` | data do evento |
| `nature` | somente `{ id, name, isActive }` |
| `description` | descrição do desvio/ocorrência |
| `impact` | impacto documentado |
| `recurrence` | `{ occurrences12m, recurrent }` calculado pelo mesmo conceito funcional do módulo |
| `linkedRnc` | referência RNC, quando houver |
| `disposition` | disposição definida |
| `definedAction` | ação definida |
| `actionOwner` | responsável textual minimizado |
| `actionDeadline` | prazo |
| `evidenceSummary` | resumo textual legado de `QualityRecord.evidence`; não é caminho ou arquivo |
| `resultVerification` | verificação do resultado |
| `status` | situação funcional |
| `evidences` | ausente sem escopo; array da projeção de metadados quando autorizado |
| `createdAt`/`updatedAt` | marcos de sincronização |
| `deletedAt` | ausente por padrão; presente somente com `qualidade.excluidos.read` |

Nunca incluir `seq`, `year` como mecanismo interno, `createdById`, `updatedById`, `deletedById`, objetos completos de usuário, `storagePath`, `publicToken` ou campos adicionados futuramente sem atualização explícita do serializer e do contrato.

### Filtros públicos de registros

- `updatedSince` e `updatedUntil` em ISO-8601 UTC.
- `projectId` somente dentro da allowlist da credencial.
- `type`, `status`, `natureId`, `eventDateFrom`, `eventDateTo` e `includeDeleted`.
- `limit` entre 1 e o menor de 500 ou `maxPageSize` da credencial.
- `cursor` opaco vinculado à versão, operação e hash dos demais filtros.
- A primeira página fixa `snapshotAt`; páginas seguintes reutilizam o valor embutido no cursor para não misturar atualizações posteriores na mesma carga.
- Ordenação fixa por `updatedAt ASC, id ASC`; não há `orderBy` arbitrário na v1.

## Gate para habilitar um domínio futuro

Todos os itens precisam estar concluídos:

1. finalidade e destinatário documentados;
2. escopo de menor privilégio e dependências definidas;
3. classificação de cada campo e aprovação de privacidade/negócio quando sensível;
4. operação e schemas incluídos no OpenAPI versionado;
5. consulta com `select` explícito e serializer por allowlist;
6. filtro por projeto/tenant aplicado antes da consulta;
7. paginação, limites, cota e timeout definidos;
8. logs redigidos e retenção definida;
9. testes de sucesso, escopo ausente, projeto negado e ausência de todos os campos proibidos;
10. catálogo alterado de `PLANEJADO`/`SENSÍVEL` para `DISPONÍVEL` em revisão específica.

## Exclusões globais invariáveis

- Senha, hash de senha, sessão e qualquer token/hash de reset, confirmação, preferência, assinatura ou integração.
- `Authorization`, segredo da nova credencial, verificador HMAC e `pepper`.
- Material criptográfico: chave, IV, authentication tag, token cifrado ou chave de versão.
- Caminho físico de arquivo, nome temporário interno, diretório de backup e URL pública permanente não sujeita ao token.
- Lock, lease, sequência/contador de geração e estado técnico usado apenas para coordenação.
- Payload/linha/arquivo bruto de importação ou integração e stack trace.
- Imagem de assinatura, prova de identidade e documento pessoal sem especificação jurídica dedicada.
- Campos novos do Prisma por padrão: adicionar coluna ao banco nunca adiciona campo à API automaticamente.
