import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { downloadReportDocx, downloadReportPdf } from '../api/reports';
import { useAuth } from '../auth/AuthContext';
import type { UploadedFile } from '../api/uploads';
import { useCollaborators } from '../hooks/useCollaborators';
import { useEquipment } from '../hooks/useEquipment';
import { useProjects } from '../hooks/useProjects';
import { useReport, useReportMutations } from '../hooks/useReports';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';
import { ReasonDialog } from '../components/ui/ReasonDialog';
import { UploadField } from '../components/ui/UploadField';
import type { ReportPayload, ReportStatus, ReportSummary } from '../types/domain';
import { downloadBlob } from '../utils/download';

const serviceTypeOptions = ['LIMPEZA', 'FLUSHING', 'PRESSAO', 'FILTRAGEM', 'INSPECAO', 'OUTRO'];

const TEXT = {
  approvedAt: 'Aprovado em',
  approve: 'Aprovar',
  back: 'Voltar',
  code: 'C\u00f3digo',
  description: 'Descri\u00e7\u00e3o do dia',
  details: 'Detalhe do relat\u00f3rio',
  downloadError: 'N\u00e3o foi poss\u00edvel baixar o relat\u00f3rio.',
  finalization: 'Finaliza\u00e7\u00e3o',
  generalInfo: 'Informa\u00e7\u00f5es gerais',
  interval: 'Intervalo',
  loadError: 'Falha ao carregar relat\u00f3rio.',
  loading: 'Carregando relat\u00f3rio...',
  missing: 'Relat\u00f3rio n\u00e3o encontrado.',
  nightTeam: 'Equipe noturna',
  noService: 'Nenhum servi\u00e7o adicionado.',
  project: 'Projeto',
  reject: 'Devolver',
  rejectClient: 'Reprovar',
  rejectClientPrompt: 'Informe o motivo da reprova\u00e7\u00e3o do relat\u00f3rio:',
  rejectClientRequired: 'Informe um motivo para reprovar o relat\u00f3rio.',
  rejectPrompt: 'Informe o motivo da devolu\u00e7\u00e3o do relat\u00f3rio:',
  rejectRequired: 'Informe um motivo para devolver o relat\u00f3rio.',
  reportSummary: 'Resumo do relat\u00f3rio',
  requestSignature: 'Assinar',
  requestSignatureError: 'N\u00e3o foi poss\u00edvel solicitar a assinatura.',
  returnedAt: 'Devolvido em',
  save: 'Salvar altera\u00e7\u00f5es',
  saved: 'Relat\u00f3rio atualizado.',
  select: 'Selecione',
  service: 'Servi\u00e7o',
  services: 'Servi\u00e7os',
  signedLocked: 'Relat\u00f3rio assinado. Os dados est\u00e3o bloqueados para edi\u00e7\u00e3o.',
  signatureRequested: 'Assinatura solicitada. Abra o link para concluir.',
  team: 'Equipe',
  technicalPayload: 'Carga t\u00e9cnica',
  time: 'Hor\u00e1rio',
  updateError: 'N\u00e3o foi poss\u00edvel atualizar o relat\u00f3rio.'
};

const serviceUploadLabel = 'Fotos do servi\u00e7o';

