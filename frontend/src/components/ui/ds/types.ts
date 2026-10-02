export type ControlSize = 'sm' | 'md' | 'lg';

export type SemanticTone =
  'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export type FeedbackTone = Exclude<SemanticTone, 'neutral' | 'brand'>;
