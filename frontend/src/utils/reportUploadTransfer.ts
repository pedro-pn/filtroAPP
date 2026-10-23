import type { UploadedFile } from '../api/uploads';
import { getServiceUploadGroup, serviceUploadLabels, updateServiceUploadGroup } from './serviceUploadGroups';
import { moveUpload } from './uploadOrder';

export interface ReportUploadTarget {
  serviceId?: string;
  label: string;
}

export interface ReportUploadMove {
  source: ReportUploadTarget;
  destination: ReportUploadTarget;
  from: number;
  to: number;
  fileUrl: string;
}

interface ReportUploads {
  generalUploads: UploadedFile[];
  services: { id: string; data: Record<string, unknown> }[];
}

/** Atualiza origem e destino juntos, sem encenar a exclusão global do arquivo. */
export function moveReportUpload<T extends ReportUploads>(form: T, move: ReportUploadMove): T {
  const { source, destination, from, to, fileUrl } = move;
  const sourceService = source.serviceId ? form.services.find(service => service.id === source.serviceId) : null;
  const destinationService = destination.serviceId ? form.services.find(service => service.id === destination.serviceId) : null;
  if ((source.serviceId && !sourceService) || (destination.serviceId && !destinationService)) return form;

  const sourceFiles = sourceService ? getServiceUploadGroup(sourceService.data, source.label) : form.generalUploads;
  const destinationFiles = destinationService ? getServiceUploadGroup(destinationService.data, destination.label) : form.generalUploads;
  const sameField = source.serviceId === destination.serviceId
    && (!source.serviceId || serviceUploadLabels(source.label).some(label => serviceUploadLabels(destination.label).includes(label)));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= sourceFiles.length
    || to < 0 || to > destinationFiles.length || sourceFiles[from].url !== fileUrl) return form;
  if (sameField && (from === to || to >= sourceFiles.length)) return form;

  const nextSource = sameField ? moveUpload(sourceFiles, from, to) : sourceFiles.filter((_, index) => index !== from);
  const nextDestination = sameField ? nextSource : [...destinationFiles];
  if (!sameField && !destinationFiles.some(file => file.url === fileUrl)) {
    nextDestination.splice(to, 0, { ...sourceFiles[from], label: destination.label });
  }

  // Aplica os patches em sequência nos dados atuais, inclusive no mesmo serviço.
  return {
    ...form,
    generalUploads: !destination.serviceId ? nextDestination : !source.serviceId ? nextSource : form.generalUploads,
    services: form.services.map(service => {
      let data = service.data;
      if (service.id === source.serviceId) data = { ...data, ...updateServiceUploadGroup(data, source.label, nextSource) };
      if (!sameField && service.id === destination.serviceId) data = { ...data, ...updateServiceUploadGroup(data, destination.label, nextDestination) };
      return data === service.data ? service : { ...service, data };
    })
  };
}
