import { z } from 'zod';
import { defaultWorkforceVisibilityRules, WORKFORCE_VISIBILITY_CLASSIFICATIONS, WORKFORCE_VISIBILITY_TARGETS } from '../../../../shared/modules/workforce-visibility.js';
import { publishWorkforceVisibility } from './workforce-visibility-context.js';
import { classificationWhere } from './workforce-policy.js';
import { markWorkforceForReplanning } from './workforce-classification.js';

export const WORKFORCE_VISIBILITY_SETTING_KEY = 'workforce.visibility.v1';
const classificationList = z.array(z.enum(WORKFORCE_VISIBILITY_CLASSIFICATIONS)).max(3)
  .refine(items => new Set(items).size === items.length, 'Classificação duplicada.');
const rulesSchema = z.object(Object.fromEntries(WORKFORCE_VISIBILITY_TARGETS.map(item => [item.key, classificationList]))).strict();
export const visibilityInputSchema = z.object({ version: z.number().int().positive(), rules: rulesSchema, reason: z.string().trim().min(3).max(1000) }).strict();

function normalizedRules(rules) {
  const validated = rulesSchema.parse(rules);
  return Object.fromEntries(WORKFORCE_VISIBILITY_TARGETS.map(({ key }) => [key,
    WORKFORCE_VISIBILITY_CLASSIFICATIONS.filter(value => validated[key].includes(value))
  ]));
}

export async function getWorkforceVisibility(database) {
  const row = await database.efetivoSetting.findUnique({ where: { key: WORKFORCE_VISIBILITY_SETTING_KEY } });
  const rules = row ? normalizedRules(JSON.parse(row.textValue)) : defaultWorkforceVisibilityRules();
  const version = row ? z.number().int().positive().parse(row.numberValue) : 1;
  return { version, rules, targets: WORKFORCE_VISIBILITY_TARGETS, refreshIntervalSeconds: 5,
    updatedAt: row?.updatedAt || null, updatedByUserId: row?.updatedByUserId || null };
}

export async function updateWorkforceVisibility(database, input, actorUserId) {
  const payload = visibilityInputSchema.parse(input);
  const rules = normalizedRules(payload.rules);
  const result = await database.$transaction(async tx => {
    await tx.efetivoSetting.upsert({ where: { key: WORKFORCE_VISIBILITY_SETTING_KEY }, update: {}, create: {
      key: WORKFORCE_VISIBILITY_SETTING_KEY, numberValue: 1, textValue: JSON.stringify(defaultWorkforceVisibilityRules())
    } });
    const previous = await getWorkforceVisibility(tx);
    const changed = await tx.efetivoSetting.updateMany({ where: { key: WORKFORCE_VISIBILITY_SETTING_KEY, numberValue: payload.version }, data: {
      numberValue: payload.version + 1, textValue: JSON.stringify(rules), updatedByUserId: actorUserId
    } });
    if (changed.count !== 1) throw Object.assign(new Error('As regras foram alteradas por outro administrador. Recarregue a configuração antes de salvar.'), {
      status: 409, statusCode: 409, code: 'VISIBILITY_VERSION_CONFLICT'
    });
    await tx.workforceClassificationEvent.create({ data: {
      entityType: 'VISIBILITY', entityId: 'global', actorUserId, reason: payload.reason,
      before: { rules: previous.rules }, after: { rules }
    } });
    const removed = previous.rules.EFETIVO.filter(value => !rules.EFETIVO.includes(value));
    const affected = removed.length ? await tx.collaborator.findMany({ where: { OR: removed.map(classificationWhere) }, select: { id: true } }) : [];
    const affectedMissionIds = await markWorkforceForReplanning(tx, affected.map(item => item.id));
    return { ...await getWorkforceVisibility(tx), affectedMissionIds };
  }, { timeout: 20000 });
  publishWorkforceVisibility({ version: result.version, rules: result.rules });
  return result;
}

export async function refreshWorkforceVisibility(database) {
  const configuration = await getWorkforceVisibility(database);
  publishWorkforceVisibility({ version: configuration.version, rules: configuration.rules });
  return configuration;
}

export async function startWorkforceVisibilityRefresh(database) {
  await refreshWorkforceVisibility(database);
  let refreshing = false;
  const timer = setInterval(async () => {
    if (refreshing) return;
    refreshing = true;
    try { await refreshWorkforceVisibility(database); }
    catch { console.error('[workforce-visibility] Não foi possível atualizar as regras de visibilidade.'); }
    finally { refreshing = false; }
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
