import type { ReactNode } from 'react';
import type { ProjectDetail, ProjectProgress, ProgressHistoryPoint, ProgressService, RequiredWeeklyProgress } from '../../api/acompanhamentoComercial';
import { Card } from '../ui/ds';
import { AppIcon } from '../icons/AppIcon';
import { Activity, ArrowUpRight, CalendarClock, ClipboardList, Gauge, HardHat, Truck, UsersRound, Wallet, TriangleAlert } from 'lucide-react';
import { ProgressHistoryChart } from './ProjectDetailHistory';
import { brl, fmtDate, fmtPct, physicalUnit, SERVICE_LABELS, UNIT_LABELS, weeklyPhysicalProgress } from './projectDetailModel';
import './ProjectDetailOverview.css';

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
};

export function ProjectDetailOverview({ data, progressPct, progressHistory, chartKey, target, fallbackProgress, fallbackServices, filterLabel, filters, teamCount, teamIsPlanned = false, deviationCount }: OverviewProps) {
  const totalRealizado = data.consumo.gasto + (data.maoDeObra.custo ?? 0);
  const previsto = data.consumo.previsto;
  const costPct = previsto != null && previsto > 0 ? Math.round(totalRealizado / previsto * 100) : null;
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
  const firstAlert = data.alerts[0];
  const reading = firstAlert?.label ?? (
    target?.status === 'OVERDUE' ? 'O prazo previsto para concluir o escopo foi ultrapassado.'
      : target?.status === 'DUE_TODAY' ? 'O prazo previsto para concluir o escopo é hoje.'
        : target?.status === 'COMPLETED' ? 'O avanço registrado atingiu a meta do escopo.'
          : target?.requiredPctPointsPerWeek != null ? `Para atingir a meta, o ritmo necessário é de ${weeklyPhysicalProgress(target)}.`
            : 'Consulte o histórico e as metas cadastradas para acompanhar a execução.'
  );

  return <div className="acp-overview" data-acp-project-overview>
    <div className="acp-overview-heading">
      <div>
        <p className="acp-overview-kicker">Visão geral</p>
        <h2>O projeto em um olhar</h2>
        <p>O avanço e a meta semanal acompanham o recorte selecionado. Os demais indicadores mostram o projeto inteiro.</p>
      </div>
      {filters}
    </div>

    <div className="acp-overview-kpis">
      <Card padding="sm" className="acp-overview-kpi" data-acp-weekly-progress-target>
        <div className="acp-overview-kpi-icon"><AppIcon icon={Gauge} /></div>
        <span>Ritmo necessário</span><strong>{weeklyPhysicalProgress(target)}</strong>
        <small>{filterLabel || 'Escopo total'}</small>
      </Card>
      <Card padding="sm" className="acp-overview-kpi">
        <div className="acp-overview-kpi-icon"><AppIcon icon={ClipboardList} /></div>
        <span>Último RDO</span><strong>{fmtDate(data.header.lastRdoDate)}</strong>
        <small>{data.header.lastRdoDate ? 'Último lançamento registrado' : 'Sem relatório registrado'}</small>
      </Card>
      <Card padding="sm" className="acp-overview-kpi">
        <div className="acp-overview-kpi-icon"><AppIcon icon={UsersRound} /></div>
        <span>Equipe</span><strong>{teamCount}</strong>
        <small>{teamCount === 1 ? 'colaborador' : 'colaboradores'} {teamIsPlanned ? 'planejados' : 'registrados'}</small>
      </Card>
      <Card padding="sm" className="acp-overview-kpi">
        <div className="acp-overview-kpi-icon"><AppIcon icon={CalendarClock} /></div>
        <span>Previsão pelo ritmo</span><strong>{fmtDate(data.footer.projectedEndByPace)}</strong>
        <small>Estimativa pelo avanço acumulado</small>
      </Card>
    </div>

    <div className="acp-overview-signals">
      <a href="#acp-execution"><AppIcon icon={CalendarClock} size="sm" /><span>Prazo</span><strong>{fmtDate(data.footer.expectedEndDate)}</strong><small>término previsto</small><AppIcon icon={ArrowUpRight} size="sm" /></a>
      <a href="#acp-financial"><AppIcon icon={Wallet} size="sm" /><span>Gastos</span><strong>{costPct == null ? brl(totalRealizado) : `${costPct}% do previsto`}</strong><small>compras, estoque, manual e mão de obra</small><AppIcon icon={ArrowUpRight} size="sm" /></a>
      {deviationCount != null ? <a href="#acp-quality"><AppIcon icon={TriangleAlert} size="sm" /><span>Desvios</span><strong>{deviationCount}</strong><small>{deviationCount === 1 ? 'registro' : 'registros'} na Qualidade</small><AppIcon icon={ArrowUpRight} size="sm" /></a> : null}
      <a href="#acp-resources"><AppIcon icon={Truck} size="sm" /><span>Equipamentos</span><strong>{data.equipamentos?.length ?? 0}</strong><small>em obra</small><AppIcon icon={ArrowUpRight} size="sm" /></a>
    </div>

    <div className="acp-overview-main">
      <Card padding="sm" className="acp-overview-chart">
        <div className="acp-overview-card-head"><div><p className="acp-overview-kicker">Evolução</p><h3>Histórico do avanço</h3></div><span>Acumulado · {filterLabel || 'Escopo total'}</span></div>
        <ProgressHistoryChart key={chartKey} points={progressHistory} height={200} />
        <p>Percentual executado registrado ao longo do tempo. Passe o mouse ou use o teclado para consultar os pontos.</p>
      </Card>
      <Card padding="sm" className="acp-overview-reading">
        <p className="acp-overview-kicker">Leitura rápida</p>
        <h3>Onde olhar agora</h3>
        <span className={`acp-overview-reading-tag ${firstAlert?.level === 'danger' ? 'is-danger' : firstAlert ? 'is-warning' : 'is-success'}`}>
          <AppIcon icon={firstAlert ? TriangleAlert : Activity} size="sm" />{firstAlert ? 'Ponto de atenção' : 'Visão do avanço'}
        </span>
        <strong>{reading}</strong>
        <div className="acp-overview-reading-facts">
          <span>Avanço do recorte <b>{fmtPct(progressPct)}</b></span>
          <span>Prazo previsto <b>{fmtDate(data.footer.expectedEndDate)}</b></span>
          <span>Último RDO <b>{fmtDate(data.header.lastRdoDate)}</b></span>
        </div>
        <a href="#acp-progress">Ver avanço por serviço <AppIcon icon={ArrowUpRight} size="sm" /></a>
      </Card>
    </div>

    <div className="acp-overview-services" id="acp-progress">
      <div><p className="acp-overview-kicker">Composição</p><h2>Avanço por serviço</h2><p>Percentuais calculados para o recorte selecionado.</p></div>
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
    </div>

    <div className="acp-overview-next">
      <p className="acp-overview-kicker">Próxima camada</p><h2>Detalhes por assunto</h2>
      <div>
        <a href="#acp-execution"><AppIcon icon={CalendarClock} /><span>Planejamento</span><strong>Prazos e execução</strong><small>Datas, horas, metas e escopo</small><b>Explorar prazos <AppIcon icon={ArrowUpRight} size="sm" /></b></a>
        <a href="#acp-financial"><AppIcon icon={Wallet} /><span>Financeiro</span><strong>{data.canViewProjectFinancials ? 'Gastos e faturamento' : 'Gastos do projeto'}</strong><small>{data.canViewProjectFinancials ? 'Custos, notas fiscais e impostos' : 'Consumo e origem dos custos'}</small><b>Explorar valores <AppIcon icon={ArrowUpRight} size="sm" /></b></a>
        <a href="#acp-quality"><AppIcon icon={TriangleAlert} /><span>Qualidade</span><strong>Desvios e notas</strong><small>Registros e contexto da gestão</small><b>Explorar desvios <AppIcon icon={ArrowUpRight} size="sm" /></b></a>
        <a href="#acp-resources"><AppIcon icon={HardHat} /><span>Operação</span><strong>Equipe e equipamentos</strong><small>Pessoas, ativos e romaneios</small><b>Explorar recursos <AppIcon icon={ArrowUpRight} size="sm" /></b></a>
      </div>
    </div>
  </div>;
}
