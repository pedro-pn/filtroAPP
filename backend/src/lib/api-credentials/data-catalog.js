import { OPERATIONAL_RESOURCES } from './operational-resources.js';
import { OPERATIONAL_DOWNLOADS } from './extended-operational-resources.js';

export const DATA_CATALOG_VERSION = '2026-09-09';
const publishedModels = new Set(OPERATIONAL_RESOURCES.map(item => item.model));
const publishedScopes = new Set([...OPERATIONAL_RESOURCES, ...OPERATIONAL_DOWNLOADS].map(item => item.scope));

const DEFAULT_INCLUDED_FIELDS = ['id', 'identificação funcional', 'estado', 'datas operacionais'];

function modelEntries(names, availability) {
  return names.map(model => ({ model, availability: publishedModels.has(model) ? 'AVAILABLE' : availability }));
}

function domain({ code, label, models, candidateScopes, candidateAvailability = 'PLANNED', endpointFamilies = [], includedFields = DEFAULT_INCLUDED_FIELDS, excludedFields }) {
  return Object.freeze({ code, label, models, candidateScopes, candidateAvailability, endpointFamilies, includedFields, excludedFields });
}

export const API_DATA_DOMAINS = Object.freeze([
  domain({
    code: 'people-access', label: 'Pessoas, cargos e acesso',
    models: [
      ...modelEntries(['Collaborator', 'JobRole'], 'PLANNED'),
      ...modelEntries(['CollaboratorJobRoleHistory', 'User'], 'SENSITIVE'),
      ...modelEntries(['CollaboratorSignatureNoticeLog', 'ModuleRole', 'ProjectAuthorizedUser'], 'RESERVED')
    ],
    candidateScopes: ['colaboradores.operacional.read', 'colaboradores.pii.read', 'cargos.read', 'usuarios.diretorio.read'],
    candidateAvailability: 'SENSITIVE', endpointFamilies: ['/colaboradores', '/cargos', '/usuarios'],
    excludedFields: ['passwordHash', 'assinaturas', 'documentos', 'contatos sem escopo PII', 'sessões', 'notificações']
  }),
  domain({
    code: 'projects-clients', label: 'Projetos, clientes e configurações',
    models: [...modelEntries(['ClientSegment', 'Project'], 'PLANNED'), ...modelEntries(['AcompanhamentoSetting', 'EfetivoSetting'], 'RESERVED')],
    candidateScopes: ['projetos.read', 'clientes.segmentos.read', 'projetos.contatos.read'], endpointFamilies: ['/projetos', '/clientes/segmentos'],
    excludedFields: ['CNPJ', 'e-mail', 'telefone', 'códigos externos', 'configurações internas']
  }),
  domain({
    code: 'time-attendance', label: 'Ponto e presença',
    models: [...modelEntries(['CollaboratorAbsence', 'PontoPeriodSummary'], 'SENSITIVE'), ...modelEntries(['PontoImport', 'PontoNameAlias', 'PontoSyncRun', 'PontoSyncState', 'PontoExternalEmployeeLink', 'PontoExternalEmployee', 'PontoProjectTagAlias', 'PontoIgnoredProjectTag', 'PontoDayProjectOverride'], 'RESERVED')],
    candidateScopes: ['ponto.resumos.read', 'ponto.ausencias.read', 'ponto.sincronizacoes.read'], candidateAvailability: 'SENSITIVE', endpointFamilies: ['/ponto/resumos', '/ponto/ausencias', '/ponto/sincronizacoes'],
    excludedFields: ['payload bruto', 'hash de arquivo', 'erros brutos', 'identificadores externos pessoais', 'documentos médicos', 'aliases internos']
  }),
  domain({
    code: 'workforce-planning', label: 'Planejamento de efetivo',
    models: [
      ...modelEntries(['EfetivoPlan', 'EfetivoMissionPlan', 'EfetivoMissionCycle', 'EfetivoMissionDemand', 'WorkforceHoliday'], 'PLANNED'),
      ...modelEntries(['EfetivoMissionAllocation', 'EfetivoAllocationCycle', 'EfetivoPlannedHire'], 'SENSITIVE'),
      ...modelEntries(['WorkforceCalendarState'], 'PROHIBITED'), ...modelEntries(['EfetivoAuditEvent'], 'RESERVED')
    ],
    candidateScopes: ['efetivo.planos.read', 'efetivo.demandas.read', 'efetivo.alocacoes.read', 'efetivo.contratacoes.read', 'efetivo.feriados.read'], endpointFamilies: ['/efetivo/planos', '/efetivo/demandas', '/efetivo/alocacoes', '/efetivo/feriados'],
    excludedFields: ['salários', 'custos pessoais', 'observações livres', 'estado técnico', 'evento bruto', 'ator']
  }),
  domain({
    code: 'project-tracking', label: 'Acompanhamento e custos',
    models: [...modelEntries(['ProjectManualProgressHistory', 'AcompanhamentoMissionGroup', 'AcompanhamentoMissionGroupMember'], 'PLANNED'), ...modelEntries(['CostProfile', 'CostParameterSet', 'ProjectManualCost', 'ProjectManagementNote'], 'SENSITIVE')],
    candidateScopes: ['acompanhamento.progresso.read', 'acompanhamento.grupos.read', 'acompanhamento.custos.read', 'acompanhamento.notas.read'], endpointFamilies: ['/acompanhamento/progresso', '/acompanhamento/grupos', '/acompanhamento/custos'],
    excludedFields: ['margens', 'precificação', 'notas livres com PII', 'parâmetros internos', 'identidade do editor']
  }),
  domain({
    code: 'rdo', label: 'RDO e relatórios',
    models: [
      ...modelEntries(['DdsTheme', 'Report', 'ReportVersion', 'ReportCollaborator', 'ReportService'], 'PLANNED'),
      ...modelEntries(['ClientReportReview', 'ReportSignature', 'ReportAuditLog', 'ReportAttachment'], 'SENSITIVE'),
      ...modelEntries(['ReportApprovalPostProcessingJob', 'ReportDraft'], 'RESERVED'), ...modelEntries(['ProjectReportSeq'], 'PROHIBITED')
    ],
    candidateScopes: ['rdo.relatorios.read', 'rdo.versoes.read', 'rdo.equipe.read', 'rdo.servicos.read', 'rdo.dds.read', 'rdo.anexos.metadata.read', 'rdo.anexos.download', 'rdo.assinaturas.read', 'rdo.auditoria.read'], endpointFamilies: ['/rdo/relatorios', '/rdo/versoes', '/rdo/servicos'],
    excludedFields: ['sequências', 'jobs/payloads', 'rascunhos', 'caminho/token de arquivo', 'imagem de assinatura', 'IP', 'user-agent']
  }),
  domain({
    code: 'maintenance-production', label: 'Manutenção e produção',
    models: [...modelEntries(['MaintenanceProfile', 'MaintenanceProfileItem', 'MaintenanceRecord', 'MaintenanceThirdPartyService', 'ChemicalCleaning'], 'PLANNED'), ...modelEntries(['MaintenanceAttachment', 'OperationalReviewAudit'], 'SENSITIVE'), ...modelEntries(['MaintenanceConfiguration'], 'RESERVED')],
    candidateScopes: ['manutencao.registros.read', 'manutencao.perfis.read', 'manutencao.terceiros.read', 'producao.limpezas.read', 'manutencao.anexos.metadata.read', 'manutencao.anexos.download', 'manutencao.auditoria.read'], endpointFamilies: ['/manutencao/registros', '/manutencao/perfis', '/producao/limpezas'],
    excludedFields: ['caminhos', 'arquivos sem endpoint autenticado', 'contatos de terceiro', 'payload de auditoria', 'configuração interna']
  }),
  domain({
    code: 'equipment', label: 'Equipamentos, calibração e inibição',
    models: [...modelEntries(['Equipment', 'InhibitionVessel', 'InhibitionSystem', 'Unit', 'Manometer', 'ParticleCounter', 'CalibrationCertificate', 'EquipmentCategory', 'CompanyEquipment'], 'PLANNED'), ...modelEntries(['EquipmentAttachment'], 'SENSITIVE'), ...modelEntries(['CalibrationNotificationLog', 'EquipmentNotificationRecipient', 'EquipmentNotificationConfig', 'RdoEquipmentSlot'], 'RESERVED')],
    candidateScopes: ['equipamentos.read', 'equipamentos.categorias.read', 'equipamentos.calibracoes.read', 'equipamentos.certificados.metadata.read', 'equipamentos.documentos.download', 'equipamentos.inibicao.read'], endpointFamilies: ['/equipamentos', '/equipamentos/calibracoes', '/equipamentos/inibicao'],
    excludedFields: ['e-mails de notificação', 'regras internas', 'caminho/URL/token', 'logs de envio', 'slots internos']
  }),
  domain({
    code: 'stock', label: 'Estoque',
    models: [...modelEntries(['StockItem', 'StockCategory', 'StockBatch', 'StockMovement'], 'PLANNED'), ...modelEntries(['StockItemDocument'], 'SENSITIVE')],
    candidateScopes: ['estoque.itens.read', 'estoque.lotes.read', 'estoque.movimentos.read', 'estoque.documentos.metadata.read', 'estoque.documentos.download', 'estoque.custos.read'], endpointFamilies: ['/estoque/itens', '/estoque/lotes', '/estoque/movimentos'],
    excludedFields: ['custo sem escopo financeiro', 'notas com PII', 'caminho/token de documento', 'ator']
  }),
  domain({
    code: 'quality', label: 'Qualidade',
    models: [...modelEntries(['QualityNature', 'QualityRecord', 'QualityEvidence'], 'AVAILABLE'), ...modelEntries(['QualityRecordSeq'], 'PROHIBITED')],
    candidateScopes: ['qualidade.naturezas.read', 'qualidade.registros.read', 'qualidade.evidencias.metadata.read', 'qualidade.evidencias.download', 'qualidade.excluidos.read'], candidateAvailability: 'AVAILABLE', endpointFamilies: ['/qualidade/registros', '/qualidade/naturezas', '/qualidade/evidencias/{id}/download'],
    includedFields: ['campos públicos do contrato QualityRecord', 'referências minimizadas de projeto/natureza', 'metadados allowlisted de evidência'],
    excludedFields: ['storagePath', 'publicToken', 'seq', 'year', 'createdById', 'updatedById', 'deletedById', 'usuários completos']
  }),
  domain({
    code: 'ppe', label: 'EPI',
    models: [...modelEntries(['EpiCatalogItem'], 'PLANNED'), ...modelEntries(['EpiRecord'], 'SENSITIVE'), ...modelEntries(['EpiSignatureRequest', 'EpiCollaboratorProfile', 'EpiSignatureRequestAuditLog'], 'RESERVED')],
    candidateScopes: ['epi.catalogo.read', 'epi.entregas.read', 'epi.documentos.download'], candidateAvailability: 'SENSITIVE', endpointFamilies: ['/epi/catalogo', '/epi/entregas'],
    excludedFields: ['token/hash', 'assinatura/imagem', 'CPF', 'IP/user-agent', 'caminho PDF', 'logs de envio']
  }),
  domain({
    code: 'packing-lists', label: 'Romaneios',
    models: [...modelEntries(['Romaneio', 'RomaneioItem', 'RomaneioChecklist', 'RomaneioCatalogItem'], 'PLANNED'), ...modelEntries(['RomaneioCatalogSyncState'], 'PROHIBITED'), ...modelEntries(['RomaneioNotificationRecipient'], 'RESERVED')],
    candidateScopes: ['romaneios.read', 'romaneios.itens.read', 'romaneios.checklist.read', 'romaneios.catalogo.read', 'romaneios.documentos.download'], endpointFamilies: ['/romaneios', '/romaneios/catalogo'],
    excludedFields: ['sequência/estado técnico', 'e-mails', 'payload de sincronização', 'caminho/token de documento']
  }),
  domain({
    code: 'allocation-delivery', label: 'Relatórios de alocação e entregas',
    models: [...modelEntries(['AllocationReportDelivery'], 'PLANNED'), ...modelEntries(['AllocationReportRecipientDelivery'], 'SENSITIVE'), ...modelEntries(['AllocationReportRecipient'], 'RESERVED')],
    candidateScopes: ['alocacao.relatorios.read', 'alocacao.entregas.read'], endpointFamilies: ['/alocacao/relatorios', '/alocacao/entregas'],
    excludedFields: ['e-mail/destinatário', 'erro bruto', 'conteúdo do arquivo', 'configuração de distribuição']
  }),
  domain({
    code: 'operations', label: 'Operações, retenção e jobs',
    models: [...modelEntries(['DataRetentionRun', 'JobRun', 'IntegrationSyncRun'], 'RESERVED'), ...modelEntries(['JobLock'], 'PROHIBITED')],
    candidateScopes: ['operacoes.jobs.read', 'operacoes.integracoes.read', 'operacoes.retencao.read'], candidateAvailability: 'RESERVED', endpointFamilies: ['/operacoes/jobs', '/operacoes/integracoes', '/operacoes/retencao'],
    excludedFields: ['lock/lease', 'stack trace', 'segredos', 'payload bruto', 'comandos', 'caminhos de backup']
  }),
  domain({
    code: 'surveys', label: 'Pesquisa de satisfação',
    models: [...modelEntries(['SatisfactionSurveyQuestion'], 'PLANNED'), ...modelEntries(['SatisfactionSurvey'], 'SENSITIVE')],
    candidateScopes: ['pesquisas.agregados.read', 'pesquisas.respostas.read'], candidateAvailability: 'SENSITIVE', endpointFamilies: ['/pesquisas/agregados', '/pesquisas/respostas'],
    excludedFields: ['token/hash', 'contato', 'vínculo identificável', 'IP/user-agent', 'texto livre sem revisão']
  }),
  domain({
    code: 'authentication', label: 'Autenticação e tokens internos',
    models: modelEntries(['NotificationPreferenceToken', 'PasswordResetToken', 'EmailChangeToken', 'UserSession'], 'PROHIBITED'),
    candidateScopes: [], candidateAvailability: 'PROHIBITED', endpointFamilies: [], includedFields: [],
    excludedFields: ['todos os campos, hashes, seletores, validade, sessão, e-mail pendente e metadados']
  }),
  domain({
    code: 'privacy', label: 'Privacidade/LGPD',
    models: [...modelEntries(['DataSubjectRequest'], 'SENSITIVE'), ...modelEntries(['DataSubjectRequestResponseAttempt'], 'RESERVED')],
    candidateScopes: ['privacidade.solicitacoes.read'], candidateAvailability: 'RESERVED', endpointFamilies: ['/privacidade/solicitacoes'], includedFields: [],
    excludedFields: ['identidade/contato', 'documento', 'prova', 'anexos', 'resposta', 'tentativas', 'IP/user-agent']
  }),
  domain({
    code: 'commercial', label: 'Comercial, orçamento e planejamento',
    models: [...modelEntries(['CommercialProposal', 'ProjectBudget', 'ProjectAdditionalProposal', 'ProjectPlannedService', 'ProjectPlannedServiceSystem', 'ProjectPlannedNormalHours', 'ProjectPlannedOvertime'], 'SENSITIVE'), ...modelEntries(['AccessImport'], 'RESERVED')],
    candidateScopes: ['comercial.propostas.read', 'comercial.orcamentos.read', 'comercial.servicos-planejados.read', 'comercial.horas.read', 'comercial.contatos.read'], candidateAvailability: 'SENSITIVE', endpointFamilies: ['/comercial/propostas', '/comercial/orcamentos'],
    excludedFields: ['rawRow', 'arquivo/hash de importação', 'contato/CNPJ sem escopo', 'observações', 'custos/margens sem escopo']
  }),
  domain({
    code: 'omie', label: 'Integração Omie',
    models: [...modelEntries(['OmieProject', 'OmieCategory'], 'PLANNED'), ...modelEntries(['OmiePurchase', 'OmieReceivable', 'OmieInvoice'], 'SENSITIVE')],
    candidateScopes: ['omie.projetos.read', 'omie.categorias.read', 'omie.compras.read', 'omie.recebiveis.read'], candidateAvailability: 'SENSITIVE', endpointFamilies: ['/omie/projetos', '/omie/categorias', '/omie/compras', '/omie/recebiveis'],
    excludedFields: ['credencial Omie', 'payload bruto', 'logs técnicos', 'dados bancários/fiscais excessivos', 'contatos']
  }),
  domain({
    code: 'standalone-signatures', label: 'Assinaturas avulsas',
    models: [...modelEntries(['SignatureDocument', 'SignatureDocumentSigner', 'SignatureDocumentField'], 'SENSITIVE'), ...modelEntries(['SignatureDocumentAuditLog', 'SignatureDocumentFilePurge', 'SignatureDocumentCompletionNotification'], 'RESERVED')],
    candidateScopes: ['assinaturas.documentos.read', 'assinaturas.signatarios.read', 'assinaturas.campos.read', 'assinaturas.arquivos.download', 'assinaturas.auditoria.read'], candidateAvailability: 'SENSITIVE', endpointFamilies: ['/assinaturas/documentos', '/assinaturas/signatarios', '/assinaturas/campos'],
    excludedFields: ['token/hash/cifra/IV/auth tag', 'assinatura desenhada', 'CPF/documento', 'IP/user-agent', 'caminho', 'prova integral', 'erros']
  })
]);

