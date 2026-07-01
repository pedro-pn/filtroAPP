import { useRef, useState, type DragEvent } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import { useEquipamentoMutations } from '../../hooks/useEquipamentos';
import { calibrationStatus, fileToDataUrl, formatDate, statusLabel } from './equipmentStatus';

interface Props {
  item: CompanyEquipment;
  category: EquipmentCategory;
  isManager: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onOpenTechnical?: () => void;
}

type DocKind = 'tech' | 'cert';

export function EquipmentCard({ item, category, isManager, onEdit, onRemove, onOpenTechnical }: Props) {
  const { updateEquipment } = useEquipamentoMutations();
  const showToast = useToast();
  const cardRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const status = calibrationStatus(item);
  // "Doc. técnica" serve sempre o datasheet gerado mais recente; cai para o PDF legado.
  const currentDoc = item.technicalDocGenerated || item.technicalDoc || null;
  // Tipos de documento que ainda podem ser adicionados arrastando para o card.
  const canTech = isManager && category.supportsTechnicalDoc && !item.technicalDoc;
  const canCert = isManager && category.supportsCalibration && item.hasCalibration && !item.calibrationCertificate;
  const droppable = canTech || canCert;

  async function uploadDoc(kind: DocKind, file: File | undefined) {
    setDragging(false);
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) { showToast('O documento deve ser um arquivo PDF.', 'error'); return; }
    try {
      const upload = { fileName: file.name, mimeType: 'application/pdf', dataUrl: await fileToDataUrl(file) };
      const payload = kind === 'tech' ? { technicalDoc: upload } : { calibrationCertificate: upload };
      updateEquipment.mutate({ id: item.id, payload }, {
        onSuccess: () => showToast(kind === 'tech' ? 'Documentação técnica enviada.' : 'Certificado de calibração enviado.', 'success'),
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível enviar o documento.', 'error')
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.', 'error');
    }
  }

  function zoneDrop(kind: DocKind) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void uploadDoc(kind, event.dataTransfer.files?.[0]);
    };
  }

  const dragHandlers = droppable && !updateEquipment.isPending ? {
    onDragOver: (event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!cardRef.current?.contains(event.relatedTarget as Node)) setDragging(false);
    }
  } : {};

  return (
    <article
      ref={cardRef}
      className={`report-card equip-card ${dragging ? 'equip-card-dragging' : ''}`}
      data-equip-card
      data-equip-item-id={item.id}
      {...dragHandlers}
    >
      {dragging && droppable && (
        <div className="equip-card-dropzones">
          {canTech && (
            <div className="equip-card-zone" onDragOver={event => event.preventDefault()} onDrop={zoneDrop('tech')}>
              <span>⤓ Documentação técnica</span>
            </div>
          )}
          {canCert && (
            <div className="equip-card-zone" onDragOver={event => event.preventDefault()} onDrop={zoneDrop('cert')}>
              <span>⤓ Certificado de calibração</span>
            </div>
          )}
        </div>
      )}

      <div className="equip-card-head">
        <strong>{item.code}</strong>
        {status !== 'none' && <span className={`equip-badge equip-badge-${status}`}>{statusLabel[status]}</span>}
      </div>
      <div className="equip-card-name">{item.name}</div>
      <dl className="equip-attrs">
        {category.fieldSchema.map(field => (
          <div key={field.key}>
            <dt>{field.label}</dt>
            <dd>{String(item.attributes?.[field.key] ?? '—') || '—'}</dd>
          </div>
        ))}
        {item.hasCalibration && (
          <>
            <div><dt>Calibração</dt><dd>{formatDate(item.calibratedAt)}</dd></div>
            <div><dt>Vencimento</dt><dd>{formatDate(item.expiresAt)}</dd></div>
          </>
        )}
      </dl>
      {(item.calibrationCertificate || currentDoc) && (
        <div className="equip-doc-list">
          {item.calibrationCertificate && (
            <div className="equip-doc">
              <span className="equip-doc-title">Certificado de calibração</span>
              <a className="mini-btn equip-doc-pdf" href={item.calibrationCertificate.publicUrl} target="_blank" rel="noreferrer" data-equip-cert-link>⤓ PDF</a>
            </div>
          )}
          {currentDoc && (
            <div className="equip-doc">
              <span className="equip-doc-title">Dados técnicos</span>
              <a className="mini-btn equip-doc-pdf" href={currentDoc.publicUrl} target="_blank" rel="noreferrer" data-equip-technical-doc-link>⤓ PDF</a>
            </div>
          )}
        </div>
      )}
      {(isManager || (category.technicalDocEnabled && onOpenTechnical)) && (
        <div className="report-card-actions">
          {category.technicalDocEnabled && onOpenTechnical && (
            <button className="mini-btn alt equip-technical-action" type="button" onClick={onOpenTechnical} title={isManager ? 'Editar dados técnicos' : 'Ver dados técnicos'} data-equip-technical-button>
              {isManager ? 'Dados' : 'Ver dados'}{item.technicalRevision > 0 ? ' ●' : ''}
            </button>
          )}
          {isManager && (
            <>
              <button className="mini-btn alt" type="button" onClick={onEdit} title="Editar cadastro">Cadastro</button>
              <button className="mini-btn danger" type="button" onClick={onRemove}>Remover</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
