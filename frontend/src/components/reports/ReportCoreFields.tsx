import type { ReactNode } from 'react';

import { Button, Card, Field, Input, ProgressSteps, Select, Switch, Textarea } from '../ui/ds';
import './ReportCollaboratorTags.css';
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
  return required ? <span style={{ color: 'var(--danger)' }}> *</span> : null;
}

export function RequiredMark() {
  return requiredMark(true);
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
    <Card className="operational-form-stepper" padding="md">
      <ProgressSteps
        labels={steps}
        currentIndex={currentStep}
        onSelect={onSelect}
        ariaLabel="Etapas do relatório"
        onKeyDown={handleHorizontalTabListKeyDown}
      />
      {children}
    </Card>
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
    <Field id={id} label={label} required={required} optionalText="" errorText={error} data-invalid-target={invalidTarget}>
      <Input
        type="date"
        value={value}
        aria-invalid={Boolean(invalid)}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      {children}
    </Field>
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
    <Card className="operational-form-card" title="Horários">
      <div className="operational-form-time-grid">
        <Field id={`${idPrefix}-arrival`} label="Chegada" required errorText={arrivalError} data-invalid-target={arrivalInvalidTarget}>
          <Input
            type="time"
            value={arrivalTime}
            aria-invalid={Boolean(arrivalError)}
            onChange={(event) => onArrivalTimeChange(event.target.value)}
            required
          />
        </Field>
        <Field id={`${idPrefix}-departure`} label="Saída" required errorText={departureError} data-invalid-target={departureInvalidTarget}>
          <Input
            type="time"
            value={departureTime}
            aria-invalid={Boolean(departureError)}
            onChange={(event) => onDepartureTimeChange(event.target.value)}
            required
          />
        </Field>
      </div>
      <Field id={`${idPrefix}-lunch`} label={lunchBreakLabel} required errorText={lunchBreakError} data-invalid-target={lunchBreakInvalidTarget}>
        <Input
          type="time"
          step={1}
          value={lunchBreak}
          aria-invalid={Boolean(lunchBreakError)}
          onChange={(event) => onLunchBreakChange(event.target.value)}
          required
        />
      </Field>
    </Card>
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
      <span className="colab-tag report-collaborator-tag" key={`${keyPrefix}-${id}`}>
        <span className="colab-tag-copy">
          <span>{collaborator?.name || id}</span>
          <small className="colab-tag-role">{roleName}</small>
        </span>
        <button
          className="colab-tag__remove"
          type="button"
          aria-label={`Remover ${collaborator?.name || id}`}
          title="Remover"
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
        <Select
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
        </Select>
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
    <Card className="operational-form-card" title={showTitle ? <>Equipe diurna{requiredMark(required)}</> : undefined}>
      {children}
      <ReportCollaboratorPicker
        collaborators={collaborators}
        selectedIds={selectedIds}
        onChange={onChange}
        invalid={invalid}
        error={error}
        invalidTarget={invalidTarget}
      />
    </Card>
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
      <Switch label="Houve turno noturno?" checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)} />
      {enabled ? (
        <div className="operational-form-night-fields">
          <div className="operational-form-time-grid">
            <Field id={`${idPrefix}-night-start`} label="Início" required errorText={arrivalError} data-invalid-target={target('noturnoStart')}>
              <Input
                type="time"
                value={arrivalTime}
                aria-invalid={Boolean(arrivalError)}
                onChange={(event) => onArrivalTimeChange(event.target.value)}
                required
              />
            </Field>
            <Field id={`${idPrefix}-night-end`} label="Término" required errorText={departureError} data-invalid-target={target('noturnoEnd')}>
              <Input
                type="time"
                value={departureTime}
                aria-invalid={Boolean(departureError)}
                onChange={(event) => onDepartureTimeChange(event.target.value)}
                required
              />
            </Field>
          </div>
          <Field id={`${idPrefix}-night-break`} label="Intervalo noturno" required errorText={breakTimeError} data-invalid-target={target('noturnoInterval')}>
            <Input
              type="time"
              step={1}
              value={breakTime}
              aria-invalid={Boolean(breakTimeError)}
              onChange={(event) => onBreakTimeChange(event.target.value)}
              required
            />
          </Field>
          <div className="operational-form-section-title">
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
    <Card className="operational-form-card" title="Horas extras">
      <div className={`operational-overtime-summary${hasOvertime ? ' is-overtime' : ''}`}>
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
        <Field id="report-overtime-reason" label="Justificativa" optionalText="" errorText={error}>
          <Textarea
            placeholder="Descreva o motivo das horas extras..."
            rows={3}
            value={reason}
            aria-invalid={Boolean(error)}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </Field>
      ) : null}
    </Card>
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
    <Card className="operational-form-card" title="Atividades do dia">
      <Field id="report-daily-description" label={label} required={required} optionalText="" errorText={error}>
        <Textarea
          style={{ minHeight: 100 }}
          placeholder="Descreva as atividades realizadas..."
          rows={5}
          value={value}
          aria-invalid={Boolean(invalid)}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    </Card>
  );
}

export function ReportSummaryCard({ children }: { children: ReactNode }) {
  return (
    <Card className="operational-form-card operational-form-summary" title="Resumo">
      <div className="operational-form-summary__content">{children}</div>
    </Card>
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
    <div className="operational-form-actions">
      <Button variant="secondary" type="button" onClick={onBack}>
        {currentStep === 0 ? 'Cancelar' : '← Voltar'}
      </Button>
      {currentStep < totalSteps - 1 ? (
        <Button variant="primary" type="button" onClick={onNext}>
          Próximo →
        </Button>
      ) : (
        <Button
          variant="primary"
          type="button"
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? submittingLabel : submitLabel}
        </Button>
      )}
    </div>
  );
}
