import { SortableTable } from '../ui/SortableTable';
import {
  COLLABORATOR_SKILL_LEVELS,
  COLLABORATOR_SKILLS,
  collaboratorSkillLevel,
  collaboratorSkillLevelMeta,
  collaboratorSkillScore,
  type CollaboratorSkillKey,
  type CollaboratorSkillLevel,
  type CollaboratorSkillLevels
} from '../../../../shared/modules/collaborator-skills.js';
import './CollaboratorSkillTags.css';
import './CollaboratorSkillMatrix.css';

export type CollaboratorSkillMatrixRow = {
  id: string;
  name: string;
  role?: string | null;
  skillLevels?: CollaboratorSkillLevels | null;
};

type SkillKey = CollaboratorSkillKey;

const LEVELS_ASCENDING = [...COLLABORATOR_SKILL_LEVELS].sort((left, right) => left.level - right.level);

// Visão por habilidades: uma linha por colaborador e uma coluna por habilidade com o nível 0–3.
// Em modo de edição, cada célula vira um seletor 0–3 e cada clique chama onLevelChange.
export function CollaboratorSkillMatrix({ rows, selectedId, onSelect, editing = false, savingIds, onLevelChange }: {
  rows: CollaboratorSkillMatrixRow[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  editing?: boolean;
  /** Colaboradores com gravação em andamento. */
  savingIds?: ReadonlySet<string>;
  onLevelChange?: (row: CollaboratorSkillMatrixRow, key: SkillKey, level: CollaboratorSkillLevel) => void;
}) {
  return (
    <>
      <div className="efetivo-table-wrap">
        <SortableTable className={`efetivo-table fv-skill-matrix${editing ? ' is-editing' : ''}`}>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Função</th>
              {COLLABORATOR_SKILLS.map(skill => <th key={skill.key} className="fv-skill-matrix__level-col" title={skill.label}>{skill.label}</th>)}
              <th className="fv-skill-matrix__level-col" title="Soma dos níveis">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const score = collaboratorSkillScore(row.skillLevels);
              const saving = savingIds?.has(row.id) ?? false;
              return (
                <tr
                  key={row.id}
                  data-collaborator-id={row.id}
                  className={selectedId === row.id ? 'selected' : ''}
                  aria-current={selectedId === row.id ? 'true' : undefined}
                  aria-busy={saving || undefined}
                  onClick={editing ? undefined : () => onSelect?.(row.id)}
                >
                  <td data-label="Colaborador"><strong>{row.name}</strong></td>
                  <td data-label="Função">{row.role || '—'}</td>
                  {COLLABORATOR_SKILLS.map(skill => {
                    const level = collaboratorSkillLevel(row.skillLevels, skill.key);
                    const meta = collaboratorSkillLevelMeta(level);
                    return (
                      <td key={skill.key} data-label={skill.label} data-sort-value={level} className="fv-skill-matrix__level-col">
                        {editing ? (
                          <div className="fv-skill-matrix__picker" role="group" aria-label={`${row.name} — ${skill.label}`}>
                            {LEVELS_ASCENDING.map(option => (
                              <button
                                key={option.level}
                                type="button"
                                className={`fv-skill-matrix__option fv-skill-level--${option.level}`}
                                aria-pressed={level === option.level}
                                aria-label={`${skill.label}: nível ${option.level} — ${option.label}`}
                                title={option.label}
                                onClick={() => { if (level !== option.level) onLevelChange?.(row, skill.key, option.level); }}
                              >
                                {option.level}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span
                            className={`fv-skill-matrix__level fv-skill-level--${level}`}
                            title={`${skill.label}: nível ${level} — ${meta.label}`}
                            aria-label={`nível ${level}, ${meta.label}`}
                          >
                            {level}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td data-label="Total" data-sort-value={score} className="fv-skill-matrix__level-col fv-skill-matrix__total">{score ? score : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </SortableTable>
      </div>
      <ul className="fv-skill-matrix__legend" aria-label="Legenda dos níveis">
        {COLLABORATOR_SKILL_LEVELS.map(option => (
          <li key={option.level}>
            <span className={`fv-skill-matrix__level fv-skill-level--${option.level}`} aria-hidden="true">{option.level}</span>
            {option.label}
          </li>
        ))}
      </ul>
    </>
  );
}
