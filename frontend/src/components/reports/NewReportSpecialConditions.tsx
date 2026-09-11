import { useState } from 'react';

import type { DdsTheme } from '../../api/ddsThemes';
import type { RdoStoreState } from '../../store/rdoStore';
import type { Collaborator } from '../../types/domain';
import { Badge, Button, Card, Input, Select, Switch } from '../ui/ds';

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
  const [customThemeInputs, setCustomThemeInputs] = useState<Record<'day' | 'night', string>>({ day: '', night: '' });

  function addNightCollaboratorById(id: string) {
    if (!id) return;
    setNightCollaborators(Array.from(new Set([...nightCollaboratorIds, id])));
  }

  function renderNightCollaborators() {
    if (!nightCollaboratorIds.length) return <div className="colab-empty">Nenhum colaborador adicionado.</div>;
    return nightCollaboratorIds.map(id => {
      const item = collaborators.find(candidate => candidate.id === id);
      return (
        <Badge
          className="rdo-person-badge"
          key={`night-${id}`}
          tone="brand"
          onRemove={() => setNightCollaborators(nightCollaboratorIds.filter(candidate => candidate !== id))}
          removeLabel={`Remover ${item?.name || id}`}
        >
          {item?.name || id}
        </Badge>
      );
    });
  }

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

  function renderDdsThemeList(themes: RdoStoreState['ddsDayThemes'], shift: 'day' | 'night') {
    if (!themes.length) return <div className="colab-empty">Nenhum tema adicionado.</div>;
    return themes.map(theme => (
      <Badge
        className={theme.custom ? 'rdo-theme-badge rdo-theme-badge--custom' : 'rdo-theme-badge'}
        key={`${shift}-dds-${theme.id}`}
        tone={theme.custom ? 'info' : 'brand'}
        onRemove={() => removeDdsTheme(shift, theme.id)}
        removeLabel={`Remover tema ${theme.name}`}
      >
        {theme.custom ? `${theme.name} (novo)` : theme.name}
      </Badge>
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
        <div className="rdo-condition-switch" data-dds-novelty={isDay ? true : undefined}>
          <Switch
            label={isDay ? 'Houve DDS?' : 'Houve DDS no turno noturno?'}
            checked={enabled}
            onChange={event => setHeaderField(isDay ? 'ddsDay' : 'ddsNight', event.target.checked)}
          />
        </div>
        {enabled ? (
          <div className="collapse-section">
            <div className="fg-r2">
              <div className={fieldState(startTarget)} data-invalid-target={startTarget}>
                <label>Início <span style={{ color: 'var(--rd)' }}>*</span></label>
                <Input
                  type="time"
                  value={isDay ? ddsDayStart : ddsNightStart}
                  invalid={invalidTarget === startTarget}
                  onChange={event => setHeaderField(isDay ? 'ddsDayStart' : 'ddsNightStart', event.target.value)}
                />
              </div>
              <div className={fieldState(endTarget)} data-invalid-target={endTarget}>
                <label>Término <span style={{ color: 'var(--rd)' }}>*</span></label>
                <Input
                  type="time"
                  value={isDay ? ddsDayEnd : ddsNightEnd}
                  invalid={invalidTarget === endTarget}
                  onChange={event => setHeaderField(isDay ? 'ddsDayEnd' : 'ddsNightEnd', event.target.value)}
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
              <Select value="" aria-label="Adicionar tema de DDS" onChange={event => addDdsThemeById(event.target.value, shift)}>
                <option value="">Adicionar...</option>
                {ddsThemes
                  .filter(item => !themes.some(theme => theme.id === item.id))
                  .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </div>
            <div className="cadd">
              <Input
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
              <Button size="sm" variant="secondary" type="button" disabled={!customInput.trim()} onClick={() => addCustomDdsTheme(shift)}>
                + Add
              </Button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Card className="rdo-form-card rdo-form-card--conditions" title="Condições especiais">
      {renderDdsFields('day')}
      <div className="rdo-condition-switch">
        <Switch label="Houve standby?" checked={standby} onChange={event => setHeaderField('standby', event.target.checked)} />
      </div>
      {standby ? (
        <div className="collapse-section">
          <div className="fg-r2">
            <div className={fieldState('header:standbyDuration')} data-invalid-target="header:standbyDuration">
              <label>Tempo total <span style={{ color: 'var(--rd)' }}>*</span></label>
              <Input type="time" step={60} value={standbyDuration} invalid={invalidTarget === 'header:standbyDuration'} onChange={event => setHeaderField('standbyDuration', event.target.value)} />
            </div>
            <div className={fieldState('header:standbyMotivo')} data-invalid-target="header:standbyMotivo">
              <label>Motivo <span style={{ color: 'var(--rd)' }}>*</span></label>
              <Input type="text" placeholder="Motivo..." value={standbyMotivo} invalid={invalidTarget === 'header:standbyMotivo'} onChange={event => setHeaderField('standbyMotivo', event.target.value)} />
            </div>
          </div>
        </div>
      ) : null}
      <div className="rdo-condition-switch">
        <Switch label="Houve turno noturno?" checked={noturno} onChange={event => setHeaderField('noturno', event.target.checked)} />
      </div>
      {noturno ? (
        <div className="collapse-section noturno-section">
          <div className="fg-r2 night-time-grid">
            <div className={fieldState('header:noturnoStart')} data-invalid-target="header:noturnoStart">
              <label>Início <span style={{ color: 'var(--rd)' }}>*</span></label>
              <Input type="time" value={noturnoStart} invalid={invalidTarget === 'header:noturnoStart'} onChange={event => setHeaderField('noturnoStart', event.target.value)} />
            </div>
            <div className={fieldState('header:noturnoEnd')} data-invalid-target="header:noturnoEnd">
              <label>Término <span style={{ color: 'var(--rd)' }}>*</span></label>
              <Input type="time" value={noturnoEnd} invalid={invalidTarget === 'header:noturnoEnd'} onChange={event => setHeaderField('noturnoEnd', event.target.value)} />
            </div>
          </div>
          <div className={fieldState('header:noturnoInterval')} style={{ marginTop: 6 }} data-invalid-target="header:noturnoInterval">
            <label>Intervalo noturno</label>
            <Input type="time" step={1} value={noturnoInterval} invalid={invalidTarget === 'header:noturnoInterval'} onChange={event => setHeaderField('noturnoInterval', event.target.value)} />
          </div>
          <div className="section-title" style={{ marginTop: 14 }}>Equipe noturna</div>
          <div className={`colab-list ${invalidTarget === 'header:nightCollaborators' ? 'field-invalid-panel' : ''}`} data-invalid-target="header:nightCollaborators">
            {renderNightCollaborators()}
          </div>
          <div className="cadd">
            <Select value="" aria-label="Adicionar colaborador noturno" onChange={event => addNightCollaboratorById(event.target.value)}>
              <option value="">Adicionar...</option>
              {collaborators
                .filter(item => !nightCollaboratorIds.includes(item.id))
                .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </div>
          {renderDdsFields('night')}
        </div>
      ) : null}
    </Card>
  );
}

