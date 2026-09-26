import type { SedeOperationalMetrics } from '../../api/acompanhamentoComercial';
import { Badge, Card } from '../ui/ds';

const materialLabels = {
  CARBON_STEEL: 'Aço carbono',
  STAINLESS_STEEL: 'Inox',
  CUNIFE: 'CuNiFe',
  OTHER: 'Outros'
};

function hours(minutes: number) {
  return `${(Number(minutes || 0) / 60).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} h`;
}

export function SedeOperationalCards({
  data
}: {
  data: SedeOperationalMetrics;
}) {
  return (
    <section className="acp-sede-ds__operations" aria-labelledby="sede-operational-title">
      <div className="acp-sede-ds__section-heading">
        <h2 id="sede-operational-title">Indicadores operacionais</h2>
        <p>Registros aprovados das atividades na Sede.</p>
      </div>
      <div className="acp-sede-ds__operation-grid">
        <Card variant="flat" title="Manutenção" actions={<Badge tone="neutral">5002</Badge>}>
          <div className="acp-sede-ds__operation-total">
            <strong>{data.maintenance.summary.maintenanceCount}</strong>
            <span>manutenções registradas</span>
          </div>
          <dl className="acp-sede-ds__operation-stats">
            <div><dt>RDOs</dt><dd>{data.maintenance.summary.reportCount}</dd></div>
            <div><dt>Horas</dt><dd>{hours(data.maintenance.summary.workedMinutes)}</dd></div>
            <div><dt>Horas extras</dt><dd>{hours(data.maintenance.summary.overtimeMinutes)}</dd></div>
            <div><dt>Colaboradores</dt><dd>{data.maintenance.summary.collaboratorCount}</dd></div>
          </dl>
          <div className="acp-sede-ds__breakdowns">
            <div><h3>Por perfil</h3><dl className="acp-sede-ds__facts">
              {data.maintenance.byProfile.slice(0, 6).map(item => <div key={item.profileName}>
                <dt>{item.profileName}</dt><dd>{item.maintenanceCount}</dd>
              </div>)}
            </dl></div>
            <div><h3>Por equipamento</h3><dl className="acp-sede-ds__facts">
              {data.maintenance.byEquipment.slice(0, 6).map(item => <div key={item.equipmentId}>
                <dt>{item.equipmentCode} — {item.equipmentName}</dt><dd>{item.maintenanceCount}</dd>
              </div>)}
            </dl></div>
          </div>
        </Card>
        <Card variant="flat" title="Produção" actions={<Badge tone="neutral">5004</Badge>}>
          <div className="acp-sede-ds__operation-total">
            <strong>{data.production.summary.totalKg.toLocaleString('pt-BR')} kg</strong>
            <span>peças decapadas em relatórios aprovados</span>
          </div>
          <dl className="acp-sede-ds__operation-stats">
            <div><dt>RDOs</dt><dd>{data.production.summary.reportCount}</dd></div>
            <div><dt>Horas</dt><dd>{hours(data.production.summary.workedMinutes)}</dd></div>
            <div><dt>Horas extras</dt><dd>{hours(data.production.summary.overtimeMinutes)}</dd></div>
            <div><dt>Colaboradores</dt><dd>{data.production.summary.collaboratorCount}</dd></div>
          </dl>
          <div className="acp-sede-ds__breakdowns">
            <div><h3>Kg por material</h3><dl className="acp-sede-ds__facts">
              {data.production.byMaterial.map(item => <div key={item.material}>
                <dt>{materialLabels[item.material]}</dt><dd>{item.totalKg.toLocaleString('pt-BR')} kg</dd>
              </div>)}
            </dl></div>
          </div>
        </Card>
      </div>
    </section>
  );
}
