import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { downloadReportDocx, downloadReportPdf } from '../api/reports';
import { useAuth } from '../auth/AuthContext';
import type { UploadedFile } from '../api/uploads';
import { ServiceFields, serviceTypeLabels, serviceTypeOptions } from '../components/reports/ServiceFields';
import { useToast } from '../components/ui/Toast';
import { useCollaborators } from '../hooks/useCollaborators';
import { useEquipment } from '../hooks/useEquipment';
import { useManometers } from '../hooks/useManometers';
import { useProjects } from '../hooks/useProjects';
import { useReport, useReportMutations, useReports } from '../hooks/useReports';
import { useUnits } from '../hooks/useUnits';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';
import { ReasonDialog } from '../components/ui/ReasonDialog';
import { UploadField } from '../components/ui/UploadField';
import type { ReportPayload, ReportStatus, ReportSummary } from '../types/domain';
import { downloadBlob } from '../utils/download';
import { buildReportServicePayload, normalizeServiceType } from '../utils/reportServicePayload';

const TEXT = {
  approvedAt: 'Aprovado em',
  approve: 'Aprovar',
  back: 'Voltar',
  code: 'Código',
  collaborators: 'Equipe',
  description: 'Descrição do dia',
  details: 'Detalhe do relatório',
  downloadError: 'Não foi possível baixar o relatório.',
  finalization: 'Finalização',
  generalInfo: 'Informações gerais',
  interval: 'Intervalo',
  loadError: 'Falha ao carregar relatório.',
  loading: 'Carregando relatório...',
  missing: 'Relatório não encontrado.',
  nightTeam: 'Equipe noturna',
  noService: 'Nenhum serviço adicionado.',
  project: 'Projeto',
  reject: 'Devolver',
  rejectClient: 'Reprovar',
  rejectClientPrompt: 'Informe o motivo da reprovação do relatório:',
  rejectClientRequired: 'Informe um motivo para reprovar o relatório.',
  rejectPrompt: 'Informe o motivo da devolução do relatório:',
  rejectRequired: 'Informe um motivo para devolver o relatório.',
  reportSummary: 'Resumo',
  requestSignature: 'Assinar',
  requestSignatureError: 'Não foi possível solicitar a assinatura.',
  returnedAt: 'Devolvido em',
  save: 'Salvar alterações',
  saved: 'Relatório atualizado.',
  select: 'Selecione',
  service: 'Serviço',
  services: 'Serviços',
  signedLocked: 'Relatório assinado. Os dados estão bloqueados para edição.',
  signatureRequested: 'Assinatura solicitada. Abra o link para concluir.',
  team: 'Equipe',
  time: 'Horário',
  updateError: 'Não foi possível atualizar o relatório.'
};


