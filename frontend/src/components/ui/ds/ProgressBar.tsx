import type { HTMLAttributes, ReactNode } from 'react';
import type { SemanticTone } from './types';
import { joinClassNames } from './utils';
import './styles.css';
import './ProgressBar.css';

export interface ProgressBarSegment { value: number | null; tone?: SemanticTone }
export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: number | null;
  valueLabel: ReactNode;
  tone?: SemanticTone;
  segments?: readonly ProgressBarSegment[];
}

/** The exact value stays in text, including over-budget values. Geometry is decorative. */
export function ProgressBar({ label, value, valueLabel, tone = 'brand', segments, className, ...props }: ProgressBarProps) {
  let available = 100;
  const parts = (segments ?? [{ value, tone }]).map(part => {
    const width = Math.min(available, Math.max(0, Number.isFinite(part.value) ? part.value ?? 0 : 0));
    available -= width;
    return { width, tone: part.tone ?? tone };
  });
  return <div {...props} className={joinClassNames('fv-progress-bar', className)}>
    <div className="fv-progress-bar__heading"><span>{label}</span><strong>{valueLabel}</strong></div>
    <span className="fv-progress-bar__track" aria-hidden="true">
      {parts.map((part, index) => <span key={index} className={`fv-tone--${part.tone}`} style={{ width: `${part.width}%` }} />)}
    </span>
  </div>;
}
