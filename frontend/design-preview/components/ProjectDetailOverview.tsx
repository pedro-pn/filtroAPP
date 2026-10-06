// Cópia isolada para prévia. Fonte: frontend/src/components/projects/ProjectDetailOverview.tsx
import { PreviewSection } from '../PreviewSection';
import type { ReactNode } from 'react';
import type { ProjectDetail, ProjectProgress, ProgressHistoryPoint, ProgressService, RequiredWeeklyProgress } from '../../src/api/acompanhamentoComercial';
import type { WeeklyTargetOwner } from '../../src/api/weeklyProgressTargets';
import { Card } from '../../src/components/ui/ds';
import { AppIcon } from '../../src/components/icons/AppIcon';
import { HardHat } from 'lucide-react';
import { ProgressHistoryChart } from '../../src/components/projects/ProjectDetailHistory';
import { fmtPct, physicalUnit, SERVICE_LABELS, UNIT_LABELS } from '../../src/components/projects/projectDetailModel';
import '../../src/components/projects/ProjectDetailOverview.css';

type OverviewSystem = {
  equipment?: string | null;
  systemName?: string | null;
  systemType: string;
  unit: string | null;
  plannedQty: number | null;
  realizedQty: number | null;
};

type OverviewService = {
  serviceType: string;
  scopeName: string | null;
  executionPct: number | null;
  systems: OverviewSystem[];
};

function progressOfSystems(systems: OverviewSystem[]) {
  const byType = new Map<string, { planned: number; realized: number }>();
  for (const system of systems) {
    if (system.plannedQty == null || system.plannedQty <= 0 || system.realizedQty == null) continue;
    const metric = byType.get(system.systemType) ?? { planned: 0, realized: 0 };
    metric.planned += system.plannedQty;
    metric.realized += system.realizedQty;
    byType.set(system.systemType, metric);
  }
  return byType.size
    ? Math.round([...byType.values()].reduce((sum, metric) => sum + metric.realized / metric.planned * 100, 0) / byType.size * 10) / 10
    : null;
}

type OverviewProps = {
  data: ProjectDetail;
  progressPct: number | null;
  progressHistory?: ProgressHistoryPoint[];
  chartKey?: string;
  target?: RequiredWeeklyProgress;
  fallbackProgress?: ProjectProgress | null;
  fallbackServices?: ProgressService[];
  filterLabel: string;
  filters?: ReactNode;
  teamCount: number;
  teamIsPlanned?: boolean;
  deviationCount: number | null;
  weeklyTargetOwner?: WeeklyTargetOwner | null;
  weeklyProgressHistory?: ProgressHistoryPoint[];
};

export function ProjectDetailOverview({ progressHistory, chartKey, filterLabel, filters }: OverviewProps) {
  return <div className="acp-overview preview-evolution" data-acp-project-overview>
    {filters ? <div className="preview-evolution-filters">{filters}</div> : null}
    <div className="acp-overview-main">
      <Card padding="sm" className="acp-overview-chart">
<PreviewSection label="Histórico do avanço" header={<>
        <div className="acp-overview-card-head"><div><h3>Histórico do avanço</h3></div><span>Acumulado · {filterLabel || 'Escopo total'}</span></div>
</>}>
        <ProgressHistoryChart key={chartKey} points={progressHistory} height={200} />
        <p>Percentual executado registrado ao longo do tempo. Passe o mouse ou use o teclado para consultar os pontos.</p>

</PreviewSection>
      </Card>
    </div>
  </div>;
}