export const CATALOG_EXCLUDED_INFRASTRUCTURE_MODELS = Object.freeze([
  { model: 'ApiCredential', reason: 'Identidade e verificador da própria infraestrutura de integração.' },
  { model: 'ApiCredentialScope', reason: 'Concessão administrativa da própria infraestrutura.' },
  { model: 'ApiCredentialProject', reason: 'Restrição administrativa da própria infraestrutura.' },
  { model: 'ApiCredentialEvent', reason: 'Auditoria administrativa preservada, não publicável.' },
  { model: 'ApiRequestLog', reason: 'Telemetria redigida interna.' },
  { model: 'ApiUsageBucket', reason: 'Contador interno de cota.' }
]);

export function flattenDataCatalogModels() {
  return API_DATA_DOMAINS.flatMap(item => item.models.map(model => ({ ...model, domainCode: item.code, domain: item.label })));
}

export function futureScopeDefinitions() {
  return API_DATA_DOMAINS
    .filter(item => item.code !== 'quality')
    .flatMap(item => item.candidateScopes.filter(code => !publishedScopes.has(code)).map(code => ({
      code,
      label: code,
      domain: item.label,
      description: `Família candidata de ${item.label}; ainda não concede acesso.`,
      sensitivity: item.candidateAvailability === 'SENSITIVE' ? 'PERSONAL' : 'INTERNAL',
      availability: item.candidateAvailability,
      requiredScopes: [],
      operations: [],
      models: item.models.map(model => model.model),
      exposedFields: item.includedFields,
      excludedFields: item.excludedFields,
      endpointFamilies: item.endpointFamilies
    })));
}