interface RdoServiceForm {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface RdoFormState {
  projectId: string | null;
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

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => formatJson(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : '';
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

function buildPayload(report: ReportSummary, form: RdoFormState): Omit<ReportPayload, 'createdByUserId' | 'status'> {
  return {
    projectId: form.projectId || report.projectId,
    reportType: report.reportType,
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
    services: form.services.map(service => ({
      serviceType: service.type,
      equipmentId: getString(service.data.equipmentId) || null,
      system: getString(service.data.system) || null,
      material: getString(service.data.material) || null,
      startTime: getString(service.data.startTime) || null,
      endTime: getString(service.data.endTime) || null,
      finalized: true,
      extraData: {
        notes: getString(service.data.notes)
      }
    }))
  };
}

function ManagerRdoEditor({ report }: { report: ReportSummary }) {
  const projectsQuery = useProjects(true);
  const collaboratorsQuery = useCollaborators();
  const equipmentQuery = useEquipment();
  const reportMutations = useReportMutations();
  const [form, setForm] = useState<RdoFormState>(() => reportToForm(report));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const readOnly = report.status === 'SIGNED';

  useEffect(() => {
    setForm(reportToForm(report));
    setMessage(null);
    setError(null);
  }, [report]);

  const projects = projectsQuery.data || [];
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
      services: [...current.services, { id: serviceId(), type: 'LIMPEZA', data: {} }]
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

  function serviceUploads(data: Record<string, unknown>): UploadedFile[] {
    const groups = Array.isArray(data.__uploads__) ? data.__uploads__ : [];
    const group = groups.find(item => item && typeof item === 'object' && (item as { label?: unknown }).label === serviceUploadLabel);
    const files = group && typeof group === 'object' ? (group as { files?: unknown }).files : [];
    return asUploadedFiles(files);
  }

  function updateServiceUploads(serviceId: string, files: UploadedFile[]) {
    updateService(serviceId, {
      data: {
        __uploads__: files.length ? [{ label: serviceUploadLabel, files }] : []
      }
    });
  }

  async function handleSave() {
    if (readOnly) return;
    setMessage(null);
    setError(null);

    try {
      await reportMutations.updateReport.mutateAsync({ id: report.id, payload: buildPayload(report, form) });
      setMessage(TEXT.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.updateError);
    }
  }

  async function handleStatus(status: Extract<ReportStatus, 'APPROVED' | 'RETURNED'>, reviewNotes?: string | null) {
    if (readOnly) return;
    setMessage(null);
    setError(null);

    try {
      await reportMutations.updateStatus.mutateAsync({ id: report.id, payload: { status, reviewNotes } });
      if (status === 'RETURNED') setReturnDialogOpen(false);
      setMessage(status === 'APPROVED' ? 'Relat\u00f3rio aprovado.' : 'Relat\u00f3rio devolvido.');
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.updateError);
    }
  }

  return (
    <>
      {readOnly ? <div className="page-card inline-success">{TEXT.signedLocked}</div> : null}
      {error ? <div className="page-card inline-error">{error}</div> : null}
      {message ? <div className="page-card inline-success">{message}</div> : null}

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
              value={form.reportDate}
              disabled={readOnly}
              onChange={event => setField('reportDate', event.target.value)}
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
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-departure">Sa\u00edda</label>
            <input
              id="rdo-departure"
              type="time"
              value={form.departureTime}
              disabled={readOnly}
              onChange={event => setField('departureTime', event.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-lunch">{TEXT.interval}</label>
            <input
              id="rdo-lunch"
              value={form.lunchBreak}
              disabled={readOnly}
              onChange={event => setField('lunchBreak', event.target.value)}
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
              + Adicionar servi\u00e7o
            </button>
          </div>
        ) : null}
        {form.services.length ? (
          <div className="admin-stack" style={{ marginTop: 12 }}>
            {form.services.map((service, index) => (
              <article className="admin-card-react" key={service.id}>
                <div className="admin-card-head">
                  <div className="admin-card-title">{TEXT.service} {index + 1}</div>
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
                      value={service.type}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { type: event.target.value })}
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
                  <div className="field-group">
                    <label>Material</label>
                    <input
                      value={getString(service.data.material)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { material: event.target.value } })}
                    />
                  </div>
                  <div className="field-group">
                    <label>In\u00edcio</label>
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
                  <div className="field-group">
                    <label>Observa\u00e7\u00f5es</label>
                    <textarea
                      rows={3}
                      value={getString(service.data.notes)}
                      disabled={readOnly}
                      onChange={event => updateService(service.id, { data: { notes: event.target.value } })}
                    />
                  </div>
                  <UploadField
                    label={serviceUploadLabel}
                    value={serviceUploads(service.data)}
                    projectId={form.projectId}
                    disabled={readOnly}
                    onChange={files => updateServiceUploads(service.id, files)}
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
              {TEXT.approve}
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientRejectOpen, setClientRejectOpen] = useState(false);
  const canDownloadDocx = role === 'MANAGER';
  const canClientSign = role === 'CLIENT' && report.reportType === 'RDO' && report.status === 'APPROVED';

  async function handleDownload(format: 'pdf' | 'docx') {
    setMessage(null);
    setError(null);
    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.${format}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.downloadError);
    }
  }

  async function handleRequestSignature() {
    setMessage(null);
    setError(null);
    try {
      const response = await reportMutations.requestSignature.mutateAsync({ id: report.id });
      setMessage(TEXT.signatureRequested);
      if (response.signUrl) window.open(response.signUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.requestSignatureError);
    }
  }

  async function handleClientReject(comment: string) {
    setMessage(null);
    setError(null);

    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment }
      });
      setClientRejectOpen(false);
      setMessage('Avalia\u00e7\u00e3o registrada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : TEXT.updateError);
    }
  }

  return (
    <section className="page-card">
      <div className="section-title">A\u00e7\u00f5es</div>
      {error ? <div className="inline-error">{error}</div> : null}
      {message ? <div className="inline-success">{message}</div> : null}
      <div className="admin-form-actions" style={{ marginTop: error || message ? 12 : 0 }}>
        <button className="secondary-button" type="button" onClick={() => void handleDownload('pdf')}>
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
    </section>
  );
}

function ReportSummaryView({ report }: { report: ReportSummary }) {
  return (
    <>
      <section className="page-card">
        <div className="section-title">{TEXT.generalInfo}</div>
        <div className="detail-grid">
          <div><span className="detail-label">{TEXT.project}</span><span className="detail-value">{report.project.name}</span></div>
          <div><span className="detail-label">{TEXT.code}</span><span className="detail-value">{report.project.code}</span></div>
          <div><span className="detail-label">Data</span><span className="detail-value">{formatDate(report.reportDate)}</span></div>
          <div><span className="detail-label">{TEXT.time}</span><span className="detail-value">{report.arrivalTime} as {report.departureTime}</span></div>
          <div><span className="detail-label">{TEXT.interval}</span><span className="detail-value">{report.lunchBreak || '-'}</span></div>
          <div><span className="detail-label">Status</span><span className="detail-value">{report.status}</span></div>
        </div>
      </section>

      <section className="page-card">
        <div className="section-title">{TEXT.reportSummary}</div>
        <div className="detail-grid">
          <div><span className="detail-label">Motivo da hora extra</span><span className="detail-value">{report.overtimeReason || '-'}</span></div>
          <div><span className="detail-label">{TEXT.description}</span><span className="detail-value">{report.dailyDescription || '-'}</span></div>
          <div><span className="detail-label">{TEXT.approvedAt}</span><span className="detail-value">{formatDate(report.approvedAt)}</span></div>
          <div><span className="detail-label">{TEXT.returnedAt}</span><span className="detail-value">{formatDate(report.returnedAt)}</span></div>
        </div>
        {report.reviewNotes ? <p className="report-note">{report.reviewNotes}</p> : null}
      </section>

      <section className="page-card">
        <div className="section-title">{TEXT.technicalPayload}</div>
        <pre className="json-block">{formatJson(report)}</pre>
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
            <ReportDetailActions report={report} role={user?.role} />
            {showManagerEditor ? <ManagerRdoEditor report={report} /> : <ReportSummaryView report={report} />}
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
