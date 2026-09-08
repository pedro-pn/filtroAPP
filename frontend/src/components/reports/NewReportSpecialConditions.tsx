import { useState } from 'react';

import type { DdsTheme } from '../../api/ddsThemes';
import type { RdoStoreState } from '../../store/rdoStore';
import type { Collaborator } from '../../types/domain';
import { ReportNightShiftFields } from './ReportCoreFields';

interface NewReportSpecialConditionsProps {
  collaborators: Collaborator[];
  ddsThemes: DdsTheme[];
  invalidTarget: string | null;
  standby: boolean;
  standbyDuration: string;
  standbyMotivo: string;
  noturno: boolean;
  noturnoStart: string;
  noturnoEnd: string;
  noturnoInterval: string;
  nightCollaboratorIds: string[];
  ddsDay: boolean;
  ddsDayStart: string;
  ddsDayEnd: string;
  ddsDayThemes: RdoStoreState['ddsDayThemes'];
  ddsNight: boolean;
  ddsNightStart: string;
  ddsNightEnd: string;
  ddsNightThemes: RdoStoreState['ddsNightThemes'];
  setHeaderField: RdoStoreState['setHeaderField'];
  setNightCollaborators: RdoStoreState['setNightCollaborators'];
  addDdsTheme: RdoStoreState['addDdsTheme'];
  removeDdsTheme: RdoStoreState['removeDdsTheme'];
  fieldState: (target: string) => string;
}

