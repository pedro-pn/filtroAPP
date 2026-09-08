import { hubModulesForUser } from '../pages/hubModules';
import { modulePathExclusions, modulePathPrefixes, moduleRegistry, type AppModuleId } from '../modules/registry';
import type { AuthUser } from '../types/auth';

const LAST_MODULE_KEY_PREFIX = 'filtrovali:last-module:';
const HUB_FIRST_LOGIN_TUTORIAL_KEY_PREFIX = 'filtrovali:hub-first-login-tutorial:';
const ACOMPANHAMENTO_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-novelty:';
const QUALIDADE_NOVELTY_KEY_PREFIX = 'filtrovali:qualidade-novelty:v1:';
const EFETIVO_HUB_NOVELTY_KEY_PREFIX = 'filtrovali:efetivo-hub-novelty:v1:';
const EFETIVO_CONTROL_NOVELTY_KEY_PREFIX = 'filtrovali:efetivo-control-novelty:v1:';
const ACOMPANHAMENTO_GROUPING_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-grouping-novelty:v1:';
const ACOMPANHAMENTO_GROUP_RENAME_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-group-rename-novelty:v1:';
const ACOMPANHAMENTO_PROGRESS_HISTORY_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-progress-history-novelty:v1:';
const ACOMPANHAMENTO_WEEKLY_TARGET_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-weekly-target-novelty:v1:';
const ACOMPANHAMENTO_MANUAL_COST_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-manual-cost-novelty:v1:';
const ACOMPANHAMENTO_PROJECT_DEVIATIONS_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-project-deviations-novelty:v1:';
const ACOMPANHAMENTO_ADDITIONAL_PROPOSALS_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-additional-proposals-novelty:v1:';
const ACOMPANHAMENTO_STANDBY_HISTORY_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-standby-history-novelty:v1:';
// v2: a v1 podia ser marcada como vista antes de o driver realmente abrir.
const ACOMPANHAMENTO_TRACKING_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-tracking-novelty:v2:';
const ACOMPANHAMENTO_FINALIZED_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-finalized-novelty:v2:';
const ACOMPANHAMENTO_REVIEW_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-review-novelty:v1:';
const ACOMPANHAMENTO_FINALIZED_SEEN_KEY_PREFIX = 'filtrovali:acompanhamento-finalized-seen:v1:';
// v2: a v1 pôde ser marcada como vista sem exibir (timer cancelado por re-render do formulário).
const RDO_DDS_NOVELTY_KEY_PREFIX = 'filtrovali:rdo-dds-novelty:v2:';
const PROJECT_INTAKE_NOVELTY_KEY_PREFIX = 'filtrovali:project-intake-novelty:v1:';
const PONTOMAIS_SYNC_NOVELTY_KEY_PREFIX = 'filtrovali:pontomais-sync-novelty:v1:';
const ACOMPANHAMENTO_LABOR_POLICY_NOVELTY_KEY_PREFIX = 'filtrovali:acompanhamento-labor-policy-novelty:v1:';
const ROMANEIO_QR_NOVELTY_KEY_PREFIX = 'filtrovali:romaneio-qr-novelty:v1:';

function storageKey(user: Pick<AuthUser, 'id'>) {
  return `${LAST_MODULE_KEY_PREFIX}${user.id}`;
}

function hubFirstLoginTutorialStorageKey(user: Pick<AuthUser, 'id'>) {
  return `${HUB_FIRST_LOGIN_TUTORIAL_KEY_PREFIX}${user.id}`;
}

function acompanhamentoNoveltyStorageKey(user: Pick<AuthUser, 'id'>) {
  return `${ACOMPANHAMENTO_NOVELTY_KEY_PREFIX}${user.id}`;
}

function qualidadeNoveltyStorageKey(user: Pick<AuthUser, 'id'>) {
  return `${QUALIDADE_NOVELTY_KEY_PREFIX}${user.id}`;
}

