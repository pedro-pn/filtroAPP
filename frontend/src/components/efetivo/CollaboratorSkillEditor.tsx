import {
  COLLABORATOR_SKILL_LEVELS,
  COLLABORATOR_SKILLS,
  collaboratorSkillLevel,
  type CollaboratorSkillLevel,
  type CollaboratorSkillLevels
} from '../../../../shared/modules/collaborator-skills.js';
import './CollaboratorSkillTags.css';
import './CollaboratorSkillEditor.css';

const LEVELS_ASCENDING = [...COLLABORATOR_SKILL_LEVELS].sort((left, right) => left.level - right.level);

// Matriz de habilidades editável: bolinhas 0–3 por habilidade, com a legenda dos níveis.
export function CollaboratorSkillEditor({ value, disabled = false, onChange }: {
  value: CollaboratorSkillLevels;
  disabled?: boolean;
  onChange: (next: CollaboratorSkillLevels) => void;
}) {
  const setLevel = (key: keyof CollaboratorSkillLevels, level: CollaboratorSkillLevel) => {
    const next = { ...value };
    if (level > 0) next[key] = level;
    else delete next[key];
    onChange(next);
  };
  return (
    <fieldset className="fv-skill-editor" disabled={disabled}>
      <legend className="fv-skill-editor__legend">Habilidades</legend>
      {COLLABORATOR_SKILLS.map(skill => {
        const current = collaboratorSkillLevel(value, skill.key);
        return (
          <div className="fv-skill-editor__row" key={skill.key}>
            <span id={`skill-${skill.key}`}>{skill.label}</span>
            <div className="fv-skill-editor__levels" role="group" aria-labelledby={`skill-${skill.key}`}>
              {LEVELS_ASCENDING.map(option => (
                <button
                  key={option.level}
                  type="button"
                  className={`fv-skill-editor__level fv-skill-level--${option.level}`}
                  aria-pressed={current === option.level}
                  aria-label={`${skill.label}: nível ${option.level} — ${option.label}`}
                  title={option.label}
                  onClick={() => setLevel(skill.key, option.level)}
                >
                  {option.level}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <ul className="fv-skill-editor__hint" aria-label="Legenda dos níveis">
        {COLLABORATOR_SKILL_LEVELS.map(option => <li key={option.level}>{option.level} · {option.label}</li>)}
      </ul>
    </fieldset>
  );
}
