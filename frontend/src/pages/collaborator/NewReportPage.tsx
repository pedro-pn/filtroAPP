import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { useCollaborators } from '../../hooks/useCollaborators';
import { useDraftMutations } from '../../hooks/useDrafts';
import { useEquipment } from '../../hooks/useEquipment';
import { useProjects } from '../../hooks/useProjects';
import { useReportMutations } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';

const serviceTypeOptions = ['LIMPEZA', 'FLUSHING', 'PRESSAO', 'FILTRAGEM', 'INSPECAO', 'OUTRO'];

const TEXT = {
  addService: 'Adicionar servi\u00e7o',
  atLeastOneCollaborator: 'Selecione ao menos um colaborador do turno diurno.',
  atLeastOneService: 'Adicione ao menos um servi\u00e7o.',
  back: 'Voltar',
  dailyDescription: 'Descri\u00e7\u00e3o di\u00e1ria',
  departure: 'Sa\u00edda',
  end: 'Fim',
  errorCreate: 'N\u00e3o foi poss\u00edvel criar o relat\u00f3rio.',
  errorDraft: 'N\u00e3o foi poss\u00edvel salvar o rascunho.',
  finalization: 'Finaliza\u00e7\u00e3o',
  header: 'Cabe\u00e7alho',
  invalidSession: 'Sess\u00e3o inv\u00e1lida.',
  newReport: 'Novo relat\u00f3rio',
  nightTeam: 'Equipe noturna',
  noService: 'Nenhum servi\u00e7o adicionado.',
  notes: 'Observa\u00e7\u00f5es',
  projectTimeRequired: 'Preencha projeto, data e hor\u00e1rios antes de enviar.',
  remove: 'Remover',
  saveDraft: 'Salvar rascunho',
  savedDraft: 'Rascunho salvo.',
  saveDraftProjectRequired: 'Selecione um projeto antes de salvar o rascunho.',
  select: 'Selecione',
  service: 'Servi\u00e7o',
  services: 'Servi\u00e7os',
  start: 'In\u00edcio',
  submit: 'Enviar relat\u00f3rio',
  team: 'Equipe'
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function NewReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const projectsQuery = useProjects(true);
  const collaboratorsQuery = useCollaborators();
  const equipmentQuery = useEquipment();
  const reportMutations = useReportMutations();
  const draftMutations = useDraftMutations();

  const {
    draftId,
    projectId,
    reportDate,
    arrivalTime,
    departureTime,
    lunchBreak,
    collaboratorIds,
    nightCollaboratorIds,
    standby,
    noturno,
    overtimeReason,
    dailyDescription,
    services,
    setDraftId,
    setHeaderField,
    setCollaborators,
    setNightCollaborators,
    addService,
    updateServiceType,
    updateService,
    removeService,
    reset
  } = useRdoStore();

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projects = projectsQuery.data || [];
  const collaborators = (collaboratorsQuery.data || []).filter(item => item.isActive);
  const equipment = (equipmentQuery.data || []).filter(item => item.isActive);

  const selectedProject = useMemo(
    () => projects.find(project => project.id === projectId) || null,
    [projectId, projects]
  );

  useEffect(() => {
    if (!reportDate) setHeaderField('reportDate', todayIso());
    if (!lunchBreak) setHeaderField('lunchBreak', '1 hora');
  }, [lunchBreak, reportDate, setHeaderField]);

  function toggleCollaborator(id: string, checked: boolean, night = false) {
    if (night) {
      const next = checked ? [...nightCollaboratorIds, id] : nightCollaboratorIds.filter(item => item !== id);
      setNightCollaborators(Array.from(new Set(next)));
      return;
    }

    const next = checked ? [...collaboratorIds, id] : collaboratorIds.filter(item => item !== id);
    setCollaborators(Array.from(new Set(next)));
  }

  function buildDraftPayload() {
    return {
      projectId,
      reportDate,
      arrivalTime,
      departureTime,
      lunchBreak,
      collaboratorIds,
      nightCollaboratorIds,
      standby,
      noturno,
      overtimeReason,
      dailyDescription,
      services
    };
  }

  async function handleSaveDraft() {
    setError(null);
    setMessage(null);

    if (!projectId) {
      setError(TEXT.saveDraftProjectRequired);
      return;
    }

    const payload = {
      projectId,
      reportDate: reportDate || null,
      title: selectedProject ? `RDO - ${selectedProject.code}` : 'RDO em andamento',
      payload: buildDraftPayload()
    };

    try {
      const saved = draftId
        ? await draftMutations.updateDraft.mutateAsync({ id: draftId, payload })
        : await draftMutations.createDraft.mutateAsync(payload);
      setDraftId(saved.id);
      setMessage(TEXT.savedDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.errorDraft);
    }
  }

  async function handleSubmit() {
    setError(null);
    setMessage(null);

    if (!user?.id) {
      setError(TEXT.invalidSession);
      return;
    }
    if (!projectId || !reportDate || !arrivalTime || !departureTime || !lunchBreak) {
      setError(TEXT.projectTimeRequired);
      return;
    }
    if (!collaboratorIds.length) {
      setError(TEXT.atLeastOneCollaborator);
      return;
    }
    if (!services.length) {
      setError(TEXT.atLeastOneService);
      return;
    }

    try {
      const created = await reportMutations.createReport.mutateAsync({
        projectId,
        createdByUserId: user.id,
        reportType: 'RDO',
        status: 'PENDING',
        reportDate,
        arrivalTime,
        departureTime,
        lunchBreak,
        daytimeCount: collaboratorIds.length,
        overtimeReason: overtimeReason || null,
        dailyDescription: dailyDescription || null,
        specialConditions: {
          standby,
          noturnoDetails: {
            enabled: noturno,
            collaboratorIds: nightCollaboratorIds
          }
        },
        collaboratorIds,
        services: services.map(service => ({
          serviceType: service.type,
          equipmentId: typeof service.data.equipmentId === 'string' ? service.data.equipmentId : null,
          system: typeof service.data.system === 'string' ? service.data.system : null,
          material: typeof service.data.material === 'string' ? service.data.material : null,
          startTime: typeof service.data.startTime === 'string' ? service.data.startTime : null,
          endTime: typeof service.data.endTime === 'string' ? service.data.endTime : null,
          finalized: true,
          extraData: {
            notes: typeof service.data.notes === 'string' ? service.data.notes : ''
          }
        }))
      });

      if (draftId) {
        try {
          await draftMutations.removeDraft.mutateAsync(draftId);
        } catch {
          // The submitted report is already created; stale draft cleanup can be retried later.
        }
      }

      reset();
      navigate(`/relatorios/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.errorCreate);
    }
  }

  return (
    <Shell>
      <TopBar
        title={TEXT.newReport}
        subtitle="RDO"
        actions={
          <button className="topbar-chip" type="button" onClick={() => navigate('/home')}>
            {TEXT.back}
          </button>
        }
      />
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">{TEXT.header}</div>
          {error ? <div className="inline-error">{error}</div> : null}
          {message ? <div className="inline-success">{message}</div> : null}
          <div className="admin-form-grid">
            <div className="field-group">
              <label htmlFor="rdo-project">Projeto</label>
              <select
                id="rdo-project"
                value={projectId || ''}
                onChange={event => setHeaderField('projectId', event.target.value || null)}
              >
                <option value="">{TEXT.select}</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="rdo-date">Data</label>
              <input
                id="rdo-date"
                type="date"
                value={reportDate}
                onChange={event => setHeaderField('reportDate', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="rdo-arrival">Chegada</label>
              <input
                id="rdo-arrival"
                type="time"
                value={arrivalTime}
                onChange={event => setHeaderField('arrivalTime', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="rdo-departure">{TEXT.departure}</label>
              <input
                id="rdo-departure"
                type="time"
                value={departureTime}
                onChange={event => setHeaderField('departureTime', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="rdo-lunch">Intervalo</label>
              <input
                id="rdo-lunch"
                value={lunchBreak}
                placeholder="1 hora"
                onChange={event => setHeaderField('lunchBreak', event.target.value)}
              />
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={standby}
                onChange={event => setHeaderField('standby', event.target.checked)}
              />
              Standby
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={noturno}
                onChange={event => setHeaderField('noturno', event.target.checked)}
              />
              Turno noturno
            </label>
          </div>
        </section>

        <section className="page-card">
          <div className="section-title">{TEXT.team}</div>
          <div className="rdo-check-grid">
            {collaborators.map(item => (
              <label className="rdo-check-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={collaboratorIds.includes(item.id)}
                  onChange={event => toggleCollaborator(item.id, event.target.checked)}
                />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
          {noturno ? (
            <>
              <div className="section-title" style={{ marginTop: 16 }}>{TEXT.nightTeam}</div>
              <div className="rdo-check-grid">
                {collaborators.map(item => (
                  <label className="rdo-check-row" key={`night-${item.id}`}>
                    <input
                      type="checkbox"
                      checked={nightCollaboratorIds.includes(item.id)}
                      onChange={event => toggleCollaborator(item.id, event.target.checked, true)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className="page-card">
          <div className="section-title">{TEXT.services}</div>
          <div className="admin-form-actions">
            <button className="secondary-button" type="button" onClick={() => addService('LIMPEZA')}>
              + {TEXT.addService}
            </button>
          </div>
          {services.length ? (
            <div className="admin-stack" style={{ marginTop: 12 }}>
              {services.map((service, index) => (
                <article className="admin-card-react" key={service.id}>
                  <div className="admin-card-head">
                    <div className="admin-card-title">{TEXT.service} {index + 1}</div>
                    <div className="admin-card-actions">
                      <button className="secondary-button" type="button" onClick={() => removeService(service.id)}>
                        {TEXT.remove}
                      </button>
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <div className="field-group">
                      <label>Tipo</label>
                      <select
                        value={service.type}
                        onChange={event => updateServiceType(service.id, event.target.value)}
                      >
                        {serviceTypeOptions.map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Equipamento</label>
                      <select
                        value={typeof service.data.equipmentId === 'string' ? service.data.equipmentId : ''}
                        onChange={event => updateService(service.id, { equipmentId: event.target.value || null })}
                      >
                        <option value="">Nenhum</option>
                        {equipment.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.code} - {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Sistema</label>
                      <input
                        value={typeof service.data.system === 'string' ? service.data.system : ''}
                        onChange={event => updateService(service.id, { system: event.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Material</label>
                      <input
                        value={typeof service.data.material === 'string' ? service.data.material : ''}
                        onChange={event => updateService(service.id, { material: event.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>{TEXT.start}</label>
                      <input
                        type="time"
                        value={typeof service.data.startTime === 'string' ? service.data.startTime : ''}
                        onChange={event => updateService(service.id, { startTime: event.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>{TEXT.end}</label>
                      <input
                        type="time"
                        value={typeof service.data.endTime === 'string' ? service.data.endTime : ''}
                        onChange={event => updateService(service.id, { endTime: event.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>{TEXT.notes}</label>
                      <textarea
                        rows={3}
                        value={typeof service.data.notes === 'string' ? service.data.notes : ''}
                        onChange={event => updateService(service.id, { notes: event.target.value })}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">{TEXT.noService}</p>
          )}
        </section>

        <section className="page-card">
          <div className="section-title">{TEXT.finalization}</div>
          <div className="admin-form-grid">
            <div className="field-group">
              <label htmlFor="rdo-overtime">Motivo da hora extra</label>
              <input
                id="rdo-overtime"
                value={overtimeReason}
                onChange={event => setHeaderField('overtimeReason', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="rdo-description">{TEXT.dailyDescription}</label>
              <textarea
                id="rdo-description"
                rows={5}
                value={dailyDescription}
                onChange={event => setHeaderField('dailyDescription', event.target.value)}
              />
            </div>
          </div>
          <div className="admin-form-actions" style={{ marginTop: 14 }}>
            <button className="secondary-button" type="button" onClick={handleSaveDraft}>
              {TEXT.saveDraft}
            </button>
            <button className="primary-button" type="button" onClick={handleSubmit}>
              {TEXT.submit}
            </button>
          </div>
        </section>
      </main>
    </Shell>
  );
}
