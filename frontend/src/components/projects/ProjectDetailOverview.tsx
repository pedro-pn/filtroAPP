import type { ReactNode } from 'react';
import type { ProjectProgress, ProgressHistoryPoint, ProgressService, RequiredWeeklyProgress } from '../../api/acompanhamentoComercial';
import { Card } from '../ui/ds';
import { AppIcon } from '../icons/AppIcon';
import { HardHat } from 'lucide-react';
import { ProgressHistoryChart } from './ProjectDetailHistory';
import { fmtPct } from './projectDetailModel';
import { projectServiceComposition } from '../../../../shared/modules/project-service-composition.js';
import { ProjectDetailSection } from './ProjectDetailSection';
import './ProjectDetailOverview.css';

type ProgressChartProps = {
  progressHistory?: ProgressHistoryPoint[];
  chartKey?: string;
  filterLabel: string;
  filters?: ReactNode;
};

type ServiceCompositionProps = {
  target?: RequiredWeeklyProgress;
  fallbackProgress?: ProjectProgress | null;
  fallbackServices?: ProgressService[];
};

export function ProjectDetailOverview({ progressHistory, chartKey, filterLabel, filters }: ProgressChartProps) {
  return <div className="acp-overview acp-detail-evolution" data-acp-project-overview>
    {filters ? <div className="acp-detail-evolution-filters">{filters}</div> : null}
    <div className="acp-overview-main">
      <Card padding="sm" className="acp-overview-chart">
        <ProjectDetailSection label="Histórico do avanço" header={<>
          <div className="acp-overview-card-head"><div><h3>Histórico do avanço</h3></div><span>Acumulado · {filterLabel || 'Escopo total'}</span></div>
        </>}>
          <ProgressHistoryChart key={chartKey} points={progressHistory} height={200} />
          <p>Percentual executado registrado ao longo do tempo. Passe o mouse ou use o teclado para consultar os pontos.</p>
        </ProjectDetailSection>
      </Card>
    </div>
  </div>;
}

export function ProjectDetailServiceComposition({ target, fallbackProgress, fallbackServices }: ServiceCompositionProps) {
  const serviceCards = projectServiceComposition({ target, fallbackProgress, fallbackServices });

  return <Card padding="sm" className="acp-detail-services" data-acp-detail-service-composition>
    <div className="acp-overview-services" id="acp-progress">
      <ProjectDetailSection label="Composição do avanço" header={<>
        <div><h3>Composição do avanço</h3><p className="acp-detail-section-subtitle">Avanço por serviço</p></div>
      </>}>
        {serviceCards.length > 0 ? <div className="acp-overview-service-grid">{serviceCards.map((service, index) => {
          const unit = service.unidade;
          const canSum = service.previsto != null && service.realizado != null;
          const planned = service.previsto ?? 0;
          const realized = service.realizado ?? 0;
          const unitLabel = service.rotuloUnidade ?? '';
          const formatQuantity = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit === 'UN' ? value === 1 ? 'unidade' : 'unidades' : unitLabel}`.trim();
          const quantity = canSum ? formatQuantity(realized) : `${service.sistemas} ${service.sistemas === 1 ? 'sistema' : 'sistemas'}`;
          const executionPct = service.avancoPct;
          return <Card padding="sm" className="acp-overview-service" key={`${service.escopo ?? ''}-${service.servico}-${index}`}>
            {service.escopo ? <small>Escopo: {service.escopo}</small> : null}
            {service.equipamento ? <small>{service.rotuloServico}</small> : null}
            <div className="acp-overview-service-head"><span className="acp-overview-service-icon"><AppIcon icon={HardHat} size="sm" /></span><strong>{service.equipamento ?? service.rotuloServico}</strong><b>{fmtPct(executionPct)}</b></div>
            <div className="acp-overview-service-quantity"><strong>{quantity}</strong>{canSum ? <span>de {formatQuantity(planned)} {unit === 'UN' ? 'previstas' : 'previstos'}</span> : null}</div>
            <div className="acp-overview-service-track" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, executionPct ?? 0))}%` }} /></div>
            <div className="acp-overview-service-foot"><span>{executionPct != null && executionPct >= 100 ? 'Meta atingida' : service.equipamento ? 'Avanço do equipamento' : 'Avanço do serviço'}</span>{canSum && realized > planned ? <strong>+{formatQuantity(realized - planned)} {realized - planned === 1 ? 'excedente' : 'excedentes'}</strong> : null}</div>
          </Card>;
        })}</div> : <p className="acp-overview-empty">Ainda não há composição de avanço calculada para este recorte.</p>}
      </ProjectDetailSection>

    </div>

  </Card>;
}
