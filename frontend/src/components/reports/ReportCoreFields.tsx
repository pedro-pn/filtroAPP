import type { ReactNode } from 'react';

import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';
import {
  formatReportMinutes,
  type ReportOvertimeSummary
} from '../../utils/reportOvertime';

export interface ReportCollaboratorOption {
  id: string;
  name: string;
  role?: string | null;
  jobRole?: { name: string } | null;
}

function requiredMark(required: boolean) {
  return required ? <span style={{ color: 'var(--rd)' }}> *</span> : null;
}

export function RequiredMark() {
  return requiredMark(true);
}

function fieldClass(invalid?: boolean) {
  return invalid ? 'field-group field-invalid' : 'field-group';
}

export function ReportFormStepper({
  steps,
  currentStep,
  onSelect,
  children
}: {
  steps: string[];
  currentStep: number;
  onSelect: (step: number) => void;
  children?: ReactNode;
}) {
  return (
    <section className="page-card rdo-step-panel">
      <div className="rdo-progress-track" aria-hidden="true">
        <div
          className="rdo-progress-fill"
          style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
        />
      </div>
      <div
        className="filter-tabs"
        role="tablist"
        aria-label="Etapas do relatório"
        onKeyDown={handleHorizontalTabListKeyDown}
      >
        {steps.map((label, index) => (
          <button
            className={`filter-tab ${currentStep === index ? 'active' : ''}`}
            key={label}
            type="button"
            role="tab"
            aria-selected={currentStep === index}
            onClick={() => onSelect(index)}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </section>
  );
}

export function ReportDateField({
  id,
  value,
  onChange,
  label = 'Data do relatório',
  required = true,
  invalid,
  error,
  invalidTarget,
  children
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  invalid?: boolean;
  error?: string;
  invalidTarget?: string;
  children?: ReactNode;
}) {
  return (
    <div className={fieldClass(invalid)} data-invalid-target={invalidTarget}>
      <label htmlFor={id}>
        {label}
        {requiredMark(required)}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        aria-invalid={Boolean(invalid)}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      {error ? <div className="field-error">{error}</div> : null}
      {children}
    </div>
  );
}

export function ReportScheduleCard({
  idPrefix,
  arrivalTime,
  departureTime,
  lunchBreak,
  onArrivalTimeChange,
  onDepartureTimeChange,
  onLunchBreakChange,
  arrivalError,
  departureError,
  lunchBreakError,
  arrivalInvalidTarget,
  departureInvalidTarget,
  lunchBreakInvalidTarget,
  lunchBreakLabel = 'Intervalo de almoço'
}: {
  idPrefix: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  onArrivalTimeChange: (value: string) => void;
  onDepartureTimeChange: (value: string) => void;
  onLunchBreakChange: (value: string) => void;
  arrivalError?: string;
  departureError?: string;
  lunchBreakError?: string;
  arrivalInvalidTarget?: string;
  departureInvalidTarget?: string;
  lunchBreakInvalidTarget?: string;
  lunchBreakLabel?: string;
}) {
  return (
    <section className="page-card">
      <div className="section-title">Horários</div>
      <div className="fg-r2">
        <div
          className={fieldClass(Boolean(arrivalError))}
          data-invalid-target={arrivalInvalidTarget}
        >
          <label htmlFor={`${idPrefix}-arrival`}>
            Chegada{requiredMark(true)}
          </label>
          <input
            id={`${idPrefix}-arrival`}
            type="time"
            value={arrivalTime}
            aria-invalid={Boolean(arrivalError)}
            onChange={(event) => onArrivalTimeChange(event.target.value)}
            required
          />
          {arrivalError ? (
            <div className="field-error">{arrivalError}</div>
          ) : null}
        </div>
        <div
          className={fieldClass(Boolean(departureError))}
          data-invalid-target={departureInvalidTarget}
        >
          <label htmlFor={`${idPrefix}-departure`}>
            Saída{requiredMark(true)}
          </label>
          <input
            id={`${idPrefix}-departure`}
            type="time"
            value={departureTime}
            aria-invalid={Boolean(departureError)}
            onChange={(event) => onDepartureTimeChange(event.target.value)}
            required
          />
          {departureError ? (
            <div className="field-error">{departureError}</div>
          ) : null}
        </div>
      </div>
      <div
        className={fieldClass(Boolean(lunchBreakError))}
        style={{ marginTop: 10 }}
        data-invalid-target={lunchBreakInvalidTarget}
      >
        <label htmlFor={`${idPrefix}-lunch`}>
          {lunchBreakLabel}
          {requiredMark(true)}
        </label>
        <input
          id={`${idPrefix}-lunch`}
          type="time"
          step={1}
          value={lunchBreak}
          aria-invalid={Boolean(lunchBreakError)}
          onChange={(event) => onLunchBreakChange(event.target.value)}
          required
        />
        {lunchBreakError ? (
          <div className="field-error">{lunchBreakError}</div>
        ) : null}
      </div>
    </section>
  );
}

function CollaboratorTags({
  collaborators,
  selectedIds,
  onChange,
  keyPrefix
}: {
  collaborators: ReportCollaboratorOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  keyPrefix: string;
}) {
  if (!selectedIds.length)
    return <div className="colab-empty">Nenhum colaborador adicionado.</div>;

  return selectedIds.map((id) => {
    const collaborator = collaborators.find((item) => item.id === id);
    const roleName =
      collaborator?.jobRole?.name ||
      collaborator?.role ||
      'Cargo não informado';
    return (
      <span className="colab-tag" key={`${keyPrefix}-${id}`}>
        <span className="colab-tag-copy">
          <span>{collaborator?.name || id}</span>
          <small className="colab-tag-role">{roleName}</small>
        </span>
        <button
          type="button"
          aria-label={`Remover ${collaborator?.name || id}`}
          onClick={() => onChange(selectedIds.filter((item) => item !== id))}
        >
          ×
        </button>
      </span>
    );
  });
}

export function ReportCollaboratorPicker({
  collaborators,
  selectedIds,
  onChange,
  invalid,
  error,
  invalidTarget,
  keyPrefix = 'day'
}: {
  collaborators: ReportCollaboratorOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
  error?: string;
  invalidTarget?: string;
  keyPrefix?: string;
}) {
  return (
    <>
      <div
        className={`colab-list ${invalid ? 'field-invalid-panel' : ''}`}
        data-invalid-target={invalidTarget}
      >
        <CollaboratorTags
          collaborators={collaborators}
          selectedIds={selectedIds}
          onChange={onChange}
          keyPrefix={keyPrefix}
        />
      </div>
      <div className="cadd">
        <select
          value=""
          aria-label="Adicionar colaborador"
          onChange={(event) => {
            const id = event.target.value;
            if (id) onChange(Array.from(new Set([...selectedIds, id])));
          }}
        >
          <option value="">Adicionar...</option>
          {collaborators
            .filter((item) => !selectedIds.includes(item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </div>
      {error ? <div className="field-error">{error}</div> : null}
    </>
  );
}

export function ReportCollaboratorsCard({
  collaborators,
  selectedIds,
  onChange,
  invalid,
  error,
  invalidTarget,
  showTitle = true,
  required = true,
  children
}: {
  collaborators: ReportCollaboratorOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
  error?: string;
  invalidTarget?: string;
  showTitle?: boolean;
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="page-card">
      {showTitle ? (
        <div className="section-title">
          Equipe diurna{requiredMark(required)}
        </div>
      ) : null}
      {children}
      <ReportCollaboratorPicker
        collaborators={collaborators}
        selectedIds={selectedIds}
        onChange={onChange}
        invalid={invalid}
        error={error}
        invalidTarget={invalidTarget}
      />
    </section>
  );
}

export function ReportNightShiftFields({
  idPrefix,
  collaborators,
  enabled,
  arrivalTime,
  departureTime,
  breakTime,
  collaboratorIds,
  onEnabledChange,
  onArrivalTimeChange,
  onDepartureTimeChange,
  onBreakTimeChange,
  onCollaboratorIdsChange,
  arrivalError,
  departureError,
  breakTimeError,
  collaboratorsError,
  invalidTargetPrefix = 'header',
  children
}: {
  idPrefix: string;
  collaborators: ReportCollaboratorOption[];
  enabled: boolean;
  arrivalTime: string;
  departureTime: string;
  breakTime: string;
  collaboratorIds: string[];
  onEnabledChange: (value: boolean) => void;
  onArrivalTimeChange: (value: string) => void;
  onDepartureTimeChange: (value: string) => void;
  onBreakTimeChange: (value: string) => void;
  onCollaboratorIdsChange: (ids: string[]) => void;
  arrivalError?: string;
  departureError?: string;
  breakTimeError?: string;
  collaboratorsError?: string;
  invalidTargetPrefix?: string;
  children?: ReactNode;
}) {
  const target = (name: string) => `${invalidTargetPrefix}:${name}`;
  return (
    <>
      <div className="tog-row">
        <span className="tog-lbl">Houve turno noturno?</span>
        <label className="tog">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span className="tog-sl" />
        </label>
      </div>
      {enabled ? (
        <div className="collapse-section noturno-section">
          <div className="fg-r2 night-time-grid">
            <div
              className={fieldClass(Boolean(arrivalError))}
              data-invalid-target={target('noturnoStart')}
            >
              <label htmlFor={`${idPrefix}-night-start`}>
                Início{requiredMark(true)}
              </label>
              <input
                id={`${idPrefix}-night-start`}
                type="time"
                value={arrivalTime}
                aria-invalid={Boolean(arrivalError)}
                onChange={(event) => onArrivalTimeChange(event.target.value)}
                required
              />
              {arrivalError ? (
                <div className="field-error">{arrivalError}</div>
              ) : null}
            </div>
            <div
              className={fieldClass(Boolean(departureError))}
              data-invalid-target={target('noturnoEnd')}
            >
              <label htmlFor={`${idPrefix}-night-end`}>
                Término{requiredMark(true)}
              </label>
              <input
                id={`${idPrefix}-night-end`}
                type="time"
                value={departureTime}
                aria-invalid={Boolean(departureError)}
                onChange={(event) => onDepartureTimeChange(event.target.value)}
                required
              />
              {departureError ? (
                <div className="field-error">{departureError}</div>
              ) : null}
            </div>
          </div>
          <div
            className={fieldClass(Boolean(breakTimeError))}
            style={{ marginTop: 6 }}
            data-invalid-target={target('noturnoInterval')}
          >
            <label htmlFor={`${idPrefix}-night-break`}>
              Intervalo noturno{requiredMark(true)}
            </label>
            <input
              id={`${idPrefix}-night-break`}
              type="time"
              step={1}
              value={breakTime}
              aria-invalid={Boolean(breakTimeError)}
              onChange={(event) => onBreakTimeChange(event.target.value)}
              required
            />
            {breakTimeError ? (
              <div className="field-error">{breakTimeError}</div>
            ) : null}
          </div>
          <div className="section-title" style={{ marginTop: 14 }}>
            Equipe noturna{requiredMark(true)}
          </div>
          <ReportCollaboratorPicker
            collaborators={collaborators}
            selectedIds={collaboratorIds}
            onChange={onCollaboratorIdsChange}
            invalid={Boolean(collaboratorsError)}
            error={collaboratorsError}
            invalidTarget={target('nightCollaborators')}
            keyPrefix="night"
          />
          {children}
        </div>
      ) : null}
    </>
  );
}

export function ReportOvertimeCard({
  summary,
  nightEnabled,
  reason,
  onReasonChange,
  error
}: {
  summary: ReportOvertimeSummary;
  nightEnabled: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  error?: string;
}) {
  const lines = [
    `Turno diurno: trabalhado ${formatReportMinutes(summary.daytimeWorkedMinutes)} | extra ${formatReportMinutes(summary.daytimeOvertimeMinutes)}`,
    ...(nightEnabled || summary.nighttimeWorkedMinutes
      ? [
          `Turno noturno: trabalhado ${formatReportMinutes(summary.nighttimeWorkedMinutes)} | extra ${formatReportMinutes(summary.nighttimeOvertimeMinutes)}`
        ]
      : []),
    summary.expectedMinutes
      ? `Jornada de referência: ${formatReportMinutes(summary.expectedMinutes)}${summary.isHoliday ? ' | feriado detectado' : ''}`
      : summary.isHoliday
        ? 'Feriado detectado: todo o período trabalhado será considerado hora extra.'
        : 'Data com regime integral de hora extra conforme configuração do projeto.'
  ];
  const hasOvertime = summary.totalOvertimeMinutes > 0;

  return (
    <section className="page-card">
      <div className="section-title">Horas extras</div>
      <div
        style={{
          fontSize: 12,
          color: hasOvertime ? 'var(--rd)' : 'var(--mu)',
          lineHeight: 1.7,
          marginBottom: 10
        }}
      >
        {hasOvertime ? (
          <strong>
            Hora extra identificada:{' '}
            {formatReportMinutes(summary.totalOvertimeMinutes)}
          </strong>
        ) : (
          'Nenhuma hora extra identificada.'
        )}
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      {hasOvertime ? (
        <div className={fieldClass(Boolean(error))}>
          <label htmlFor="report-overtime-reason">Justificativa</label>
          <textarea
            id="report-overtime-reason"
            placeholder="Descreva o motivo das horas extras..."
            rows={3}
            value={reason}
            aria-invalid={Boolean(error)}
            onChange={(event) => onReasonChange(event.target.value)}
          />
          {error ? <div className="field-error">{error}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export function ReportActivitiesCard({
  value,
  onChange,
  invalid,
  error,
  label = 'Descrição geral',
  required = false
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  error?: string;
  label?: string;
  required?: boolean;
}) {
  return (
    <section className="page-card">
      <div className="section-title">Atividades do dia</div>
      <div className={fieldClass(invalid)}>
        <label htmlFor="report-daily-description">
          {label}{requiredMark(required)}
        </label>
        <textarea
          id="report-daily-description"
          style={{ minHeight: 100 }}
          placeholder="Descreva as atividades realizadas..."
          rows={5}
          value={value}
          aria-invalid={Boolean(invalid)}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    </section>
  );
}

export function ReportSummaryCard({ children }: { children: ReactNode }) {
  return (
    <section className="page-card resumo-card">
      <div className="resumo-card-title">Resumo</div>
      <div className="resumo-txt">{children}</div>
    </section>
  );
}

export function ReportFormActions({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSubmit,
  submitting,
  submitLabel = 'Enviar relatório ✓',
  submittingLabel = 'Enviando...'
}: {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
  submittingLabel?: string;
}) {
  return (
    <section className="page-card rdo-bottom-actions">
      <button className="secondary-button" type="button" onClick={onBack}>
        {currentStep === 0 ? 'Cancelar' : '← Voltar'}
      </button>
      {currentStep < totalSteps - 1 ? (
        <button className="primary-button" type="button" onClick={onNext}>
          Próximo →
        </button>
      ) : (
        <button
          className="primary-button"
          type="button"
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
      )}
    </section>
  );
}
