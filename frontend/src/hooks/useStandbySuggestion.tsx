import { useEffect, useRef, useState } from 'react';
import { StandbySuggestionReview, type StandbyReviewResult } from '../components/reports/StandbySuggestionReview';
import { suggestStandby, type StandbyFields, type StandbyReportInput } from '../utils/standbySuggestion';

export function useStandbySuggestion({ input, scope, enabled, disabled = false, reviewer, onApply }: {
  input: StandbyReportInput;
  scope: string;
  enabled: boolean;
  disabled?: boolean;
  reviewer: boolean;
  onApply: (fields: StandbyFields) => void;
}) {
  const suggestion = enabled ? suggestStandby(input) : null;
  const key = suggestion ? `${scope}:${suggestion.key}` : '';
  const [acknowledgedKey, setAcknowledgedKey] = useState('');
  const [mode, setMode] = useState<'inline' | 'submit' | null>(null);
  const resolver = useRef<((result: StandbyReviewResult) => void) | null>(null);
  const visible = suggestion !== null && key !== acknowledgedKey;

  useEffect(() => {
    setMode(null);
    return () => {
      resolver.current?.('cancel');
      resolver.current = null;
    };
  }, [scope]);

  useEffect(() => {
    if (visible) return;
    resolver.current?.('cancel');
    resolver.current = null;
    setMode(null);
  }, [visible]);

  function resolve(result: StandbyReviewResult) {
    const pending = resolver.current;
    resolver.current = null;
    if (typeof result === 'object') onApply(result);
    if (result !== 'cancel') setAcknowledgedKey(key);
    setMode(null);
    pending?.(result);
  }

  function reviewBeforeSubmit(): Promise<StandbyReviewResult> {
    if (!visible) return Promise.resolve('skip');
    resolver.current?.('cancel');
    setMode('submit');
    return new Promise(resolve => { resolver.current = resolve; });
  }

  return {
    reviewBeforeSubmit,
    review: visible ? (
      <StandbySuggestionReview
        suggestion={suggestion}
        existing={input}
        reviewer={reviewer}
        disabled={disabled}
        mode={mode}
        onOpen={() => setMode('inline')}
        onDismiss={() => setAcknowledgedKey(key)}
        onResolve={resolve}
      />
    ) : null
  };
}