// Campanhas do Efetivo implantadas em 21/08/2026 e válidas por 10 dias corridos.
export const EFETIVO_NOVELTY_IMPLEMENTED_AT = '2026-08-21';
const EFETIVO_NOVELTY_EXPIRES_AT = new Date('2026-08-31T23:59:59-03:00');

export type EfetivoControlNoveltyId = 'operational-role' | 'termination-date';

export function userHasEfetivoModule(user: AuthUser | null | undefined) {
  return availableHubModulesForUser(user).some(module => module.id === 'efetivo');
}

export function shouldShowEfetivoHubNovelty(user: AuthUser | null | undefined) {
  if (!user || !userHasEfetivoModule(user) || Date.now() > EFETIVO_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${EFETIVO_HUB_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markEfetivoHubNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (user) safeLocalStorageSet(`${EFETIVO_HUB_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

export function shouldShowEfetivoControlNovelty(user: Pick<AuthUser, 'id'> | null | undefined, control: EfetivoControlNoveltyId) {
  if (!user || Date.now() > EFETIVO_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${EFETIVO_CONTROL_NOVELTY_KEY_PREFIX}${control}:${user.id}`) !== '1';
}

export function markEfetivoControlNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined, control: EfetivoControlNoveltyId) {
  if (user) safeLocalStorageSet(`${EFETIVO_CONTROL_NOVELTY_KEY_PREFIX}${control}:${user.id}`, '1');
}

// Campanha do QR code no romaneio implantada em 27/08/2026 e válida por 10 dias corridos.
export const ROMANEIO_QR_NOVELTY_IMPLEMENTED_AT = '2026-08-27';
const ROMANEIO_QR_NOVELTY_EXPIRES_AT = new Date('2026-09-06T23:59:59-03:00');

export function shouldShowRomaneioQrNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user || Date.now() > ROMANEIO_QR_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ROMANEIO_QR_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markRomaneioQrNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (user) safeLocalStorageSet(`${ROMANEIO_QR_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

function safeLocalStorageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

export type NavigationLocation = {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
};

function isClientAccount(user: Pick<AuthUser, 'accountType' | 'role'> | null | undefined) {
  return user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
}

function pathMatchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function availableHubModulesForUser(user: AuthUser | null | undefined) {
  return hubModulesForUser(user).filter(module => module.path && !module.disabled);
}

export function hasSeenHubFirstLoginTutorial(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return true;
  return safeLocalStorageGet(hubFirstLoginTutorialStorageKey(user)) === '1';
}

export function markHubFirstLoginTutorialSeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(hubFirstLoginTutorialStorageKey(user), '1');
}

// Novidade do módulo Acompanhamento no hub: destaque único p/ contas com acesso (visualizador/gestor).
export function userHasAcompanhamentoModule(user: AuthUser | null | undefined) {
  return availableHubModulesForUser(user).some(module => module.id === 'acompanhamento');
}

export function hasSeenAcompanhamentoNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return true;
  return safeLocalStorageGet(acompanhamentoNoveltyStorageKey(user)) === '1';
}

export function markAcompanhamentoNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(acompanhamentoNoveltyStorageKey(user), '1');
}

// Novidade do módulo Qualidade no hub: destaque único p/ contas com acesso ativo.
// Validade global de 10 dias corridos após a implantação (22/07/2026 a 01/08/2026).
const QUALIDADE_NOVELTY_EXPIRES_AT = new Date('2026-08-01T23:59:59-03:00');

export function userHasQualidadeModule(user: AuthUser | null | undefined) {
  return availableHubModulesForUser(user).some(module => module.id === 'qualidade');
}

export function shouldShowQualidadeNovelty(user: AuthUser | null | undefined) {
  if (!user || !userHasQualidadeModule(user)) return false;
  if (Date.now() > QUALIDADE_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(qualidadeNoveltyStorageKey(user)) !== '1';
}

export function markQualidadeNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(qualidadeNoveltyStorageKey(user), '1');
}

// Novidade da unificação de projetos no Acompanhamento.
// Aparece uma vez por navegador durante a campanha; depois da data-limite não aparece para ninguém.
const ACOMPANHAMENTO_GROUPING_NOVELTY_EXPIRES_AT = new Date('2026-07-26T23:59:59-03:00');

export function shouldShowAcompanhamentoGroupingNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_GROUPING_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_GROUPING_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoGroupingNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_GROUPING_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade da edição de nome dos cards mesclados no Acompanhamento.
// Validade global de 10 dias corridos após a implantação (22/07/2026 a 01/08/2026).
const ACOMPANHAMENTO_GROUP_RENAME_NOVELTY_EXPIRES_AT = new Date('2026-08-01T23:59:59-03:00');

export function shouldShowAcompanhamentoGroupRenameNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_GROUP_RENAME_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_GROUP_RENAME_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoGroupRenameNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_GROUP_RENAME_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade da separação entre folha real e apropriação analítica por grupo.
// Validade global de 10 dias corridos após a implantação (17/08/2026 a 27/08/2026).
const ACOMPANHAMENTO_LABOR_POLICY_NOVELTY_EXPIRES_AT = new Date('2026-08-27T23:59:59-03:00');

export function shouldShowAcompanhamentoLaborPolicyNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_LABOR_POLICY_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_LABOR_POLICY_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoLaborPolicyNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_LABOR_POLICY_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade do histórico semanal de avanço no dashboard do projeto.
// Validade global de 10 dias corridos após a implantação (21/07/2026 a 31/07/2026).
const ACOMPANHAMENTO_PROGRESS_HISTORY_NOVELTY_EXPIRES_AT = new Date('2026-07-31T23:59:59-03:00');

export function shouldShowAcompanhamentoProgressHistoryNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_PROGRESS_HISTORY_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_PROGRESS_HISTORY_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoProgressHistoryNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_PROGRESS_HISTORY_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade do ritmo semanal necessário para entregar o escopo na data prevista.
// Validade global de 10 dias corridos após a implantação (07/08/2026 a 17/08/2026).
const ACOMPANHAMENTO_WEEKLY_TARGET_NOVELTY_EXPIRES_AT = new Date('2026-08-17T23:59:59-03:00');

export function shouldShowAcompanhamentoWeeklyTargetNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_WEEKLY_TARGET_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_WEEKLY_TARGET_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoWeeklyTargetNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_WEEKLY_TARGET_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade do custo manual no dashboard do projeto.
// Validade global de 10 dias corridos após a implantação (21/07/2026 a 31/07/2026).
const ACOMPANHAMENTO_MANUAL_COST_NOVELTY_EXPIRES_AT = new Date('2026-07-31T23:59:59-03:00');

export function shouldShowAcompanhamentoManualCostNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_MANUAL_COST_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_MANUAL_COST_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoManualCostNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_MANUAL_COST_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade da seção Desvios no dashboard do projeto.
// Validade global de 10 dias corridos após a implantação (22/07/2026 a 01/08/2026).
const ACOMPANHAMENTO_PROJECT_DEVIATIONS_NOVELTY_EXPIRES_AT = new Date('2026-08-01T23:59:59-03:00');

export function shouldShowAcompanhamentoProjectDeviationsNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_PROJECT_DEVIATIONS_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_PROJECT_DEVIATIONS_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoProjectDeviationsNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_PROJECT_DEVIATIONS_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade de propostas adicionais no dashboard do projeto.
// Validade global de 10 dias corridos após a implantação (23/07/2026 a 02/08/2026).
const ACOMPANHAMENTO_ADDITIONAL_PROPOSALS_NOVELTY_EXPIRES_AT = new Date('2026-08-02T23:59:59-03:00');

export function shouldShowAcompanhamentoAdditionalProposalsNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_ADDITIONAL_PROPOSALS_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_ADDITIONAL_PROPOSALS_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoAdditionalProposalsNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_ADDITIONAL_PROPOSALS_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade do histórico de standby nos cards de projeto.
// Validade global de 10 dias corridos após a implantação (25/08/2026 a 04/09/2026).
const ACOMPANHAMENTO_STANDBY_HISTORY_NOVELTY_EXPIRES_AT = new Date('2026-09-04T23:59:59-03:00');

export function shouldShowAcompanhamentoStandbyHistoryNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > ACOMPANHAMENTO_STANDBY_HISTORY_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${ACOMPANHAMENTO_STANDBY_HISTORY_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markAcompanhamentoStandbyHistoryNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${ACOMPANHAMENTO_STANDBY_HISTORY_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Campanhas das novas ações de arquivamento/conferência e do aviso de missão finalizada.
// Validade global de 10 dias corridos após a implantação (06/08/2026 a 16/08/2026).
const ACOMPANHAMENTO_TRACKING_NOVELTY_EXPIRES_AT = new Date('2026-08-16T23:59:59-03:00');

function shouldShowTimedNovelty(user: Pick<AuthUser, 'id'> | null | undefined, prefix: string) {
  if (!user || Date.now() > ACOMPANHAMENTO_TRACKING_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${prefix}${user.id}`) !== '1';
}

export function shouldShowAcompanhamentoTrackingNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  return shouldShowTimedNovelty(user, ACOMPANHAMENTO_TRACKING_NOVELTY_KEY_PREFIX);
}

export function markAcompanhamentoTrackingNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (user) safeLocalStorageSet(`${ACOMPANHAMENTO_TRACKING_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

export function shouldShowAcompanhamentoFinalizedNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  return shouldShowTimedNovelty(user, ACOMPANHAMENTO_FINALIZED_NOVELTY_KEY_PREFIX);
}

export function markAcompanhamentoFinalizedNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (user) safeLocalStorageSet(`${ACOMPANHAMENTO_FINALIZED_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

export function shouldShowAcompanhamentoReviewNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  return shouldShowTimedNovelty(user, ACOMPANHAMENTO_REVIEW_NOVELTY_KEY_PREFIX);
}

export function markAcompanhamentoReviewNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (user) safeLocalStorageSet(`${ACOMPANHAMENTO_REVIEW_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

function finalizedMissionSeenKey(user: Pick<AuthUser, 'id'>, projectKey: string, archivedAt: string) {
  return `${ACOMPANHAMENTO_FINALIZED_SEEN_KEY_PREFIX}${user.id}:${projectKey}:${archivedAt}`;
}

export function hasSeenAcompanhamentoFinalizedMission(
  user: Pick<AuthUser, 'id'> | null | undefined,
  projectKey: string,
  archivedAt: string | null | undefined
) {
  if (!user || !archivedAt) return true;
  return safeLocalStorageGet(finalizedMissionSeenKey(user, projectKey, archivedAt)) === '1';
}

export function markAcompanhamentoFinalizedMissionSeen(
  user: Pick<AuthUser, 'id'> | null | undefined,
  projectKey: string,
  archivedAt: string | null | undefined
) {
  if (!user || !archivedAt) return;
  safeLocalStorageSet(finalizedMissionSeenKey(user, projectKey, archivedAt), '1');
}

// Novidade do registro de DDS no formulário de RDO: destaque único na primeira abertura do formulário.
// A marcação de "visto" fica no localStorage (por navegador); a data-limite abaixo encerra a campanha
// de vez — depois dela o aviso não aparece nem em navegadores/dispositivos que nunca o viram.
const RDO_DDS_NOVELTY_EXPIRES_AT = new Date('2026-07-25T23:59:59-03:00');

export function shouldShowRdoDdsNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return false;
  if (Date.now() > RDO_DDS_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${RDO_DDS_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markRdoDdsNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${RDO_DDS_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade do recebimento automático de projetos: 13/08/2026 a 23/08/2026.
const PROJECT_INTAKE_NOVELTY_EXPIRES_AT = new Date('2026-08-23T23:59:59-03:00');

export function shouldShowProjectIntakeNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user || Date.now() > PROJECT_INTAKE_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${PROJECT_INTAKE_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markProjectIntakeNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${PROJECT_INTAKE_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

// Novidade da sincronização de jornada: 17/08/2026 a 27/08/2026.
const PONTOMAIS_SYNC_NOVELTY_EXPIRES_AT = new Date('2026-08-27T23:59:59-03:00');

export function shouldShowPontoMaisSyncNovelty(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user || Date.now() > PONTOMAIS_SYNC_NOVELTY_EXPIRES_AT.getTime()) return false;
  return safeLocalStorageGet(`${PONTOMAIS_SYNC_NOVELTY_KEY_PREFIX}${user.id}`) !== '1';
}

export function markPontoMaisSyncNoveltySeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(`${PONTOMAIS_SYNC_NOVELTY_KEY_PREFIX}${user.id}`, '1');
}

export function shouldOpenHubOnFirstLogin(user: AuthUser | null | undefined) {
  if (!user || isClientAccount(user)) return false;
  return availableHubModulesForUser(user).length > 1 && !hasSeenHubFirstLoginTutorial(user);
}

export function moduleIdFromPath(pathname: string): AppModuleId | null {
  const path = pathname || '/';
  for (const module of moduleRegistry) {
    if (modulePathExclusions(module.id).some(prefix => pathMatchesPrefix(path, prefix))) return null;
    if (modulePathPrefixes(module.id).some(prefix => pathMatchesPrefix(path, prefix))) return module.id;
  }
  return null;
}

export function modulePathForUser(user: AuthUser | null | undefined, moduleId: AppModuleId | null | undefined) {
  if (!user || !moduleId) return '';
  const module = hubModulesForUser(user).find(item => item.id === moduleId && item.path && !item.disabled);
  return module?.path || '';
}

export function rememberModuleAccess(user: AuthUser | null | undefined, pathname: string) {
  if (!user) return;
  const moduleId = moduleIdFromPath(pathname);
  if (!moduleId || !modulePathForUser(user, moduleId)) return;
  safeLocalStorageSet(storageKey(user), moduleId);
}

export function rememberedModulePath(user: AuthUser | null | undefined) {
  if (!user) return '';
  const stored = safeLocalStorageGet(storageKey(user)) as AppModuleId | null;
  return modulePathForUser(user, stored);
}

export function preferredEntryPath(user: AuthUser | null | undefined) {
  if (!user) return '/login';
  if (isClientAccount(user)) return '/rdo/cliente';
  if (shouldShowQualidadeNovelty(user)) return '/modulos';
  if (shouldShowEfetivoHubNovelty(user)) return '/modulos';
  if (shouldOpenHubOnFirstLogin(user)) return '/modulos';
  const remembered = rememberedModulePath(user);
  if (remembered) return remembered;
  const modules = availableHubModulesForUser(user);
  return modules[0]?.path || '/modulos';
}

export function pathFromLocation(location: NavigationLocation) {
  return `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
}

function pathFromStateValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'pathname' in value) {
    return pathFromLocation(value as NavigationLocation);
  }
  return '';
}

function pathWithoutSearchAndHash(path: string) {
  return path.split('#')[0].split('?')[0] || '/';
}

function isAccountSettingsPath(path: string) {
  return pathWithoutSearchAndHash(path) === '/conta';
}

export function navigationStateFromLocation(location: NavigationLocation) {
  const from = pathFromLocation(location);
  return isAccountSettingsPath(from) ? undefined : { from };
}

export function backPathFromState(state: unknown, fallbackPath: string) {
  const from = state && typeof state === 'object' && 'from' in state
    ? pathFromStateValue((state as { from?: unknown }).from)
    : '';
  return from.startsWith('/') && !isAccountSettingsPath(from) ? from : fallbackPath;
}

export function hasBackPathInState(state: unknown) {
  return backPathFromState(state, '') !== '';
}

export function accountPageStateFromPath(pathname: string | NavigationLocation) {
  const path = typeof pathname === 'string' ? pathname || '/' : pathFromLocation(pathname);
  return isAccountSettingsPath(path) ? undefined : { from: path };
}

export function accountBackPath(user: AuthUser | null | undefined, state: unknown, fallbackPath: string) {
  return backPathFromState(state, fallbackPath || preferredEntryPath(user));
}
