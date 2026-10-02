import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import { useEquipamentoMutations } from '../../hooks/useEquipamentos';
import { fileToDataUrl } from './equipmentStatus';

export type EquipmentDocumentKind = 'tech' | 'cert';

export function useEquipmentDocumentUpload(
  item: CompanyEquipment,
  category: EquipmentCategory,
  isManager: boolean
) {
  const { updateEquipment } = useEquipamentoMutations();
  const showToast = useToast();
  const currentDoc = item.technicalDocGenerated || item.technicalDoc || null;
  const canTech = isManager && category.supportsTechnicalDoc && !item.technicalDoc;
  const canCert = isManager && category.supportsCalibration && item.hasCalibration && !item.calibrationCertificate;

  async function uploadDoc(kind: EquipmentDocumentKind, file: File | undefined) {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showToast('O documento deve ser um arquivo PDF.', 'error');
      return;
    }
    try {
      const upload = {
        fileName: file.name,
        mimeType: 'application/pdf',
        dataUrl: await fileToDataUrl(file)
      };
      const payload = kind === 'tech' ? { technicalDoc: upload } : { calibrationCertificate: upload };
      updateEquipment.mutate(
        { id: item.id, payload },
        {
          onSuccess: () => showToast(kind === 'tech' ? 'Documentação técnica enviada.' : 'Certificado de calibração enviado.', 'success'),
          onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível enviar o documento.', 'error')
        }
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.', 'error');
    }
  }

  return { canTech, canCert, currentDoc, isUploading: updateEquipment.isPending, uploadDoc };
}
