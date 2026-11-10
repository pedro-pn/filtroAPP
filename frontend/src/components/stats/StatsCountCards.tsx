import type { ReactNode } from 'react';
import { MetricCard, type SemanticTone } from '../ui/ds';

export function OverviewCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stats-ov-count-card">
      <div className="stats-ov-count-value">{value}</div>
      <div className="stats-ov-count-label">{label}</div>
    </div>
  );
}

export function DesignSystemOverviewCountCard({
  label,
  value,
  description,
  icon,
  tone
}: {
  label: string;
  value: number;
  description?: string;
  icon?: ReactNode;
  tone?: SemanticTone;
}) {
  return (
    <MetricCard
      className="stats-ov-count-card rdo-stats-overview__count-card"
      label={label}
      value={value}
      description={description}
      icon={icon}
      tone={tone}
    />
  );
}
