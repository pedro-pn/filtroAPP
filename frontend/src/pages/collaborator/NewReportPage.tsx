import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthContext';
import { listReports } from '../../api/reports';
import { ServiceFields, serviceTypeLabels, serviceTypeOptions } from '../../components/reports/ServiceFields';
import { UploadField } from '../../components/ui/UploadField';
import { useToast } from '../../components/ui/Toast';
import { useCollaborators } from '../../hooks/useCollaborators';
import { useDraftMutations } from '../../hooks/useDrafts';
import { useEquipment } from '../../hooks/useEquipment';
import { useManometers } from '../../hooks/useManometers';
import { useProjects } from '../../hooks/useProjects';
import { useReportMutations } from '../../hooks/useReports';
import { useUnits } from '../../hooks/useUnits';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { UploadedFile } from '../../api/uploads';
import { buildReportServicePayload, normalizeServiceType } from '../../utils/reportServicePayload';

const TEXT = {
  addService: 'Adicionar serviço',
  atLeastOneCollaborator: 'Selecione ao menos um colaborador do turno diurno.',
  atLeastOneService: 'Adicione ao menos um serviço.',
  back: 'Voltar',
  dailyDescription: 'Descrição diária',
  departure: 'Saída',
  end: 'Fim',
  errorCreate: 'Não foi possível criar o relatório.',
  errorDraft: 'Não foi possível salvar o rascunho.',
  finalization: 'Finalização',
  header: 'Cabeçalho',
  invalidSession: 'Sessão inválida.',
  newReport: 'Novo relatório',
  nightTeam: 'Equipe noturna',
  noService: 'Nenhum serviço adicionado.',
  notes: 'Observações',
  photos: 'Fotos de registro',
  projectTimeRequired: 'Preencha projeto, data e horários antes de enviar.',
  remove: 'Remover',
  saveDraft: 'Salvar rascunho',
  savedDraft: 'Rascunho salvo.',
  saveDraftProjectRequired: 'Selecione um projeto antes de salvar o rascunho.',
  select: 'Selecione',
  service: 'Serviço',
  services: 'Serviços',
  start: 'Início',
  submit: 'Enviar relatório',
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
  const unitsQuery = useUnits();
  const manometersQuery = useManometers();
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
    generalUploads,
    services,
    setDraftId,
    setHeaderField,
    setCollaborators,
    setNightCollaborators,
    setGeneralUploads,
    addService,
    updateServiceType,
    updateService,
    removeService,
    reset
  } = useRdoStore();

  const showToast = useToast();

  const projects = projectsQuery.data || [];
  const collaborators = (collaboratorsQuery.data || []).filter(item => item.isActive);
  const equipment = (equipmentQuery.data || []).filter(item => item.isActive);
  const units = unitsQuery.data || [];
  const manometers = manometersQuery.data || [];

  const selectedProject = useMemo(
    () => (projectsQuery.data || []).find(project => project.id === projectId) || null,
    [projectId, projectsQuery.data]
  );

  // Fetch reports of selected project for pre-fill and continuity
  const lastProjectReportQuery = useQuery({
    queryKey: ['reports', 'last-project', projectId],
    queryFn: () => listReports({ projectId: projectId! }),
    enabled: !!projectId,
    staleTime: 30_000
  });

  const lastReport = useMemo(() => {
    const reports = lastProjectReportQuery.data;
    if (!reports?.length) return null;
    return [...reports].sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    )[0];
  }, [lastProjectReportQuery.data]);

  useEffect(() => {
    if (!reportDate) setHeaderField('reportDate', todayIso());
    if (!lunchBreak) setHeaderField('lunchBreak', '1 hora');
  }, [lunchBreak, reportDate, setHeaderField]);

  // Pre-fill collaborators from the most recent report of the selected project
  useEffect(() => {
    if (!projectId || collaboratorIds.length > 0) return;
    if (!lastReport) return;
    const ids = (lastReport.collaborators || []).map(l => l.collaboratorId).filter(Boolean);
    if (ids.length) setCollaborators(ids);
  }, [projectId, lastReport, collaboratorIds.length, setCollaborators]);

  function handleContinueServices() {
    if (!lastReport?.services?.length) return;
    lastReport.services.forEach(service => {
      addService(normalizeServiceType(service.serviceType), {
        ...(service.extraData || {}),
        equipmentId: service.equipmentId || '',
        system: service.system || '',
        material: service.material || '',
        startTime: '',
        endTime: '',
        notes: typeof service.extraData?.notes === 'string' ? service.extraData.notes : ''
      });
    });
  }

  function formatLastReportDate(report: typeof lastReport) {
    if (!report?.reportDate) return '';
    const d = new Date(report.reportDate);
    if (Number.isNaN(d.getTime())) return report.reportDate;
    return d.toLocaleDateString('pt-BR');
  }

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
      generalUploads,
      services
    };
  }

  async function handleSaveDraft() {
    if (!projectId) {
      showToast(TEXT.saveDraftProjectRequired, 'error');
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
      showToast(TEXT.savedDraft, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.errorDraft, 'error');
    }
  }

  async function handleSubmit() {
    if (!user?.id) {
      showToast(TEXT.invalidSession, 'error');
      return;
    }
    if (!projectId || !reportDate || !arrivalTime || !departureTime || !lunchBreak) {
      showToast(TEXT.projectTimeRequired, 'error');
      return;
    }
    if (!collaboratorIds.length) {
      showToast(TEXT.atLeastOneCollaborator, 'error');
      return;
    }
    if (!services.length) {
      showToast(TEXT.atLeastOneService, 'error');
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
          generalUploads,
          noturnoDetails: {
            enabled: noturno,
            collaboratorIds: nightCollaboratorIds
          }
        },
        collaboratorIds,
        services: services.map(service => buildReportServicePayload(service, {
          collaboratorIds,
          collaborators,
          equipment,
          units
        }))
      });

      if (draftId) {
        try {
          await draftMutations.removeDraft.mutateAsync(draftId);
        } catch {
          // Draft cleanup can be retried later; report is already created.
        }
      }

      reset();
      navigate(`/relatorios/${created.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.errorCreate, 'error');
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

        {projectId && (lastReport?.services?.length ?? 0) > 0 && !services.length ? (
          <section className="page-card continuity-card">
            <div className="section-title">Serviços em andamento</div>
            <p className="placeholder-copy">
              Último relatório do projeto ({formatLastReportDate(lastReport)}) tem{' '}
              {lastReport!.services!.length} serviço(s) registrado(s).
            </p>
            <div className="admin-form-actions" style={{ marginTop: 10 }}>
              <button className="secondary-button" type="button" onClick={handleContinueServices}>
                Continuar serviços
              </button>
            </div>
          </section>
        ) : null}

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
            <button className="secondary-button" type="button" onClick={() => addService('limpeza')}>
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
                        value={normalizeServiceType(service.type)}
                        onChange={event => updateServiceType(service.id, event.target.value)}
                      >
                        {serviceTypeOptions.map(option => (
                          <option key={option} value={option}>
                            {serviceTypeLabels[option] || option}
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
                    {normalizeServiceType(service.type) !== 'pressao' ? (
                      <div className="field-group">
                        <label>Material</label>
                        <input
                          value={typeof service.data.material === 'string' ? service.data.material : ''}
                          onChange={event => updateService(service.id, { material: event.target.value })}
                        />
                      </div>
                    ) : null}
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
                    <ServiceFields
                      serviceType={service.type}
                      data={service.data}
                      onChange={update => updateService(service.id, update)}
                      units={units}
                      manometers={manometers}
                      groupKey={service.id}
                      projectId={projectId}
                    />
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
            <UploadField
              label={TEXT.photos}
              value={generalUploads as UploadedFile[]}
              projectId={projectId}
              onChange={setGeneralUploads}
            />
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
