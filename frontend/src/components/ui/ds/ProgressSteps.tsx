import type { KeyboardEventHandler } from 'react';

import { joinClassNames } from './utils';
import './form.css';

export interface ProgressStepsProps {
  labels: readonly string[];
  currentIndex: number;
  onSelect: (index: number) => void;
  isDisabled?: (index: number) => boolean;
  ariaLabel?: string;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

export function ProgressSteps({
  labels,
  currentIndex,
  onSelect,
  isDisabled = (index) => index > currentIndex + 1,
  ariaLabel = 'Etapas',
  className,
  onKeyDown
}: ProgressStepsProps) {
  return (
    <div
      className={joinClassNames(
        'fv-progress-steps',
        `fv-progress-steps--${Math.min(Math.max(labels.length, 2), 4)}`,
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {labels.map((label, index) => {
        const disabled = isDisabled(index);
        const state =
          index < currentIndex
            ? 'complete'
            : index === currentIndex
              ? 'current'
              : 'upcoming';

        return (
          <button
            className="fv-progress-steps__item"
            key={label}
            type="button"
            role="tab"
            aria-selected={index === currentIndex}
            aria-current={index === currentIndex ? 'step' : undefined}
            aria-disabled={disabled || undefined}
            data-state={state}
            onClick={() => {
              if (!disabled) onSelect(index);
            }}
          >
            <span
              className="fv-progress-steps__connector"
              aria-hidden="true"
            />
            <span className="fv-progress-steps__marker" aria-hidden="true">
              {index + 1}
            </span>
            <span className="fv-progress-steps__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
