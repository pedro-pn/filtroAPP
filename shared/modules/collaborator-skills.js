// Matriz de habilidades dos colaboradores operacionais (Efetivo).
// Gravada em Collaborator.skillLevels como { [chave]: nível }; chave ausente = nível 0.

export const COLLABORATOR_SKILLS = Object.freeze([
  Object.freeze({ key: 'FLUSHING', label: 'Flushing', shortLabel: 'Flushing' }),
  Object.freeze({ key: 'CHEMICAL_CLEANING', label: 'Limpeza química', shortLabel: 'Limp. química' }),
  Object.freeze({ key: 'FILTRATION', label: 'Filtragem', shortLabel: 'Filtragem' }),
  Object.freeze({ key: 'HYDROJETTING', label: 'Hidrojato', shortLabel: 'Hidrojato' }),
  Object.freeze({ key: 'HYDROSTATIC_TEST', label: 'Teste hidrostático', shortLabel: 'Teste hidro.' })
]);

export const COLLABORATOR_SKILL_LEVELS = Object.freeze([
  Object.freeze({ level: 3, tone: 'success', label: 'Apto / executa com autonomia' }),
  Object.freeze({ level: 2, tone: 'info', label: 'Intermediário / executa com supervisão' }),
  Object.freeze({ level: 1, tone: 'warning', label: 'Em desenvolvimento / conhecimento básico' }),
  Object.freeze({ level: 0, tone: 'neutral', label: 'Sem experiência ou não avaliado' })
]);

export const COLLABORATOR_SKILL_KEYS = Object.freeze(COLLABORATOR_SKILLS.map(skill => skill.key));
export const MAX_COLLABORATOR_SKILL_LEVEL = 3;

const SKILL_KEY_SET = new Set(COLLABORATOR_SKILL_KEYS);

export function isCollaboratorSkillKey(value) {
  return typeof value === 'string' && SKILL_KEY_SET.has(value);
}

export function isCollaboratorSkillLevel(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COLLABORATOR_SKILL_LEVEL;
}

// Normaliza qualquer valor (JSON do banco, payload) para { chave: 1..3 }:
// descarta chaves desconhecidas e níveis inválidos e omite o nível 0.
export function normalizeCollaboratorSkillLevels(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of COLLABORATOR_SKILL_KEYS) {
    const level = value[key];
    if (isCollaboratorSkillLevel(level) && level > 0) result[key] = level;
  }
  return result;
}

export function collaboratorSkillLevel(levels, key) {
  const level = levels && typeof levels === 'object' ? levels[key] : undefined;
  return isCollaboratorSkillLevel(level) ? level : 0;
}

export function collaboratorSkillLevelMeta(level) {
  return COLLABORATOR_SKILL_LEVELS.find(item => item.level === level) ?? COLLABORATOR_SKILL_LEVELS[COLLABORATOR_SKILL_LEVELS.length - 1];
}

// Lista as habilidades na ordem do catálogo, com o nível de cada uma.
export function collaboratorSkillEntries(levels, { includeZero = false } = {}) {
  return COLLABORATOR_SKILLS
    .map(skill => ({ ...skill, level: collaboratorSkillLevel(levels, skill.key) }))
    .filter(entry => includeZero || entry.level > 0);
}

// Atende ao filtro "habilidade X com nível mínimo N"? Sem habilidade selecionada, todos atendem.
export function meetsCollaboratorSkill(levels, key, minLevel = 1) {
  if (!key) return true;
  return collaboratorSkillLevel(levels, key) >= Math.max(1, Number(minLevel) || 1);
}

// Soma dos níveis: usada para ordenar listas por qualificação geral.
export function collaboratorSkillScore(levels) {
  return COLLABORATOR_SKILL_KEYS.reduce((total, key) => total + collaboratorSkillLevel(levels, key), 0);
}

// Devolve uma cópia da matriz com o nível da habilidade trocado; o nível 0 remove a chave.
export function withCollaboratorSkillLevel(levels, key, level) {
  const next = normalizeCollaboratorSkillLevels(levels);
  if (isCollaboratorSkillKey(key) && isCollaboratorSkillLevel(level) && level > 0) next[key] = level;
  else delete next[key];
  return next;
}