export function ProjectDetailServiceComposition({ target, fallbackProgress, fallbackServices }: OverviewProps) {
  const groupedServices = target?.scopeGroups?.flatMap(group => group.services.map(service => ({ ...service, scopeName: group.scopeName })));
  const targetServices = groupedServices?.length ? groupedServices : target?.services.map(service => ({ ...service, scopeName: null })) ?? [];
  const groupedFallbackServices = fallbackProgress?.scopeGroups?.flatMap(group => group.services.map(service => ({ ...service, scopeName: group.scopeName })));
  const fallbackProgressServices = groupedFallbackServices?.length ? groupedFallbackServices : fallbackProgress?.services.map(service => ({ ...service, scopeName: null })) ?? [];
  const services: OverviewService[] = targetServices.length ? targetServices : fallbackProgressServices.length ? fallbackProgressServices : fallbackServices?.map(service => ({ ...service, scopeName: null })) ?? [];
  const serviceCards = services.flatMap(service => {
    const linkedUnits = service.systems.filter(system => system.systemType === 'SISTEMA' && (system.equipment?.trim() || system.systemName?.trim()));
    if (!linkedUnits.length) {
      return [{ ...service, equipmentName: null }];
    }
    const systemsByEquipment = new Map<string, OverviewSystem[]>();
    for (const system of linkedUnits) {
      const equipmentName = system.equipment?.trim() || system.systemName?.trim() || '';
      const systems = systemsByEquipment.get(equipmentName) ?? [];
      systems.push(system);
      systemsByEquipment.set(equipmentName, systems);
    }
    const otherSystems = service.systems.filter(system => !linkedUnits.includes(system));
    return [
      ...(otherSystems.length ? [{ ...service, systems: otherSystems, executionPct: progressOfSystems(otherSystems), equipmentName: null }] : []),
      ...[...systemsByEquipment].map(([equipmentName, systems]) => ({ ...service, systems, executionPct: progressOfSystems(systems), equipmentName }))
    ];
  });

  return <Card padding="sm" className="preview-services" data-preview-service-composition>
    <div className="acp-overview-services" id="acp-progress">
<PreviewSection label="Composição do avanço" header={<>
      <div><h3>Composição do avanço</h3><p className="preview-section-subtitle">Avanço por serviço</p></div>
</>}>
      {serviceCards.length > 0 ? <div className="acp-overview-service-grid">{serviceCards.map((service, index) => {
        const measured = service.systems.filter(system => system.plannedQty != null && system.realizedQty != null);
        const unit = measured[0] ? physicalUnit(measured[0].systemType, measured[0].unit) : null;
        const canSum = measured.length === service.systems.length && measured.length > 0 && measured.every(system => physicalUnit(system.systemType, system.unit) === unit);
        const realized = measured.reduce((sum, system) => sum + (system.realizedQty ?? 0), 0);
        const planned = measured.reduce((sum, system) => sum + (system.plannedQty ?? 0), 0);
        const unitLabel = unit ? UNIT_LABELS[unit] ?? unit : '';
        const formatQuantity = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit === 'UN' ? value === 1 ? 'unidade' : 'unidades' : unitLabel}`.trim();
        const quantity = canSum ? formatQuantity(realized) : `${service.systems.length} ${service.systems.length === 1 ? 'sistema' : 'sistemas'}`;
        const executionPct = service.executionPct;
        return <Card padding="sm" className="acp-overview-service" key={`${service.scopeName ?? ''}-${service.serviceType}-${index}`}>
          {service.scopeName ? <small>Escopo: {service.scopeName}</small> : null}
          {service.equipmentName ? <small>{SERVICE_LABELS[service.serviceType] ?? service.serviceType}</small> : null}
          <div className="acp-overview-service-head"><span className="acp-overview-service-icon"><AppIcon icon={HardHat} size="sm" /></span><strong>{service.equipmentName ?? SERVICE_LABELS[service.serviceType] ?? service.serviceType}</strong><b>{fmtPct(executionPct)}</b></div>
          <div className="acp-overview-service-quantity"><strong>{quantity}</strong>{canSum ? <span>de {formatQuantity(planned)} {unit === 'UN' ? 'previstas' : 'previstos'}</span> : null}</div>
          <div className="acp-overview-service-track" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, executionPct ?? 0))}%` }} /></div>
          <div className="acp-overview-service-foot"><span>{executionPct != null && executionPct >= 100 ? 'Meta atingida' : service.equipmentName ? 'Avanço do equipamento' : 'Avanço do serviço'}</span>{canSum && realized > planned ? <strong>+{formatQuantity(realized - planned)} {realized - planned === 1 ? 'excedente' : 'excedentes'}</strong> : null}</div>
        </Card>;
      })}</div> : <p className="acp-overview-empty">Ainda não há composição de avanço calculada para este recorte.</p>}
</PreviewSection>

    </div>

  </Card>;
}
