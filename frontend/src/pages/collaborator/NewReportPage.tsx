import { useEffect, useMemo, useState } from 'react';
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
  dailyDescription: 'Descrição geral',
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
  next: 'Próximo →',
  submit: 'Enviar relatório ✓',
  team: 'Equipe diurna',
  specialConditions: 'Condições especiais',
  identification: 'Identificação',
  schedules: 'Horários',
};

const serviceTypeModalOptions = [
  { type: 'limpeza',  icon: '🧪', name: 'Limpeza química' },
  { type: 'pressao',  icon: '🔴', name: 'Teste de pressão' },
  { type: 'filtragem', icon: '🔵', name: 'Filtragem' },
  { type: 'flushing', icon: '💧', name: 'Flushing' },
  { type: 'mecanica', icon: '⚙️', name: 'Limpeza mecânica' },
  { type: 'inibicao', icon: '🛡️', name: 'Inibição' },
] as const;

const rdoSteps = [TEXT.header, TEXT.services, TEXT.finalization];


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
  const [step, setStep] = useState(0);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [standbyDuration, setStandbyDuration] = useState('');
  const [standbyMotivo, setStandbyMotivo] = useState('');
  const [noturnoStart, setNoturnoStart] = useState('');
  const [noturnoEnd, setNoturnoEnd] = useState('');
  const [invalidTarget, setInvalidTarget] = useState<string | null>(null);
  const [collaboratorToAdd, setCollaboratorToAdd] = useState('');
  const [nightCollaboratorToAdd, setNightCollaboratorToAdd] = useState('');

  const projects = projectsQuery.data || [];
  const collaborators = (collaboratorsQuery.data || []).filter(item => item.isActive);
  const equipment = (equipmentQuery.data || []).filter(item => item.isActive);
  const units = unitsQuery.data || [];
  const manometers = manometersQuery.data || [];

  const selectedProject = useMemo(
    () => (projectsQuery.data || []).find(project => project.id === projectId) || null,
    [projectId, projectsQuery.data]
  );
  const backPath = user?.role === 'MANAGER' ? '/gestor' : '/home';

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
    if (!lunchBreak) setHeaderField('lunchBreak', '01:00:00');
  }, [lunchBreak, reportDate, arrivalTime, departureTime, setHeaderField]);

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

  function addCollaboratorFromSelect(night = false) {
    const id = night ? nightCollaboratorToAdd : collaboratorToAdd;
    if (!id) return;
    if (night) {
      setNightCollaborators(Array.from(new Set([...nightCollaboratorIds, id])));
      setNightCollaboratorToAdd('');
      return;
    }
    setCollaborators(Array.from(new Set([...collaboratorIds, id])));
    setCollaboratorToAdd('');
  }

  function removeCollaboratorFromList(id: string, night = false) {
    if (night) {
      setNightCollaborators(nightCollaboratorIds.filter(item => item !== id));
      return;
    }
    setCollaborators(collaboratorIds.filter(item => item !== id));
  }

  function renderCollaboratorList(ids: string[], night = false) {
    if (!ids.length) {
      return <div className="colab-empty">Nenhum colaborador adicionado.</div>;
    }

    return ids.map(id => {
      const item = collaborators.find(candidate => candidate.id === id);
      return (
        <span className="colab-tag" key={`${night ? 'night' : 'day'}-${id}`}>
          <span>{item?.name || id}</span>
          <button type="button" onClick={() => removeCollaboratorFromList(id, night)}>×</button>
        </span>
      );
    });
  }

  function fieldState(target: string) {
    return invalidTarget === target ? 'field-group field-invalid' : 'field-group';
  }

  function serviceInvalidKey(serviceId: string) {
    if (!invalidTarget?.startsWith(`${serviceId}:`)) return null;
    return invalidTarget.slice(serviceId.length + 1);
  }

  function serviceFieldState(serviceId: string, key: string) {
    return invalidTarget === `${serviceId}:${key}` ? 'field-group field-invalid' : 'field-group';
  }

  function failRequired(label: string, target: string, targetStep: number) {
    setStep(targetStep);
    setInvalidTarget(target);
    showToast(`Preencha o campo obrigatório: ${label}.`, 'error');
    window.setTimeout(() => {
      const selector = target.includes(':')
        ? `[data-service-id="${target.split(':')[0]}"]`
        : `[data-invalid-target="${target}"]`;
      document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return false;
  }

  function hasText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function hasStringItem(value: unknown) {
    return Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim());
  }

  function hasValidTube(value: unknown) {
    return Array.isArray(value) && value.some(item => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return hasText(row.d) || hasText(row.c);
    });
  }

  function validateHeader() {
    if (!projectId) return failRequired('Projeto', 'header:projectId', 0);
    if (!reportDate) return failRequired('Data do relatório', 'header:reportDate', 0);
    if (!arrivalTime) return failRequired('Chegada', 'header:arrivalTime', 0);
    if (!departureTime) return failRequired('Saída', 'header:departureTime', 0);
    if (!lunchBreak) return failRequired('Intervalo de almoço', 'header:lunchBreak', 0);
    if (!collaboratorIds.length) return failRequired('Colaboradores', 'header:collaborators', 0);
    if (standby && !standbyDuration) return failRequired('Tempo total (standby)', 'header:standbyDuration', 0);
    if (standby && !standbyMotivo.trim()) return failRequired('Motivo (standby)', 'header:standbyMotivo', 0);
    if (noturno && !noturnoStart) return failRequired('Início (noturno)', 'header:noturnoStart', 0);
    if (noturno && !noturnoEnd) return failRequired('Término (noturno)', 'header:noturnoEnd', 0);
    if (noturno && !nightCollaboratorIds.length) return failRequired('Colaboradores noturnos', 'header:nightCollaborators', 0);
    return true;
  }

  function validateServices() {
    if (!services.length) return failRequired('Serviços', 'services:empty', 1);

    for (const service of services) {
      const data = service.data || {};
      const type = normalizeServiceType(service.type);
      const target = (key: string) => `${service.id}:${key}`;

      if (!hasText(data.equipmentId)) return failRequired('Equipamento(s)', target('equipmentId'), 1);
      if (!hasText(data.system)) return failRequired('Sistema', target('system'), 1);
      if (!hasText(data.startTime)) return failRequired('Hora de início', target('startTime'), 1);
      if (!hasText(data.endTime)) return failRequired('Hora de término/pausa', target('endTime'), 1);
      if (!hasStringItem(data.etapas)) return failRequired('Etapas realizadas no dia', target('etapas'), 1);

      if (['limpeza', 'pressao', 'flushing', 'mecanica', 'inibicao'].includes(type) && !hasText(data.material)) {
        return failRequired(type === 'mecanica' ? 'Material do equipamento' : 'Material da tubulação', target('material'), 1);
      }
      if (['limpeza', 'pressao', 'flushing'].includes(type) && !hasValidTube(data.tubes)) {
        return failRequired('Diâmetros e comprimentos', target('tubes'), 1);
      }

      if (type === 'limpeza') {
        if (!hasStringItem(data.metodos)) return failRequired('Método de limpeza', target('metodos'), 1);
        if (!hasText(data.ulq)) return failRequired('Unidade de Limpeza Química', target('ulq'), 1);
        if (!hasStringItem(data.local)) return failRequired('Local de limpeza', target('local'), 1);
        if (!hasStringItem(data.tipoInspecao)) return failRequired('Tipo de inspeção', target('tipoInspecao'), 1);
      }

      if (type === 'pressao') {
        if (!hasText(data.uth)) return failRequired('Unidade de Teste Hidrostático (UTH)', target('uth'), 1);
        if (!hasText(data.pressaoTrabalho)) return failRequired('Pressão de trabalho', target('pressaoTrabalho'), 1);
        if (!hasText(data.pressaoTeste)) return failRequired('Pressão de teste', target('pressaoTeste'), 1);
        if (!hasStringItem(data.manometroIds)) return failRequired('Manômetros utilizados', target('manometroIds'), 1);
      }

      if (type === 'flushing') {
        if (!hasText(data.tipoOleo)) return failRequired('Tipo de óleo', target('tipoOleo'), 1);
        if (!hasText(data.volumeOleo)) return failRequired('Volume de óleo', target('volumeOleo'), 1);
        if (!hasText(data.uf)) return failRequired('Unidade de Flushing', target('uf'), 1);
      }

      if (type === 'filtragem') {
        if (!hasText(data.tipoOleo)) return failRequired('Tipo de óleo', target('tipoOleo'), 1);
        if (!hasText(data.volumeOleo)) return failRequired('Volume de óleo', target('volumeOleo'), 1);
        if (!hasText(data.ufg)) return failRequired('Unidade de filtragem', target('ufg'), 1);
      }

      if ((type === 'flushing' || type === 'filtragem') && data.houveParticulas === 'Sim' && !hasText(data.contadorUtilizado)) {
        return failRequired('Contador utilizado', target('contadorUtilizado'), 1);
      }
      if ((type === 'flushing' || type === 'filtragem') && data.houveDesidratacao === 'Sim' && !hasText(data.desidratacaoUnit)) {
        return failRequired('Equipamento de desidratação', target('desidratacaoUnit'), 1);
      }
    }

    return true;
  }

  function handleNextStep() {
    if (step === 0) {
      if (!validateHeader()) return;
    }

    if (step === 1) {
      if (!validateServices()) return;
    }

    setInvalidTarget(null);
    setStep(current => Math.min(current + 1, rdoSteps.length - 1));
  }

  function buildResumoText() {
    const parts: string[] = [];
    if (selectedProject) parts.push(`${selectedProject.code} — ${selectedProject.name}`);
    if (reportDate) {
      const d = new Date(`${reportDate}T00:00:00`);
      const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      parts.push(label.charAt(0).toUpperCase() + label.slice(1));
    }
    if (arrivalTime && departureTime) parts.push(`${arrivalTime} às ${departureTime}`);
    if (collaboratorIds.length) {
      parts.push(`${collaboratorIds.length} colaborador${collaboratorIds.length !== 1 ? 'es' : ''}`);
    }
    if (services.length) {
      const types = services.map(s => serviceTypeLabels[normalizeServiceType(s.type)] || s.type);
      parts.push(types.join(', '));
    }
    return parts.join(' · ') || '—';
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
    if (!validateHeader()) return;
    if (!validateServices()) return;

    try {
      const created = await reportMutations.createReport.mutateAsync({
        projectId: projectId!,
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
          standbyDetails: {
            total: standbyDuration,
            motivo: standbyMotivo
          },
          generalUploads,
          noturnoDetails: {
            enabled: noturno,
            inicio: noturnoStart,
            termino: noturnoEnd,
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
          <button className="topbar-chip" type="button" onClick={() => navigate(backPath)}>
            {TEXT.back}
          </button>
        }
      />
      <main className="page-scroll">
        <section className="page-card rdo-step-panel">
          <div className="rdo-step-head">
            <div>
              <div className="section-title">{rdoSteps[step]}</div>
              <div className="placeholder-copy">Etapa {step + 1} de {rdoSteps.length}</div>
            </div>
            <span className="status-pill status-approved">{step + 1} / {rdoSteps.length}</span>
          </div>
          <div className="rdo-progress-track" aria-hidden="true">
            <div className="rdo-progress-fill" style={{ width: `${((step + 1) / rdoSteps.length) * 100}%` }} />
          </div>
          <div className="filter-tabs">
            {rdoSteps.map((label, index) => (
              <button
                className={`filter-tab ${step === index ? 'active' : ''}`}
                key={label}
                type="button"
                onClick={() => {
                  if (index <= step) {
                    setStep(index);
                    return;
                  }
                  if (index === step + 1) {
                    handleNextStep();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {step === 0 ? (
        <>
        {/* Card 1: Identificação */}
        <section className="page-card">
          <div className="section-title">{TEXT.identification}</div>
          <div className="admin-form-grid">
            <div className={fieldState('header:projectId')} data-invalid-target="header:projectId">
              <label htmlFor="rdo-project">Projeto <span style={{ color: 'var(--rd)' }}>*</span></label>
              <select
                id="rdo-project"
                value={projectId || ''}
                onChange={event => setHeaderField('projectId', event.target.value || null)}
                required
              >
                <option value="">Selecionar projeto...</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={fieldState('header:reportDate')} data-invalid-target="header:reportDate">
              <label htmlFor="rdo-date">Data do relatório <span style={{ color: 'var(--rd)' }}>*</span></label>
              <input
                id="rdo-date"
                type="date"
                value={reportDate}
                onChange={event => setHeaderField('reportDate', event.target.value)}
                required
              />
            </div>
          </div>
        </section>

        {/* Card 2: Horários */}
        <section className="page-card">
          <div className="section-title">{TEXT.schedules}</div>
          <div className="fg-r2">
            <div className={fieldState('header:arrivalTime')} data-invalid-target="header:arrivalTime">
              <label htmlFor="rdo-arrival">Chegada <span style={{ color: 'var(--rd)' }}>*</span></label>
              <input
                id="rdo-arrival"
                type="time"
                value={arrivalTime}
                onChange={event => setHeaderField('arrivalTime', event.target.value)}
                required
              />
            </div>
            <div className={fieldState('header:departureTime')} data-invalid-target="header:departureTime">
              <label htmlFor="rdo-departure">{TEXT.departure} <span style={{ color: 'var(--rd)' }}>*</span></label>
              <input
                id="rdo-departure"
                type="time"
                value={departureTime}
                onChange={event => setHeaderField('departureTime', event.target.value)}
                required
              />
            </div>
          </div>
          <div className={fieldState('header:lunchBreak')} style={{ marginTop: 10 }} data-invalid-target="header:lunchBreak">
            <label htmlFor="rdo-lunch">Intervalo de almoço <span style={{ color: 'var(--rd)' }}>*</span></label>
            <input
              id="rdo-lunch"
              type="time"
              step={1}
              value={lunchBreak}
              onChange={event => setHeaderField('lunchBreak', event.target.value)}
              required
            />
          </div>
        </section>

        {/* Card 3: Equipe diurna */}
        <section className="page-card">
          <div className="section-title">{TEXT.team}</div>
          <div
            className={`colab-list ${invalidTarget === 'header:collaborators' ? 'field-invalid-panel' : ''}`}
            data-invalid-target="header:collaborators"
          >
            {renderCollaboratorList(collaboratorIds)}
          </div>
          <div className="cadd">
            <select value={collaboratorToAdd} onChange={event => setCollaboratorToAdd(event.target.value)}>
              <option value="">Adicionar...</option>
              {collaborators
                .filter(item => !collaboratorIds.includes(item.id))
                .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="cadd-btn" type="button" onClick={() => addCollaboratorFromSelect()}>
              + Add
            </button>
          </div>
        </section>

        {/* Card 4: Condições especiais */}
        <section className="page-card">
          <div className="section-title">{TEXT.specialConditions}</div>
          <div className="tog-row">
            <span className="tog-lbl">Houve standby?</span>
            <label className="tog">
              <input
                type="checkbox"
                checked={standby}
                onChange={event => setHeaderField('standby', event.target.checked)}
              />
              <span className="tog-sl" />
            </label>
          </div>
          {standby ? (
            <div className="collapse-section">
              <div className="fg-r2">
                <div className={fieldState('header:standbyDuration')} data-invalid-target="header:standbyDuration">
                  <label>Tempo total <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="time"
                    step={60}
                    value={standbyDuration}
                    onChange={event => setStandbyDuration(event.target.value)}
                  />
                </div>
                <div className={fieldState('header:standbyMotivo')} data-invalid-target="header:standbyMotivo">
                  <label>Motivo <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="text"
                    placeholder="Motivo..."
                    value={standbyMotivo}
                    onChange={event => setStandbyMotivo(event.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <div className="tog-row">
            <span className="tog-lbl">Houve turno noturno?</span>
            <label className="tog">
              <input
                type="checkbox"
                checked={noturno}
                onChange={event => setHeaderField('noturno', event.target.checked)}
              />
              <span className="tog-sl" />
            </label>
          </div>
          {noturno ? (
            <div className="collapse-section">
              <div className="fg-r2">
                <div className={fieldState('header:noturnoStart')} data-invalid-target="header:noturnoStart">
                  <label>Início <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="time"
                    value={noturnoStart}
                    onChange={event => setNoturnoStart(event.target.value)}
                  />
                </div>
                <div className={fieldState('header:noturnoEnd')} data-invalid-target="header:noturnoEnd">
                  <label>Término <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="time"
                    value={noturnoEnd}
                    onChange={event => setNoturnoEnd(event.target.value)}
                  />
                </div>
              </div>
              <div className="section-title" style={{ marginTop: 14 }}>{TEXT.nightTeam}</div>
              <div
                className={`colab-list ${invalidTarget === 'header:nightCollaborators' ? 'field-invalid-panel' : ''}`}
                data-invalid-target="header:nightCollaborators"
              >
                {renderCollaboratorList(nightCollaboratorIds, true)}
              </div>
              <div className="cadd">
                <select value={nightCollaboratorToAdd} onChange={event => setNightCollaboratorToAdd(event.target.value)}>
                  <option value="">Adicionar...</option>
                  {collaborators
                    .filter(item => !nightCollaboratorIds.includes(item.id))
                    .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button className="cadd-btn" type="button" onClick={() => addCollaboratorFromSelect(true)}>
                  + Add
                </button>
              </div>
            </div>
          ) : null}
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
        </>
        ) : null}

        {step === 1 ? (
        <>
        <section className="page-card" data-invalid-target="services:empty">
          <div className="section-title">{TEXT.services}</div>
          <div className="admin-form-actions">
            <button
              className="secondary-button"
              type="button"
              style={{ width: '100%', borderStyle: 'dashed', color: 'var(--g)', fontWeight: 700 }}
              onClick={() => setShowServiceModal(true)}
            >
              ＋ {TEXT.addService}
            </button>
          </div>
          {services.length ? (
            <div className="admin-stack" style={{ marginTop: 12 }}>
              {services.map((service, index) => (
                <article className="admin-card-react" key={service.id} data-service-id={service.id}>
                  <div className="svc-card-header">
                    <div className="svc-card-title">
                      <span>{serviceTypeLabels[normalizeServiceType(service.type)] || service.type}</span>
                      <span className="svc-card-badge">{TEXT.service} {index + 1}</span>
                    </div>
                    <div className="admin-card-actions">
                      <button className="svc-remove" type="button" onClick={() => removeService(service.id)}>
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
                    <div className={serviceFieldState(service.id, 'equipmentId')}>
                      <label>Equipamento(s) <span style={{ color: 'var(--rd)' }}>*</span></label>
                      <input
                        value={typeof service.data.equipmentId === 'string' ? service.data.equipmentId : ''}
                        placeholder="Informar equipamento do cliente..."
                        onChange={event => updateService(service.id, { equipmentId: event.target.value })}
                      />
                    </div>
                    {normalizeServiceType(service.type) !== 'inibicao' ? (
                      <div className={serviceFieldState(service.id, 'system')}>
                        <label>Sistema <span style={{ color: 'var(--rd)' }}>*</span></label>
                        <input
                          value={typeof service.data.system === 'string' ? service.data.system : ''}
                          onChange={event => updateService(service.id, { system: event.target.value })}
                        />
                      </div>
                    ) : null}
                    <div className={serviceFieldState(service.id, 'startTime')}>
                      <label>Hora de início <span style={{ color: 'var(--rd)' }}>*</span></label>
                      <input
                        type="time"
                        value={typeof service.data.startTime === 'string' ? service.data.startTime : ''}
                        onChange={event => updateService(service.id, { startTime: event.target.value })}
                      />
                    </div>
                    <div className={serviceFieldState(service.id, 'endTime')}>
                      <label>Hora de término/pausa <span style={{ color: 'var(--rd)' }}>*</span></label>
                      <input
                        type="time"
                        value={typeof service.data.endTime === 'string' ? service.data.endTime : ''}
                        onChange={event => updateService(service.id, { endTime: event.target.value })}
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
                      invalidKey={serviceInvalidKey(service.id)}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">{TEXT.noService}</p>
          )}
        </section>
        </>
        ) : null}

        {step === 2 ? (
        <>
        {/* Card Horas extras */}
        <section className="page-card">
          <div className="section-title">Horas extras</div>
          <div style={{ fontSize: 12, color: 'var(--mu)', lineHeight: 1.7, marginBottom: 10 }}>
            Nenhuma hora extra identificada.
          </div>
          <div className="field-group">
            <label htmlFor="rdo-overtime">Justificativa</label>
            <textarea
              id="rdo-overtime"
              placeholder="Descreva o motivo das horas extras..."
              rows={3}
              value={overtimeReason}
              onChange={event => setHeaderField('overtimeReason', event.target.value)}
            />
          </div>
        </section>

        {/* Card Atividades do dia */}
        <section className="page-card">
          <div className="section-title">Atividades do dia</div>
          <div className="field-group">
            <label htmlFor="rdo-description">{TEXT.dailyDescription}</label>
            <textarea
              id="rdo-description"
              style={{ minHeight: 100 }}
              placeholder="Descreva as atividades realizadas..."
              rows={5}
              value={dailyDescription}
              onChange={event => setHeaderField('dailyDescription', event.target.value)}
            />
          </div>
        </section>

        {/* Card Fotos */}
        <section className="page-card">
          <div className="section-title">{TEXT.photos}</div>
          <UploadField
            label=""
            value={generalUploads as UploadedFile[]}
            projectId={projectId}
            onChange={setGeneralUploads}
          />
        </section>

        {/* Card Resumo */}
        <section className="page-card resumo-card">
          <div className="resumo-card-title">Resumo</div>
          <div className="resumo-txt">{buildResumoText()}</div>
        </section>
        </>
        ) : null}

        <section className="page-card rdo-bottom-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={step === 0 ? () => navigate(backPath) : () => setStep(current => Math.max(current - 1, 0))}
          >
            {step === 0 ? 'Cancelar' : `← ${TEXT.back}`}
          </button>
          <button className="secondary-button" type="button" onClick={handleSaveDraft}>
            {TEXT.saveDraft}
          </button>
          {step < rdoSteps.length - 1 ? (
            <button className="primary-button" type="button" onClick={handleNextStep}>
              {TEXT.next}
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={handleSubmit}>
              {TEXT.submit}
            </button>
          )}
        </section>
      </main>

      {showServiceModal ? (
        <div className="stype-modal-ov" onClick={() => setShowServiceModal(false)}>
          <div className="stype-modal-sh" onClick={event => event.stopPropagation()}>
            <div className="stype-modal-handle" />
            <div className="stype-modal-title">Tipo de serviço</div>
            <div className="stype-grid">
              {serviceTypeModalOptions.map(({ type, icon, name }) => (
                <button
                  key={type}
                  className="stype-btn"
                  type="button"
                  onClick={() => {
                    addService(type);
                    setShowServiceModal(false);
                  }}
                >
                  <div className="stype-icon">{icon}</div>
                  <div className="stype-name">{name}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
