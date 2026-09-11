import type { SedeOperationalMetrics } from '../../api/acompanhamentoComercial';

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
    <section
      className="sede-operational-section"
      aria-labelledby="sede-operational-title"
    >
      <div className="section-title" id="sede-operational-title">
        Indicadores operacionais
      </div>
      <div className="sede-operational-grid">
        <article className="page-card sede-operational-card">
          <div className="operational-card-head">
            <div>
              <strong>5002 · Manutenção</strong>
              <div className="form-hint">Somente registros aprovados</div>
            </div>
            <span className="sede-operational-primary">
              {data.maintenance.summary.maintenanceCount}
            </span>
          </div>
          <div className="sede-operational-kpis">
            <div>
              <span>RDOs</span>
              <strong>{data.maintenance.summary.reportCount}</strong>
            </div>
            <div>
              <span>Horas</span>
              <strong>{hours(data.maintenance.summary.workedMinutes)}</strong>
            </div>
            <div>
              <span>HE</span>
              <strong>{hours(data.maintenance.summary.overtimeMinutes)}</strong>
            </div>
            <div>
              <span>Colaboradores</span>
              <strong>{data.maintenance.summary.collaboratorCount}</strong>
            </div>
          </div>
          <div className="sede-operational-breakdown">
            <div>
              <strong>Por perfil</strong>
              {data.maintenance.byProfile.slice(0, 6).map((item) => (
                <div key={item.profileName}>
                  <span>{item.profileName}</span>
                  <span>{item.maintenanceCount}</span>
                </div>
              ))}
            </div>
            <div>
              <strong>Por equipamento</strong>
              {data.maintenance.byEquipment.slice(0, 6).map((item) => (
                <div key={item.equipmentId}>
                  <span>
                    {item.equipmentCode} — {item.equipmentName}
                  </span>
                  <span>{item.maintenanceCount}</span>
                </div>
              ))}
            </div>
          </div>
        </article>
        <article className="page-card sede-operational-card">
          <div className="operational-card-head">
            <div>
              <strong>5004 · Produção</strong>
              <div className="form-hint">
                Peças decapadas em relatórios aprovados
              </div>
            </div>
            <span className="sede-operational-primary">
              {data.production.summary.totalKg.toLocaleString('pt-BR')} kg
            </span>
          </div>
          <div className="sede-operational-kpis">
            <div>
              <span>RDOs</span>
              <strong>{data.production.summary.reportCount}</strong>
            </div>
            <div>
              <span>Horas</span>
              <strong>{hours(data.production.summary.workedMinutes)}</strong>
            </div>
            <div>
              <span>HE</span>
              <strong>{hours(data.production.summary.overtimeMinutes)}</strong>
            </div>
            <div>
              <span>Colaboradores</span>
              <strong>{data.production.summary.collaboratorCount}</strong>
            </div>
          </div>
          <div className="sede-operational-breakdown">
            <div>
              <strong>Kg por material</strong>
              {data.production.byMaterial.map((item) => (
                <div key={item.material}>
                  <span>{materialLabels[item.material]}</span>
                  <span>{item.totalKg.toLocaleString('pt-BR')} kg</span>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
