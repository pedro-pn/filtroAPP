import { useState, type ReactNode } from 'react';

import type { Collaborator } from '../../types/domain';

export interface DdsThemeSnapshot {
  id: string;
  name: string;
  // Tema digitado fora da lista oficial; fica pendente de validação do gestor na revisão do RDO.
  custom?: boolean;
}

export interface ManualReportOperationalFieldsValue {
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  collaboratorIds: string[];
  noturno: boolean;
  noturnoStart: string;
  noturnoEnd: string;
  noturnoInterval: string;
  noturnoCollaboratorIds: string[];
  standby: boolean;
  standbyDuration: string;
  standbyMotivo: string;
  ddsDay: boolean;
  ddsDayStart: string;
  ddsDayEnd: string;
  ddsDayThemes: DdsThemeSnapshot[];
  ddsNight: boolean;
  ddsNightStart: string;
  ddsNightEnd: string;
  ddsNightThemes: DdsThemeSnapshot[];
}

interface ManualReportOperationalFieldsProps {
  value: ManualReportOperationalFieldsValue;
  collaborators: Collaborator[];
  ddsThemes?: DdsThemeSnapshot[];
  disabled?: boolean;
  defaultOpen?: boolean;
  embedded?: boolean;
  showTimes?: boolean;
  showNightShift?: boolean;
  showStandby?: boolean;
  showDds?: boolean;
  includeInactiveCollaborators?: boolean;
  // Aviso exibido logo abaixo do bloco de DDS diurno (ex.: temas fora da lista aguardando validação).
  ddsAlert?: ReactNode;
  summaryLabel?: string;
  teamLabel?: string;
  onChange: (patch: Partial<ManualReportOperationalFieldsValue>) => void;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function collaboratorLabel(collaborator: Collaborator) {
  const label = [collaborator.name, collaborator.role].filter(Boolean).join(' - ');
  return collaborator.isActive === false ? `${label} (inativo)` : label;
}

function collaboratorName(collaborators: Collaborator[], id: string) {
  const collaborator = collaborators.find(item => item.id === id);
  if (!collaborator) return id;
  return collaboratorLabel(collaborator);
}

export function ManualReportOperationalFields({
  value,
  collaborators,
  ddsThemes = [],
  disabled = false,
  embedded = false,
  showTimes = true,
  showNightShift = false,
  showStandby = false,
  showDds = false,
  includeInactiveCollaborators = false,
  ddsAlert = null,
  summaryLabel = 'Dados operacionais (opcional)',
  teamLabel = 'Equipe diurna',
  onChange
}: ManualReportOperationalFieldsProps) {
  const [customThemeInputs, setCustomThemeInputs] = useState<Record<string, string>>({});

  function renderSelected(ids: string[], field: 'collaboratorIds' | 'noturnoCollaboratorIds') {
    if (!ids.length) return <div className="colab-empty">Nenhum colaborador adicionado.</div>;

    return ids.map(id => (
      <span className="colab-tag" key={`${field}-${id}`}>
        <span>{collaboratorName(collaborators, id)}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ [field]: ids.filter(item => item !== id) })}
          aria-label="Remover colaborador"
        >
          ×
        </button>
      </span>
    ));
  }

  function renderPicker(
    ids: string[],
    field: 'collaboratorIds' | 'noturnoCollaboratorIds'
  ) {
    return (
      <>
        <div className="colab-list">
          {renderSelected(ids, field)}
        </div>
        <div className="cadd">
          <select
            value=""
            disabled={disabled}
            onChange={event => {
              const selectedId = event.target.value;
              if (!selectedId) return;
              onChange({ [field]: unique([...ids, selectedId]) });
            }}
          >
            <option value="">Adicionar...</option>
            {collaborators
              .filter(item => includeInactiveCollaborators || item.isActive !== false)
              .filter(item => !ids.includes(item.id))
              .map(item => (
                <option key={item.id} value={item.id}>
                  {collaboratorLabel(item)}
                </option>
              ))}
          </select>
        </div>
      </>
    );
  }

  function addCustomTheme(field: 'ddsDayThemes' | 'ddsNightThemes') {
    const selected = value[field];
    const name = (customThemeInputs[field] || '').trim();
    if (!name) return;
    setCustomThemeInputs(current => ({ ...current, [field]: '' }));
    if (selected.some(item => item.name.trim().toLowerCase() === name.toLowerCase())) return;
    // Se o texto digitado corresponde a um tema oficial, vincula a ele em vez de criar um avulso.
    const existing = ddsThemes.find(item => item.name.trim().toLowerCase() === name.toLowerCase());
    const theme: DdsThemeSnapshot = existing
      ? { id: existing.id, name: existing.name }
      : { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, custom: true };
    onChange({ [field]: [...selected, theme] });
  }

  function renderThemePicker(field: 'ddsDayThemes' | 'ddsNightThemes') {
    const selected = value[field];
    return (
      <>
        <div className="colab-list">
          {selected.length ? (
            selected.map(theme => (
              <span className={`colab-tag ${theme.custom ? 'colab-tag-custom' : ''}`} key={`${field}-${theme.id}`}>
                <span>{theme.custom ? `${theme.name} (novo)` : theme.name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ [field]: selected.filter(item => item.id !== theme.id) })}
                  aria-label="Remover tema"
                >
                  ×
                </button>
              </span>
            ))
          ) : (
            <div className="colab-empty">Nenhum tema adicionado.</div>
          )}
        </div>
        <div className="cadd">
          <select
            value=""
            disabled={disabled}
            onChange={event => {
              const selectedId = event.target.value;
              if (!selectedId) return;
              const theme = ddsThemes.find(item => item.id === selectedId);
              if (!theme || selected.some(item => item.id === theme.id)) return;
              onChange({ [field]: [...selected, { id: theme.id, name: theme.name }] });
            }}
          >
            <option value="">Adicionar...</option>
            {ddsThemes
              .filter(item => !selected.some(theme => theme.id === item.id))
              .map(item => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>
        </div>
        <div className="cadd">
          <input
            value={customThemeInputs[field] || ''}
            disabled={disabled}
            aria-label="Tema fora da lista"
            placeholder="Tema fora da lista? Digite aqui..."
            onChange={event => setCustomThemeInputs(current => ({ ...current, [field]: event.target.value }))}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addCustomTheme(field);
            }}
          />
          <button
            className="cadd-btn"
            type="button"
            disabled={disabled || !(customThemeInputs[field] || '').trim()}
            onClick={() => addCustomTheme(field)}
          >
            + Add
          </button>
        </div>
      </>
    );
  }

  function renderDdsFields(shift: 'day' | 'night') {
    const enabled = shift === 'day' ? value.ddsDay : value.ddsNight;
    const startField = shift === 'day' ? 'ddsDayStart' : 'ddsNightStart';
    const endField = shift === 'day' ? 'ddsDayEnd' : 'ddsNightEnd';
    const enabledField = shift === 'day' ? 'ddsDay' : 'ddsNight';

    return (
      <>
        <div className="tog-row">
          <span className="tog-lbl">{shift === 'day' ? 'Houve DDS?' : 'Houve DDS no turno noturno?'}</span>
          <label className="tog">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled}
              onChange={event => onChange({ [enabledField]: event.target.checked })}
            />
            <span className="tog-sl" />
          </label>
        </div>
        {enabled ? (
          <div className="collapse-section">
            <div className="fg-r2">
              <div className="field-group">
                <label>Início</label>
                <input
                  type="time"
                  value={value[startField]}
                  disabled={disabled}
                  onChange={event => onChange({ [startField]: event.target.value })}
                />
              </div>
              <div className="field-group">
                <label>Término</label>
                <input
                  type="time"
                  value={value[endField]}
                  disabled={disabled}
                  onChange={event => onChange({ [endField]: event.target.value })}
                />
              </div>
            </div>
            <div className="section-title manual-operational-subtitle">Temas abordados</div>
            {renderThemePicker(shift === 'day' ? 'ddsDayThemes' : 'ddsNightThemes')}
          </div>
        ) : null}
      </>
    );
  }

  const body = (
    <>
      {showTimes ? (
        <section className="manual-operational-section">
          <div className="section-title">Horários</div>
          <div className="fg-r2">
            <div className="field-group">
              <label>Chegada</label>
              <input
                type="time"
                value={value.arrivalTime}
                disabled={disabled}
                onChange={event => onChange({ arrivalTime: event.target.value })}
              />
            </div>
            <div className="field-group">
              <label>Saída</label>
              <input
                type="time"
                value={value.departureTime}
                disabled={disabled}
                onChange={event => onChange({ departureTime: event.target.value })}
              />
            </div>
          </div>
          <div className="field-group manual-operational-lunch">
            <label>Intervalo de almoço</label>
            <input
              type="time"
              step={1}
              value={value.lunchBreak}
              disabled={disabled}
              onChange={event => onChange({ lunchBreak: event.target.value })}
            />
          </div>
        </section>
      ) : null}

      <section className="manual-operational-section">
        <div className="section-title">{teamLabel}</div>
        {renderPicker(value.collaboratorIds, 'collaboratorIds')}
      </section>

      {showNightShift || showStandby || showDds ? (
        <section className="manual-operational-section">
          <div className="section-title">Condições especiais</div>

          {showDds ? renderDdsFields('day') : null}
          {showDds ? ddsAlert : null}

          {showStandby ? (
            <>
              <div className="tog-row">
                <span className="tog-lbl">Houve standby?</span>
                <label className="tog">
                  <input
                    type="checkbox"
                    checked={value.standby}
                    disabled={disabled}
                    onChange={event => onChange({ standby: event.target.checked })}
                  />
                  <span className="tog-sl" />
                </label>
              </div>
              {value.standby ? (
                <div className="collapse-section">
                  <div className="fg-r2">
                    <div className="field-group">
                      <label>Tempo total</label>
                      <input
                        type="time"
                        step={1}
                        value={value.standbyDuration}
                        disabled={disabled}
                        onChange={event => onChange({ standbyDuration: event.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Motivo</label>
                      <input
                        value={value.standbyMotivo}
                        disabled={disabled}
                        onChange={event => onChange({ standbyMotivo: event.target.value })}
                        placeholder="Motivo do stand-by"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {showNightShift ? (
            <>
              <div className="tog-row">
                <span className="tog-lbl">Houve turno noturno?</span>
                <label className="tog">
                  <input
                    type="checkbox"
                    checked={value.noturno}
                    disabled={disabled}
                    onChange={event => onChange({ noturno: event.target.checked })}
                  />
                  <span className="tog-sl" />
                </label>
              </div>
              {value.noturno ? (
                <div className="collapse-section noturno-section">
                  <div className="fg-r2 night-time-grid">
                    <div className="field-group">
                      <label>Início</label>
                      <input
                        type="time"
                        value={value.noturnoStart}
                        disabled={disabled}
                        onChange={event => onChange({ noturnoStart: event.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Término</label>
                      <input
                        type="time"
                        value={value.noturnoEnd}
                        disabled={disabled}
                        onChange={event => onChange({ noturnoEnd: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="field-group manual-operational-lunch">
                    <label>Intervalo noturno</label>
                    <input
                      type="time"
                      step={1}
                      value={value.noturnoInterval}
                      disabled={disabled}
                      onChange={event => onChange({ noturnoInterval: event.target.value })}
                    />
                  </div>
                  <div className="section-title manual-operational-subtitle">Equipe noturna</div>
                  {renderPicker(value.noturnoCollaboratorIds, 'noturnoCollaboratorIds')}
                  {showDds ? renderDdsFields('night') : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );

  return (
    <div
      className={`manual-operational-sections ${embedded ? 'manual-operational-fields-embedded' : ''}`}
      aria-label={summaryLabel}
    >
      {body}
    </div>
  );
}
