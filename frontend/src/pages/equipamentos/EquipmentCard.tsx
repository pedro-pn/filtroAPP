import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { Badge, Button } from '../../components/ui/ds';
import { calibrationStatus, formatDate, statusLabel, statusTone } from './equipmentStatus';
import { useEquipmentDocumentUpload, type EquipmentDocumentKind } from './useEquipmentDocumentUpload';

interface Props {
  item: CompanyEquipment;
  category: EquipmentCategory;
  isManager: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onOpenTechnical?: () => void;
  onOpenMaintenanceHistory?: () => void;
}

export function EquipmentCard({ item, category, isManager, onEdit, onRemove, onOpenTechnical, onOpenMaintenanceHistory }: Props) {
  const cardRef = useRef<HTMLElement | null>(null);
  const techInput = useRef<HTMLInputElement>(null);
  const certInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const status = calibrationStatus(item);
  const { canTech, canCert, currentDoc, isUploading, uploadDoc } = useEquipmentDocumentUpload(item, category, isManager);
  const droppable = canTech || canCert;

  function handleFile(kind: EquipmentDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    void uploadDoc(kind, file);
  }

  function zoneDrop(kind: EquipmentDocumentKind) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      void uploadDoc(kind, event.dataTransfer.files?.[0]);
    };
  }

  const dragHandlers =
    droppable && !isUploading
      ? {
          onDragOver: (event: DragEvent<HTMLElement>) => {
            event.preventDefault();
            setDragging(true);
          },
          onDragLeave: (event: DragEvent<HTMLElement>) => {
            if (!cardRef.current?.contains(event.relatedTarget as Node)) setDragging(false);
          }
        }
      : {};

  return (
    <article ref={cardRef} className={`report-card equip-card ${dragging ? 'equip-card-dragging' : ''}`} data-equip-card data-equip-item-id={item.id} {...dragHandlers}>
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
        {status !== 'none' && <Badge tone={statusTone[status]} dot multiline>{statusLabel[status]}</Badge>}
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
            <div>
              <dt>Calibração</dt>
              <dd>{formatDate(item.calibratedAt)}</dd>
            </div>
            <div>
              <dt>Vencimento</dt>
              <dd>{formatDate(item.expiresAt)}</dd>
            </div>
          </>
        )}
      </dl>
      {(item.calibrationCertificate || currentDoc) && (
        <div className="equip-doc-list">
          {item.calibrationCertificate && (
            <div className="equip-doc">
              <span className="equip-doc-title">Certificado de calibração</span>
              <a className="fv-button fv-button--secondary fv-button--sm equip-doc-link" href={item.calibrationCertificate.publicUrl} target="_blank" rel="noreferrer" aria-label={`Abrir certificado de calibração de ${item.code}`} data-equip-cert-link>
                Abrir PDF
              </a>
            </div>
          )}
          {currentDoc && (
            <div className="equip-doc">
              <span className="equip-doc-title">Dados técnicos</span>
              <a className="fv-button fv-button--secondary fv-button--sm equip-doc-link" href={currentDoc.publicUrl} target="_blank" rel="noreferrer" aria-label={`Abrir dados técnicos de ${item.code}`} data-equip-technical-doc-link>
                Abrir PDF
              </a>
            </div>
          )}
        </div>
      )}
      {(canTech || canCert) && (
        <div className="equip-card-uploads">
          {canCert && (
            <>
              <input ref={certInput} type="file" accept="application/pdf,.pdf" hidden aria-label={`Selecionar certificado de ${item.code}`} onChange={event => handleFile('cert', event)} />
              <Button size="sm" multiline variant="secondary" disabled={isUploading} onClick={() => certInput.current?.click()}>Enviar certificado</Button>
            </>
          )}
          {canTech && (
            <>
              <input ref={techInput} type="file" accept="application/pdf,.pdf" hidden aria-label={`Selecionar documento técnico de ${item.code}`} onChange={event => handleFile('tech', event)} />
              <Button size="sm" multiline variant="secondary" disabled={isUploading} onClick={() => techInput.current?.click()}>Enviar PDF técnico</Button>
            </>
          )}
        </div>
      )}
      {(isManager || (category.technicalDocEnabled && onOpenTechnical) || onOpenMaintenanceHistory) && (
        <div className="report-card-actions">
          {onOpenMaintenanceHistory ? (
            <Button variant="secondary" size="sm" multiline className="equip-maintenance-action" onClick={onOpenMaintenanceHistory}>
              Manutenções
            </Button>
          ) : null}
          {category.technicalDocEnabled && onOpenTechnical && (
            <Button variant="secondary" size="sm" multiline className="equip-technical-action" onClick={onOpenTechnical} title={isManager ? 'Editar dados técnicos' : 'Ver dados técnicos'} data-equip-technical-button>
              {isManager ? 'Dados' : 'Ver dados'}
              {item.technicalRevision > 0 ? ' ●' : ''}
            </Button>
          )}
          {isManager && (
            <>
              <Button variant="secondary" size="sm" multiline onClick={onEdit} title="Editar cadastro">
                Cadastro
              </Button>
              <Button variant="danger" size="sm" multiline onClick={onRemove}>
                Remover
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
