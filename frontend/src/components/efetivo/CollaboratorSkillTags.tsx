import {
  collaboratorSkillEntries,
  collaboratorSkillLevelMeta,
  type CollaboratorSkillLevels
} from '../../../../shared/modules/collaborator-skills.js';
import './CollaboratorSkillTags.css';

type CollaboratorSkillTagsProps = {
  skillLevels?: CollaboratorSkillLevels | null;
  /** Mostra também as habilidades no nível 0 (sem experiência ou não avaliado). */
  includeZero?: boolean;
  /** Texto exibido quando nenhuma habilidade foi avaliada; omita para não renderizar nada. */
  emptyLabel?: string;
  className?: string;
};

// Tags de habilidade: chip neutro com o nível (0–3) numa bolinha colorida + nome da habilidade.
export function CollaboratorSkillTags({ skillLevels, includeZero = false, emptyLabel, className }: CollaboratorSkillTagsProps) {
  const entries = collaboratorSkillEntries(skillLevels, { includeZero })
    .sort((left, right) => right.level - left.level);
  const classes = ['fv-skill-tags', className].filter(Boolean).join(' ');
  if (!entries.length) return emptyLabel ? <span className={`${classes} fv-skill-tags--empty`}>{emptyLabel}</span> : null;
  return (
    <ul className={classes} aria-label="Habilidades">
      {entries.map(entry => {
        const meta = collaboratorSkillLevelMeta(entry.level);
        return (
          <li
            key={entry.key}
            className={`fv-skill-tag fv-skill-level--${entry.level}`}
            title={`${entry.label}: nível ${entry.level} — ${meta.label}`}
          >
            <span className="fv-skill-tag__level" aria-hidden="true">{entry.level}</span>
            <span className="fv-skill-tag__label">{entry.shortLabel}</span>
            <span className="fv-sr-only">{`: nível ${entry.level}, ${meta.label}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
