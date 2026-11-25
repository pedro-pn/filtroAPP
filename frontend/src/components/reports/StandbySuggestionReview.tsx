import { useId, useState } from 'react';
import { reviewedStandbyFields, standbyMinutesAfterBreaks, type StandbyBreak, type StandbyFields, type StandbySuggestion } from '../../utils/standbySuggestion';
import { formatReportMinutes, parseDurationToMinutes } from '../../utils/reportOvertime';
import { StandbyBreakQuestion } from './StandbyBreakQuestion';
import { Modal } from '../ui/Modal';
import { Alert, Button, Input, Textarea } from '../ui/ds';
import './StandbySuggestionReview.css';

export type StandbyReviewResult = StandbyFields | 'skip' | 'cancel';

interface StandbySuggestionReviewProps {
  suggestion: StandbySuggestion;
  existing: StandbyFields;
  reviewer: boolean;
  disabled: boolean;
  mode: 'inline' | 'submit' | null;
  onOpen: () => void;
  onDismiss: () => void;
  onResolve: (result: StandbyReviewResult) => void;
}

export function StandbySuggestionReview({ suggestion, existing, reviewer, disabled, mode, onOpen, onDismiss, onResolve }: StandbySuggestionReviewProps) {
  return (
    <>
      <Alert tone="warning" className="standby-suggestion" title="Pausas identificadas — sugestão de standby">
        <p>
          {suggestion.duration
            ? `As anotações indicam ${suggestion.duration} de paralisação.${suggestion.breaks.length ? ' Confirme se o período incluiu o intervalo.' : ' Confira o total e o motivo sugeridos.'}`
            : 'As anotações mencionam uma pausa. Confira os trechos e informe o tempo total antes de aplicar.'}
        </p>
        {!reviewer ? <p>A sugestão também aparecerá para o revisor se o standby ficar sem preenchimento.</p> : null}
        <div className="standby-suggestion__actions">
          <Button size="sm" disabled={disabled} onClick={onOpen}>Revisar sugestão</Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onDismiss}>Ignorar sugestão</Button>
        </div>
      </Alert>
      {mode ? (
        <StandbySuggestionDialog
          key={suggestion.key}
          suggestion={suggestion}
          existing={existing}
          submitting={mode === 'submit'}
          onResolve={onResolve}
        />
      ) : null}
    </>
  );
}

function StandbySuggestionDialog({ suggestion, existing, submitting, onResolve }: {
  suggestion: StandbySuggestion;
  existing: StandbyFields;
  submitting: boolean;
  onResolve: (result: StandbyReviewResult) => void;
}) {
  const id = useId();
  const [editedDuration, setEditedDuration] = useState<string | null>(null);
  const [editedReason, setEditedReason] = useState<string | null>(null);
  const [deductions, setDeductions] = useState<Partial<Record<StandbyBreak['id'], number>>>({});
  const calculatedMinutes = standbyMinutesAfterBreaks(suggestion, deductions);
  const answered = !suggestion.breaks.length || calculatedMinutes !== null;
  const deductedMinutes = Object.values(deductions).reduce((sum, value) => sum + (value || 0), 0);
  const duration = editedDuration ?? (calculatedMinutes === null ? suggestion.duration : formatReportMinutes(calculatedMinutes));
  const deductionText = suggestion.breaks.filter(option => (deductions[option.id] || 0) > 0)
    .map(option => `${option.label}: descontado ${formatReportMinutes(deductions[option.id] || 0)}.`).join(' ');
  const reason = editedReason ?? [suggestion.reason, deductionText].filter(Boolean).join(' ');
  const onlyBreak = answered && calculatedMinutes === 0 && duration === '00:00';
  const valid = /^\d{2}:[0-5]\d$/.test(duration) && Number(duration.slice(0, 2)) < 24
    && answered && (parseDurationToMinutes(duration) > 0 ? Boolean(reason.trim()) : onlyBreak);
  return (
    <Modal
      open
      title="Revisar sugestão de standby"
      appearance="design-system"
      size="md"
      onClose={() => onResolve('cancel')}
      footer={(
        <div className="standby-suggestion__actions">
          <Button variant="ghost" onClick={() => onResolve('cancel')}>Voltar ao relatório</Button>
          {submitting ? <Button variant="secondary" onClick={() => onResolve('skip')}>Continuar sem aplicar</Button> : null}
          <Button variant="primary" disabled={!valid} onClick={() => onResolve(reviewedStandbyFields(suggestion, duration, reason, deductedMinutes))}>
            {onlyBreak ? 'Confirmar sem standby' : submitting ? 'Aplicar e continuar' : 'Aplicar standby'}
          </Button>
        </div>
      )}
    >
      <div className="standby-suggestion__editor">
        <p>Confira as pausas identificadas nas anotações. Você pode ajustar o total e o motivo antes de preencher o standby.</p>
        {suggestion.warnings.map(warning => <Alert key={warning} tone="warning">{warning}</Alert>)}
        {existing.standby ? (
          <Alert tone="info">
            Standby atual: {existing.standbyDuration || 'tempo não informado'}; motivo: {existing.standbyMotivo || 'não informado'}.
            {' '}Ao aplicar, o tempo e o motivo atuais serão substituídos pelos valores abaixo.
          </Alert>
        ) : null}
        <details open>
          <summary>Trechos identificados</summary>
          <ul className="standby-suggestion__evidence">
            {suggestion.evidence.map((item, index) => <li key={index}><strong>{item.source}:</strong> {item.text}</li>)}
          </ul>
        </details>
        {suggestion.breaks.map(option => (
          <StandbyBreakQuestion key={option.id} option={option} onChange={minutes => {
            setDeductions(current => ({ ...current, [option.id]: minutes }));
            setEditedDuration(null);
          }} />
        ))}
        {suggestion.breaks.length && calculatedMinutes !== null ? (
          <Alert tone="info">
            Períodos identificados: {suggestion.duration}. Intervalo descontado: {formatReportMinutes(deductedMinutes)}.
            {' '}Standby calculado: {formatReportMinutes(calculatedMinutes)}.
            {onlyBreak ? ' O período corresponde apenas ao intervalo; ao confirmar, o standby ficará desmarcado.' : null}
          </Alert>
        ) : null}
        <div className="field-group">
          <label htmlFor={`${id}-duration`}>Tempo total de standby</label>
          <Input id={`${id}-duration`} type="time" step={60} required value={duration} onChange={event => setEditedDuration(event.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor={`${id}-reason`}>Motivo sugerido</label>
          <Textarea id={`${id}-reason`} rows={4} required value={reason} onChange={event => setEditedReason(event.target.value)} />
        </div>
        <p>As anotações originais serão preservadas. O standby será preenchido apenas ao aplicar a sugestão.</p>
      </div>
    </Modal>
  );
}