interface RdoServiceForm {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface RdoFormState {
  projectId: string | null;
  sequenceNumber: string;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  collaboratorIds: string[];
  nightCollaboratorIds: string[];
  standby: boolean;
  noturno: boolean;
  overtimeReason: string;
  dailyDescription: string;
  generalUploads: UploadedFile[];
  services: RdoServiceForm[];
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function toPositiveInteger(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function hasActiveClientRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : '';
  const resolvedAt = typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : '';
  if (!rejectedAt) return false;
  return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
}

function asUploadedFiles(value: unknown): UploadedFile[] {
  return Array.isArray(value)
    ? value.filter((item): item is UploadedFile => Boolean(item) && typeof item === 'object' && typeof (item as UploadedFile).url === 'string')
    : [];
}

function serviceId() {
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function reportToForm(report: ReportSummary): RdoFormState {
  const specialConditions = asRecord(report.specialConditions);
  const noturnoDetails = asRecord(specialConditions.noturnoDetails);
  const nightCollaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? noturnoDetails.collaboratorIds.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    projectId: report.projectId,
    sequenceNumber: report.sequenceNumber ? String(report.sequenceNumber) : '',
    reportDate: toDateInput(report.reportDate),
    arrivalTime: report.arrivalTime || '',
    departureTime: report.departureTime || '',
    lunchBreak: report.lunchBreak || '',
    collaboratorIds: (report.collaborators || []).map(link => link.collaboratorId).filter(Boolean),
    nightCollaboratorIds,
    standby: Boolean(specialConditions.standby),
    noturno: Boolean(noturnoDetails.enabled || nightCollaboratorIds.length),
    overtimeReason: report.overtimeReason || '',
    dailyDescription: report.dailyDescription || '',
    generalUploads: asUploadedFiles(specialConditions.generalUploads),
    services: (report.services || []).map(service => ({
      id: service.id || serviceId(),
      type: service.serviceType,
      data: {
        ...(service.extraData || {}),
        equipmentId: service.equipmentId || '',
        system: service.system || '',
        material: service.material || '',
        startTime: service.startTime || '',
        endTime: service.endTime || '',
        notes: getString(service.extraData?.notes)
      }
    }))
  };
}

function buildPayload(
  report: ReportSummary,
  form: RdoFormState,
  resources: {
    collaborators: ReturnType<typeof useCollaborators>['data'];
    equipment: ReturnType<typeof useEquipment>['data'];
    units: ReturnType<typeof useUnits>['data'];
  }
): Omit<ReportPayload, 'createdByUserId' | 'status'> {
  const serviceCollaboratorIds = Array.from(new Set([...form.collaboratorIds, ...form.nightCollaboratorIds]));

  return {
    projectId: form.projectId || report.projectId,
    reportType: report.reportType,
    sequenceNumber: toPositiveInteger(form.sequenceNumber),
    reportDate: form.reportDate,
    arrivalTime: form.arrivalTime,
    departureTime: form.departureTime,
    lunchBreak: form.lunchBreak,
    daytimeCount: form.collaboratorIds.length,
    overtimeReason: form.overtimeReason || null,
    dailyDescription: form.dailyDescription || null,
    specialConditions: {
      ...asRecord(report.specialConditions),
      standby: form.standby,
      generalUploads: form.generalUploads,
      noturnoDetails: {
        enabled: form.noturno,
        collaboratorIds: form.nightCollaboratorIds
      }
    },
    collaboratorIds: form.collaboratorIds,
    services: form.services.map(service => buildReportServicePayload(service, {
      collaboratorIds: serviceCollaboratorIds,
      collaborators: resources.collaborators || [],
      equipment: resources.equipment || [],
      units: resources.units || []
    }))
  };
}

function ManagerRdoEditor({ report }: { report: ReportSummary }) {
  const projectsQuery = useProjects(true);
  const reportsQuery = useReports();
  const collaboratorsQuery = useCollaborators();
  const equipmentQuery = useEquipment();
  const unitsQuery = useUnits();
  const manometersQuery = useManometers();
  const reportMutations = useReportMutations();
  const showToast = useToast();
  const [form, setForm] = useState<RdoFormState>(() => reportToForm(report));
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const readOnly = report.status === 'SIGNED';

  useEffect(() => {
    setForm(reportToForm(report));
  }, [report]);

  const projects = projectsQuery.data || [];
  const selectedProject = projects.find(project => project.id === (form.projectId || report.projectId))
    || (form.projectId === report.projectId ? report.project : null);
  const projectLeaderHint = selectedProject?.operator?.name
    ? `Líder do projeto: ${selectedProject.operator.name}`
    : 'Projeto sem líder definido.';
  const parsedSequenceNumber = toPositiveInteger(form.sequenceNumber);
  const sequenceConflict = useMemo(() => {
    if (!form.projectId || !parsedSequenceNumber) return null;
    return (reportsQuery.data || []).find(item => (
      item.id !== report.id
      && item.projectId === form.projectId
      && item.reportType === report.reportType
      && Number(item.sequenceNumber) === parsedSequenceNumber
    )) || null;
  }, [form.projectId, parsedSequenceNumber, report.id, report.reportType, reportsQuery.data]);
  const sequenceHint = sequenceConflict
    ? `Número já usado no relatório ${sequenceConflict.reportType} ${sequenceConflict.sequenceNumber}.`
    : 'Usado para manter a sequência do projeto e dos relatórios derivados.';
  const selectedCollaboratorIds = useMemo(
    () => new Set([...form.collaboratorIds, ...form.nightCollaboratorIds]),
    [form.collaboratorIds, form.nightCollaboratorIds]
  );
  const collaborators = (collaboratorsQuery.data || []).filter(item => item.isActive || selectedCollaboratorIds.has(item.id));
  const selectedEquipmentIds = useMemo(
    () => new Set(form.services.map(service => getString(service.data.equipmentId)).filter(Boolean)),
    [form.services]
  );
  const equipment = (equipmentQuery.data || []).filter(item => item.isActive || selectedEquipmentIds.has(item.id));
  const units = unitsQuery.data || [];
  const manometers = manometersQuery.data || [];

  function setField<K extends keyof RdoFormState>(field: K, value: RdoFormState[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function toggleCollaborator(id: string, checked: boolean, night = false) {
    const field = night ? 'nightCollaboratorIds' : 'collaboratorIds';
    const current = form[field];
    const next = checked ? [...current, id] : current.filter(item => item !== id);
    setField(field, Array.from(new Set(next)));
  }

  function addService() {
    setForm(current => ({
      ...current,
      services: [...current.services, { id: serviceId(), type: 'limpeza', data: {} }]
    }));
  }

  function updateService(id: string, data: Partial<RdoServiceForm>) {
    setForm(current => ({
      ...current,
      services: current.services.map(service => (
        service.id === id
          ? { ...service, ...data, data: { ...service.data, ...(data.data || {}) } }
          : service
      ))
    }));
  }

  function removeService(id: string) {
    setForm(current => ({ ...current, services: current.services.filter(service => service.id !== id) }));
  }

  function validateSequence() {
    if (!toPositiveInteger(form.sequenceNumber)) {
      showToast('Informe um número de relatório válido.', 'error');
      return false;
    }
    if (sequenceConflict) {
      showToast('O número informado já está em uso no projeto selecionado.', 'error');
      return false;
    }
    return true;
  }

  async function handleSave() {
    if (readOnly) return;
    if (!validateSequence()) return;

    try {
      await reportMutations.updateReport.mutateAsync({
        id: report.id,
        payload: buildPayload(report, form, {
          collaborators,
          equipment,
          units
        })
      });
      showToast(TEXT.saved, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
    }
  }

  async function handleStatus(status: Extract<ReportStatus, 'APPROVED' | 'RETURNED'>, reviewNotes?: string | null) {
    if (readOnly) return;
    if (!validateSequence()) return;

    try {
      await reportMutations.updateStatus.mutateAsync({ id: report.id, payload: { status, reviewNotes } });
      if (status === 'RETURNED') setReturnDialogOpen(false);
      showToast(status === 'APPROVED' ? 'Relatório aprovado.' : 'Relatório devolvido.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
    }
  }

  return (
    <>
      {readOnly ? <div className="page-card inline-success">{TEXT.signedLocked}</div> : null}

      <section className="page-card">
        <div className="section-title">{TEXT.generalInfo}</div>
        <div className="admin-form-grid">
          <div className="field-group">
            <label htmlFor="rdo-project">{TEXT.project}</label>
            <select
              id="rdo-project"
              value={form.projectId || ''}
              disabled={readOnly}
              onChange={event => setField('projectId', event.target.value || null)}
              required
            >
              <option value="">{TEXT.select}</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))}
            </select>
            <span className="placeholder-copy" style={{ marginTop: 4 }}>{projectLeaderHint}</span>
          </div>
          <div className="field-group">
            <label htmlFor="rdo-sequence">Número do relatório</label>
            <input
              id="rdo-sequence"
              type="number"
              min={1}
              step={1}
              value={form.sequenceNumber}
              disabled={readOnly}
              onChange={event => setField('sequenceNumber', event.target.value)}
              required
            />
            <span
              className={sequenceConflict ? 'inline-error' : 'placeholder-copy'}
              style={{ marginTop: 4 }}
            >
              {sequenceHint}
            </span>
          </div>
          <div className="field-group">
            <label htmlFor="rdo-date">Data</label>
            <input
              id="rdo-date"
              type="date"
              value={form.reportDate}
              disabled={readOnly}
              onChange={event => setField('reportDate', event.target.value)}
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-arrival">Chegada</label>
            <input
              id="rdo-arrival"
              type="time"
              value={form.arrivalTime}
              disabled={readOnly}
              onChange={event => setField('arrivalTime', event.target.value)}
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-departure">Saída</label>
            <input
              id="rdo-departure"
              type="time"
              value={form.departureTime}
              disabled={readOnly}
              onChange={event => setField('departureTime', event.target.value)}
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-lunch">{TEXT.interval}</label>
            <input
              id="rdo-lunch"
              type="time"
              step={1}
              value={form.lunchBreak}
              disabled={readOnly}
              onChange={event => setField('lunchBreak', event.target.value)}
              required
            />
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={form.standby}
              disabled={readOnly}
              onChange={event => setField('standby', event.target.checked)}
            />
            Standby
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={form.noturno}
              disabled={readOnly}
              onChange={event => setField('noturno', event.target.checked)}
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
                checked={form.collaboratorIds.includes(item.id)}
                disabled={readOnly}
                onChange={event => toggleCollaborator(item.id, event.target.checked)}
              />
              <span>{item.name}</span>
            </label>
          ))}
        </div>
        {form.noturno ? (
          <>
            <div className="section-title" style={{ marginTop: 16 }}>{TEXT.nightTeam}</div>
            <div className="rdo-check-grid">
              {collaborators.map(item => (
                <label className="rdo-check-row" key={`night-${item.id}`}>
                  <input
                    type="checkbox"
                    checked={form.nightCollaboratorIds.includes(item.id)}
                    disabled={readOnly}
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
        {!readOnly ? (
          <div className="admin-form-actions">
            <button className="secondary-button" type="button" onClick={addService}>
              + Adicionar serviço
            </button>
          </div>
        ) : null}
        {form.services.length ? (
          <div className="admin-stack" style={{ marginTop: 12 }}>
            {form.services.map((service, index) => (
              <article className="admin-card-react" key={service.id}>
                <div className="admin-card-head">
                  <div className="admin-card-title">{TEXT.service} {index + 1} — {serviceTypeLabels[service.type] || service.type}</div>
                  {!readOnly ? (
                    <div className="admin-card-actions">
                      <button className="secondary-button" type="button" onClick={() => removeService(service.id)}>
                        Remover
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="admin-form-grid">
                  <div className="field-group">
                    <label>Tipo</label>
                    <select
                      value={normalizeServiceType(service.type)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { type: event.target.value })}
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
                      value={getString(service.data.equipmentId)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { equipmentId: event.target.value || null } })}
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
                      value={getString(service.data.system)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { system: event.target.value } })}
                    />
                  </div>
                  {normalizeServiceType(service.type) !== 'pressao' ? (
                    <div className="field-group">
                      <label>Material</label>
                      <input
                        value={getString(service.data.material)}
                        disabled={readOnly}
                        onChange={event => updateService(service.id, { data: { material: event.target.value } })}
                      />
                    </div>
                  ) : null}
                  <div className="field-group">
                    <label>Início</label>
                    <input
                      type="time"
                      value={getString(service.data.startTime)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { startTime: event.target.value } })}
                    />
                  </div>
                  <div className="field-group">
                    <label>Fim</label>
                    <input
                      type="time"
                      value={getString(service.data.endTime)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { endTime: event.target.value } })}
                    />
                  </div>
                  <ServiceFields
                    serviceType={service.type}
                    data={service.data}
                    onChange={update => updateService(service.id, { data: update })}
                    disabled={readOnly}
                    units={units}
                    manometers={manometers}
                    groupKey={service.id}
                    projectId={form.projectId}
                  />
                  <div className="field-group">
                    <label>Observações</label>
                    <textarea
                      rows={3}
                      value={getString(service.data.notes)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { notes: event.target.value } })}
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
              value={form.overtimeReason}
              disabled={readOnly}
              onChange={event => setField('overtimeReason', event.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-description">{TEXT.description}</label>
            <textarea
              id="rdo-description"
              rows={5}
              value={form.dailyDescription}
              disabled={readOnly}
              onChange={event => setField('dailyDescription', event.target.value)}
            />
          </div>
          <UploadField
            label="Fotos de registro"
            value={form.generalUploads}
            projectId={form.projectId}
            disabled={readOnly}
            onChange={files => setField('generalUploads', files)}
          />
        </div>
        {!readOnly ? (
          <div className="admin-form-actions" style={{ marginTop: 14 }}>
            <button
              className="secondary-button"
              type="button"
              disabled={reportMutations.updateStatus.isPending}
              onClick={() => setReturnDialogOpen(true)}
            >
              {TEXT.reject}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={reportMutations.updateReport.isPending}
              onClick={() => void handleSave()}
            >
              {TEXT.save}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={reportMutations.updateStatus.isPending}
              onClick={() => void handleStatus('APPROVED')}
            >
              {hasActiveClientRejection(report) ? 'Reenviar para avaliação' : TEXT.approve}
            </button>
          </div>
        ) : null}
        <ReasonDialog
          open={returnDialogOpen}
          title={TEXT.reject}
          description={TEXT.rejectPrompt}
          label="Motivo"
          confirmLabel={TEXT.reject}
          requiredMessage={TEXT.rejectRequired}
          isSubmitting={reportMutations.updateStatus.isPending}
          onCancel={() => setReturnDialogOpen(false)}
          onConfirm={reason => void handleStatus('RETURNED', reason)}
        />
      </section>
    </>
  );
}

function ReportDetailActions({ report, role }: { report: ReportSummary; role?: string }) {
  const reportMutations = useReportMutations();
  const showToast = useToast();
  const [clientRejectOpen, setClientRejectOpen] = useState(false);
  const canDownloadDocx = role === 'MANAGER';
  const canClientSign = role === 'CLIENT' && report.reportType === 'RDO' && report.status === 'APPROVED';

  async function handleDownload(format: 'pdf' | 'docx') {
    showToast(format === 'pdf' ? 'Gerando PDF...' : 'Gerando DOCX...', 'info');
    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.${format}`);
      showToast(format === 'pdf' ? 'PDF gerado com sucesso.' : 'DOCX baixado com sucesso.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.downloadError, 'error');
    }
  }

  async function handleRequestSignature() {
    try {
      const response = await reportMutations.requestSignature.mutateAsync({ id: report.id });
      showToast(TEXT.signatureRequested, 'success');
      if (response.signUrl) window.open(response.signUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleClientReject(comment: string) {
    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment }
      });
      setClientRejectOpen(false);
      showToast('Avaliação registrada.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
    }
  }

  return (
    <>
      <div className="detail-action-bar">
        <button className="primary-button" type="button" onClick={() => void handleDownload('pdf')}>
          PDF
        </button>
        {canDownloadDocx ? (
          <button className="secondary-button" type="button" onClick={() => void handleDownload('docx')}>
            DOCX
          </button>
        ) : null}
        {canClientSign ? (
          <>
            <button className="primary-button" type="button" onClick={() => void handleRequestSignature()}>
              {TEXT.requestSignature}
            </button>
            <button className="secondary-button" type="button" onClick={() => setClientRejectOpen(true)}>
              {TEXT.rejectClient}
            </button>
          </>
        ) : null}
      </div>
      <ReasonDialog
        open={clientRejectOpen}
        title={TEXT.rejectClient}
        description={TEXT.rejectClientPrompt}
        label="Motivo"
        confirmLabel={TEXT.rejectClient}
        requiredMessage={TEXT.rejectClientRequired}
        isSubmitting={reportMutations.clientReview.isPending}
        onCancel={() => setClientRejectOpen(false)}
        onConfirm={reason => void handleClientReject(reason)}
      />
    </>
  );
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  RETURNED: 'Devolvido',
  APPROVED: 'Aprovado',
  SIGNED: 'Assinado'
};

function ServiceSummaryRow({ service, index }: { service: NonNullable<ReportSummary['services']>[number]; index: number }) {
  const type = normalizeServiceType(service.serviceType || '');
  const label = serviceTypeLabels[type] || type;
  const extra = service.extraData || {};
  const rows: { label: string; value: string }[] = [];

  if (service.equipment) rows.push({ label: 'Equipamento', value: `${service.equipment.code} - ${service.equipment.name}` });
  if (service.system) rows.push({ label: 'Sistema', value: service.system });
  if (service.material) rows.push({ label: 'Material', value: service.material });
  if (service.startTime || service.endTime) {
    rows.push({ label: 'Horário', value: `${service.startTime || '--'} às ${service.endTime || '--'}` });
  }

  if (type === 'limpeza') {
    const metodos = Array.isArray(extra.metodos) ? (extra.metodos as string[]).join(', ') : '';
    const local = Array.isArray(extra.local) ? (extra.local as string[]).join(', ') : '';
    const inspecao = Array.isArray(extra.tipoInspecao) ? (extra.tipoInspecao as string[]).join(', ') : '';
    if (metodos) rows.push({ label: 'Método', value: metodos });
    if (local) rows.push({ label: 'Local', value: local });
    if (inspecao) rows.push({ label: 'Inspeção', value: inspecao });
  }

  if (type === 'pressao') {
    if (extra.pressaoTrabalho) rows.push({ label: 'P. trabalho', value: String(extra.pressaoTrabalho) });
    if (extra.pressaoTeste) rows.push({ label: 'P. teste', value: String(extra.pressaoTeste) });
    if (extra.fluidoTeste) rows.push({ label: 'Fluido', value: extra.fluidoTeste === 'agua' ? 'Água' : 'Óleo' });
  }

  if (type === 'flushing' || type === 'filtragem') {
    if (extra.tipoOleo) rows.push({ label: 'Tipo de óleo', value: String(extra.tipoOleo) });
    if (extra.volumeOleo) rows.push({ label: 'Volume', value: String(extra.volumeOleo) });
    if (type === 'flushing' && extra.tipoFlushing) {
      rows.push({ label: 'Tipo flushing', value: extra.tipoFlushing === 'primario' ? 'Primário' : 'Secundário' });
    }
  }

  const notes = typeof extra.notes === 'string' ? extra.notes : '';
  if (notes) rows.push({ label: 'Observações', value: notes });

  return (
    <article className="admin-card-react">
      <div className="admin-card-title">{index + 1}. {label}</div>
      {rows.length ? (
        <div className="detail-grid" style={{ marginTop: 8 }}>
          {rows.map(row => (
            <div key={row.label}>
              <span className="detail-label">{row.label}</span>
              <span className="detail-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function formatMinutes(value: unknown) {
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatDetailValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.names)) return record.names.map(formatDetailValue).filter(Boolean).join(', ');
    if (Array.isArray(record.codes)) return record.codes.map(formatDetailValue).filter(Boolean).join(', ');
    if (typeof record.code === 'string' && typeof record.serialNumber === 'string') return `${record.code} - ${record.serialNumber}`;
    if (typeof record.name === 'string' && typeof record.role === 'string') return `${record.name} - ${record.role}`;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.code === 'string') return record.code;
  }
  return '';
}

function buildDerivedRows(report: ReportSummary) {
  const specialConditions = asRecord(report.specialConditions);
  const serviceData = asRecord(specialConditions.serviceData);
  const rows: { label: string; value: string }[] = [];
  const fieldsByType: Record<string, string[]> = {
    RTP: [
      'Equipamento(s)', 'Sistema', 'Unidade de Teste Hidrostático (UTH)', 'Pressão de trabalho',
      'Pressão de teste', 'Fluido de teste', 'Qual óleo?', 'Manômetros utilizados',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RLQ: [
      'Equipamento(s)', 'Sistema', 'Material da tubulação', 'Método de limpeza',
      'Unidade de Limpeza Química', 'Local de limpeza', 'Tipo de inspeção',
      'Etapas realizadas no dia', 'Hora de início', 'Hora de término/pausa',
      'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RCPU: [
      'Equipamento(s)', 'Sistema', 'Tipo de óleo', 'Volume de óleo', 'Tipo de flushing',
      'Unidade de Flushing', 'Unidade de filtragem', 'Houve contagem de partículas?',
      'Contagem inicial NAS', 'Contagem final NAS', 'Contagem inicial ISO', 'Contagem final ISO',
      'Houve análise de umidade?', 'Umidade inicial (ppm)', 'Umidade final (ppm)',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RLM: [
      'Equipamento(s)', 'Sistema', 'Material do equipamento', 'Etapas realizadas no dia',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Observações'
    ],
    RLF: ['Equipamento(s)', 'Sistema', 'Material da tubulação', 'Etapas realizadas no dia', 'Observações'],
    RLI: ['Equipamento(s)', 'Sistema', 'Material da tubulação', 'Etapas realizadas no dia', 'Observações']
  };

  for (const label of fieldsByType[report.reportType] || []) {
    const value = formatDetailValue(serviceData[label]);
    if (value) rows.push({ label, value });
  }

  const resolvedCollaborators = formatDetailValue(specialConditions.resolvedCollaborators);
  const resolvedUnits = formatDetailValue(specialConditions.resolvedUnits);
  const resolvedThermoUnit = formatDetailValue(specialConditions.resolvedThermoUnit);
  const resolvedCounter = formatDetailValue(specialConditions.resolvedCounter);
  const totalTime = formatMinutes(specialConditions.totalMinutes);

  if (resolvedCollaborators) rows.push({ label: 'Equipe do serviço', value: resolvedCollaborators });
  if (resolvedUnits) rows.push({ label: 'Unidades resolvidas', value: resolvedUnits });
  if (resolvedThermoUnit) rows.push({ label: 'Equipamento de desidratação', value: resolvedThermoUnit });
  if (resolvedCounter) rows.push({ label: 'Contador utilizado', value: resolvedCounter });
  if (totalTime) rows.push({ label: 'Tempo acumulado', value: totalTime });

  return rows;
}

function DerivedReportDetails({ report }: { report: ReportSummary }) {
  if (report.reportType === 'RDO') return null;
  const rows = buildDerivedRows(report);
  if (!rows.length) return null;

  return (
    <section className="page-card">
      <div className="section-title">Dados do {report.reportType}</div>
      <div className="detail-grid">
        {rows.map(row => (
          <div key={row.label}>
            <span className="detail-label">{row.label}</span>
            <span className="detail-value">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportSummaryView({ report }: { report: ReportSummary }) {
  const specialConditions = asRecord(report.specialConditions);
  const noturnoDetails = asRecord(specialConditions.noturnoDetails);
  const nightCollaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? noturnoDetails.collaboratorIds.filter((id): id is string => typeof id === 'string')
    : [];

  const daytimeCollaborators = (report.collaborators || [])
    .filter(link => !nightCollaboratorIds.includes(link.collaboratorId))
    .map(link => link.collaborator?.name || link.collaboratorId);

  const nightCollaborators = (report.collaborators || [])
    .filter(link => nightCollaboratorIds.includes(link.collaboratorId))
    .map(link => link.collaborator?.name || link.collaboratorId);

  const generalUploads = asUploadedFiles(specialConditions.generalUploads);
  const isStandby = Boolean(specialConditions.standby);
  const isNoturno = Boolean(noturnoDetails.enabled || nightCollaboratorIds.length);

  return (
    <>
      <section className="page-card">
        <div className="section-title">{TEXT.generalInfo}</div>
        <div className="detail-grid">
          <div><span className="detail-label">{TEXT.project}</span><span className="detail-value">{report.project.name}</span></div>
          <div><span className="detail-label">{TEXT.code}</span><span className="detail-value">{report.project.code}</span></div>
          <div><span className="detail-label">Data</span><span className="detail-value">{formatDate(report.reportDate)}</span></div>
          <div><span className="detail-label">{TEXT.time}</span><span className="detail-value">{report.arrivalTime} às {report.departureTime}</span></div>
          <div><span className="detail-label">{TEXT.interval}</span><span className="detail-value">{report.lunchBreak || '-'}</span></div>
          <div><span className="detail-label">Status</span><span className="detail-value">{statusLabels[report.status] || report.status}</span></div>
          {isStandby ? <div><span className="detail-label">Standby</span><span className="detail-value">Sim</span></div> : null}
          {isNoturno ? <div><span className="detail-label">Turno noturno</span><span className="detail-value">Sim</span></div> : null}
        </div>
      </section>

      <section className="page-card">
        <div className="section-title">{TEXT.collaborators}</div>
        {daytimeCollaborators.length ? (
          <ul className="detail-list">
            {daytimeCollaborators.map(name => <li key={name}>{name}</li>)}
          </ul>
        ) : <p className="placeholder-copy">Nenhum colaborador registrado.</p>}
        {nightCollaborators.length ? (
          <>
            <div className="section-subtitle" style={{ marginTop: 12 }}>{TEXT.nightTeam}</div>
            <ul className="detail-list">
              {nightCollaborators.map(name => <li key={name}>{name}</li>)}
            </ul>
          </>
        ) : null}
      </section>

      {(report.services?.length ?? 0) > 0 ? (
        <section className="page-card">
          <div className="section-title">{TEXT.services}</div>
          <div className="admin-stack" style={{ marginTop: 8 }}>
            {(report.services || []).map((service, i) => (
              <ServiceSummaryRow key={service.id} service={service} index={i} />
            ))}
          </div>
        </section>
      ) : null}

      <DerivedReportDetails report={report} />

      <section className="page-card">
        <div className="section-title">{TEXT.reportSummary}</div>
        <div className="detail-grid">
          <div><span className="detail-label">Motivo hora extra</span><span className="detail-value">{report.overtimeReason || '-'}</span></div>
          <div><span className="detail-label">{TEXT.description}</span><span className="detail-value">{report.dailyDescription || '-'}</span></div>
          <div><span className="detail-label">{TEXT.approvedAt}</span><span className="detail-value">{formatDate(report.approvedAt)}</span></div>
          <div><span className="detail-label">{TEXT.returnedAt}</span><span className="detail-value">{formatDate(report.returnedAt)}</span></div>
        </div>
        {report.reviewNotes ? <p className="report-note">{report.reviewNotes}</p> : null}
        {generalUploads.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="detail-label">Fotos de registro</div>
            <div className="upload-thumbs">
              {generalUploads.map(file => (
                <a key={file.url} href={file.url} target="_blank" rel="noopener noreferrer">
                  <img src={file.url} alt={file.fileName || 'foto'} className="upload-thumb" />
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

export function ReportDetailPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { user, logout } = useAuth();
  const reportQuery = useReport(id, !!id);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  const report = reportQuery.data;
  const showManagerEditor = user?.role === 'MANAGER' && report?.reportType === 'RDO';

  return (
    <Shell>
      <TopBar
        title={TEXT.details}
        subtitle={report ? `${report.reportType}${report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}` : user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate(-1)}>
              {TEXT.back}
            </button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <main className="page-scroll">
        {reportQuery.isLoading ? <div className="page-card placeholder-copy">{TEXT.loading}</div> : null}
        {reportQuery.isError ? (
          <div className="page-card inline-error">
            {reportQuery.error instanceof Error ? reportQuery.error.message : TEXT.loadError}
          </div>
        ) : null}

        {report ? (
          <>
            {showManagerEditor ? <ManagerRdoEditor report={report} /> : <ReportSummaryView report={report} />}
            <ReportDetailActions report={report} role={user?.role} />
          </>
        ) : null}

        {!reportQuery.isLoading && !reportQuery.isError && !report ? (
          <div className="page-card placeholder-copy">
            {TEXT.missing}
          </div>
        ) : null}
      </main>
    </Shell>
  );
}