export function NewReportSpecialConditions({
  collaborators,
  ddsThemes,
  invalidTarget,
  standby,
  standbyDuration,
  standbyMotivo,
  noturno,
  noturnoStart,
  noturnoEnd,
  noturnoInterval,
  nightCollaboratorIds,
  ddsDay,
  ddsDayStart,
  ddsDayEnd,
  ddsDayThemes,
  ddsNight,
  ddsNightStart,
  ddsNightEnd,
  ddsNightThemes,
  setHeaderField,
  setNightCollaborators,
  addDdsTheme,
  removeDdsTheme,
  fieldState
}: NewReportSpecialConditionsProps) {
  const [customThemeInputs, setCustomThemeInputs] = useState<
    Record<'day' | 'night', string>
  >({ day: '', night: '' });

  function addDdsThemeById(id: string, shift: 'day' | 'night') {
    if (!id) return;
    const theme = ddsThemes.find((item) => item.id === id);
    if (theme) addDdsTheme(shift, { id: theme.id, name: theme.name });
  }

  function addCustomDdsTheme(shift: 'day' | 'night') {
    const name = customThemeInputs[shift].trim();
    if (!name) return;
    const selected = shift === 'day' ? ddsDayThemes : ddsNightThemes;
    setCustomThemeInputs((current) => ({ ...current, [shift]: '' }));
    if (
      selected.some(
        (item) => item.name.trim().toLowerCase() === name.toLowerCase()
      )
    )
      return;
    const existing = ddsThemes.find(
      (item) => item.name.trim().toLowerCase() === name.toLowerCase()
    );
    addDdsTheme(
      shift,
      existing
        ? { id: existing.id, name: existing.name }
        : {
            id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            custom: true
          }
    );
  }

  function renderDdsThemeList(
    themes: RdoStoreState['ddsDayThemes'],
    shift: 'day' | 'night'
  ) {
    if (!themes.length)
      return <div className="colab-empty">Nenhum tema adicionado.</div>;
    return themes.map((theme) => (
      <span
        className={`colab-tag ${theme.custom ? 'colab-tag-custom' : ''}`}
        key={`${shift}-dds-${theme.id}`}
      >
        <span>{theme.custom ? `${theme.name} (novo)` : theme.name}</span>
        <button type="button" onClick={() => removeDdsTheme(shift, theme.id)}>
          ×
        </button>
      </span>
    ));
  }

  function renderDdsFields(shift: 'day' | 'night') {
    const isDay = shift === 'day';
    const enabled = isDay ? ddsDay : ddsNight;
    const themes = isDay ? ddsDayThemes : ddsNightThemes;
    const startTarget = isDay ? 'header:ddsDayStart' : 'header:ddsNightStart';
    const endTarget = isDay ? 'header:ddsDayEnd' : 'header:ddsNightEnd';
    const themesTarget = isDay
      ? 'header:ddsDayThemes'
      : 'header:ddsNightThemes';
    const customInput = customThemeInputs[shift];

    return (
      <>
        <div
          className="tog-row"
          data-dds-novelty={isDay ? true : undefined}
          style={isDay ? undefined : { marginTop: 14 }}
        >
          <span className="tog-lbl">
            {isDay ? 'Houve DDS?' : 'Houve DDS no turno noturno?'}
          </span>
          <label className="tog">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) =>
                setHeaderField(
                  isDay ? 'ddsDay' : 'ddsNight',
                  event.target.checked
                )
              }
            />
            <span className="tog-sl" />
          </label>
        </div>
        {enabled ? (
          <div className="collapse-section">
            <div className="fg-r2">
              <div
                className={fieldState(startTarget)}
                data-invalid-target={startTarget}
              >
                <label>
                  Início <span style={{ color: 'var(--rd)' }}>*</span>
                </label>
                <input
                  type="time"
                  value={isDay ? ddsDayStart : ddsNightStart}
                  onChange={(event) =>
                    setHeaderField(
                      isDay ? 'ddsDayStart' : 'ddsNightStart',
                      event.target.value
                    )
                  }
                />
              </div>
              <div
                className={fieldState(endTarget)}
                data-invalid-target={endTarget}
              >
                <label>
                  Término <span style={{ color: 'var(--rd)' }}>*</span>
                </label>
                <input
                  type="time"
                  value={isDay ? ddsDayEnd : ddsNightEnd}
                  onChange={(event) =>
                    setHeaderField(
                      isDay ? 'ddsDayEnd' : 'ddsNightEnd',
                      event.target.value
                    )
                  }
                />
              </div>
            </div>
            <div className="section-title" style={{ marginTop: 14 }}>
              Temas abordados <span style={{ color: 'var(--rd)' }}>*</span>
            </div>
            <div
              className={`colab-list ${invalidTarget === themesTarget ? 'field-invalid-panel' : ''}`}
              data-invalid-target={themesTarget}
            >
              {renderDdsThemeList(themes, shift)}
            </div>
            <div className="cadd">
              <select
                value=""
                onChange={(event) => addDdsThemeById(event.target.value, shift)}
              >
                <option value="">Adicionar...</option>
                {ddsThemes
                  .filter(
                    (item) => !themes.some((theme) => theme.id === item.id)
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="cadd">
              <input
                id={`rdo-dds-custom-theme-${shift}`}
                aria-label={`Adicionar tema personalizado do DDS (${shift === 'night' ? 'noturno' : 'diurno'})`}
                value={customInput}
                placeholder="Tema fora da lista? Digite aqui..."
                onChange={(event) =>
                  setCustomThemeInputs((current) => ({
                    ...current,
                    [shift]: event.target.value
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addCustomDdsTheme(shift);
                }}
              />
              <button
                className="cadd-btn"
                type="button"
                disabled={!customInput.trim()}
                onClick={() => addCustomDdsTheme(shift)}
              >
                + Add
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="page-card">
      <div className="section-title">Condições especiais</div>
      {renderDdsFields('day')}
      <div className="tog-row">
        <span className="tog-lbl">Houve standby?</span>
        <label className="tog">
          <input
            type="checkbox"
            checked={standby}
            onChange={(event) =>
              setHeaderField('standby', event.target.checked)
            }
          />
          <span className="tog-sl" />
        </label>
      </div>
      {standby ? (
        <div className="collapse-section">
          <div className="fg-r2">
            <div
              className={fieldState('header:standbyDuration')}
              data-invalid-target="header:standbyDuration"
            >
              <label htmlFor="rdo-standby-duration">
                Tempo total <span style={{ color: 'var(--rd)' }}>*</span>
              </label>
              <input
                id="rdo-standby-duration"
                type="time"
                step={60}
                value={standbyDuration}
                onChange={(event) =>
                  setHeaderField('standbyDuration', event.target.value)
                }
              />
            </div>
            <div
              className={fieldState('header:standbyMotivo')}
              data-invalid-target="header:standbyMotivo"
            >
              <label htmlFor="rdo-standby-reason">
                Motivo <span style={{ color: 'var(--rd)' }}>*</span>
              </label>
              <input
                id="rdo-standby-reason"
                type="text"
                placeholder="Motivo..."
                value={standbyMotivo}
                onChange={(event) =>
                  setHeaderField('standbyMotivo', event.target.value)
                }
              />
            </div>
          </div>
        </div>
      ) : null}
      <ReportNightShiftFields
        idPrefix="rdo"
        collaborators={collaborators}
        enabled={noturno}
        arrivalTime={noturnoStart}
        departureTime={noturnoEnd}
        breakTime={noturnoInterval}
        collaboratorIds={nightCollaboratorIds}
        onEnabledChange={(value) => setHeaderField('noturno', value)}
        onArrivalTimeChange={(value) => setHeaderField('noturnoStart', value)}
        onDepartureTimeChange={(value) => setHeaderField('noturnoEnd', value)}
        onBreakTimeChange={(value) => setHeaderField('noturnoInterval', value)}
        onCollaboratorIdsChange={setNightCollaborators}
        arrivalError={
          invalidTarget === 'header:noturnoStart'
            ? 'Informe o horário.'
            : undefined
        }
        departureError={
          invalidTarget === 'header:noturnoEnd'
            ? 'Informe o horário.'
            : undefined
        }
        breakTimeError={
          invalidTarget === 'header:noturnoInterval'
            ? 'Informe o intervalo.'
            : undefined
        }
        collaboratorsError={
          invalidTarget === 'header:nightCollaborators'
            ? 'Selecione ao menos um colaborador.'
            : undefined
        }
      >
        {renderDdsFields('night')}
      </ReportNightShiftFields>
    </section>
  );
}
