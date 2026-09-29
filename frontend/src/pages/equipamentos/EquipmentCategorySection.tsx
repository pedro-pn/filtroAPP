import { useRef, type ChangeEvent } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { Badge, Button } from '../../components/ui/ds';
import { useListingMobileViewport } from '../../components/ui/ds/listings/useListingMedia';
import { EquipmentCard } from './EquipmentCard';
import { calibrationStatus, formatDate, statusLabel, statusTone } from './equipmentStatus';
import { useEquipmentDocumentUpload, type EquipmentDocumentKind } from './useEquipmentDocumentUpload';

interface EquipmentCategorySectionProps {
  category: EquipmentCategory;
  items: CompanyEquipment[];
  total: number;
  isManager: boolean;
  onAdd: () => void;
  onEdit: (item: CompanyEquipment) => void;
  onRemove: (item: CompanyEquipment) => void;
  onOpenTechnical: (item: CompanyEquipment) => void;
  onOpenMaintenanceHistory: (item: CompanyEquipment) => void;
}

interface EquipmentRowProps extends Omit<EquipmentCategorySectionProps, 'items' | 'total' | 'onAdd'> {
  item: CompanyEquipment;
}

function EquipmentRow({ category, item, isManager, onEdit, onRemove, onOpenTechnical, onOpenMaintenanceHistory }: EquipmentRowProps) {
  const techInput = useRef<HTMLInputElement>(null);
  const certInput = useRef<HTMLInputElement>(null);
  const { canTech, canCert, currentDoc, isUploading, uploadDoc } = useEquipmentDocumentUpload(item, category, isManager);
  const status = calibrationStatus(item);

  function handleFile(kind: EquipmentDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    void uploadDoc(kind, file);
  }

  return (
    <tr data-equip-item-id={item.id}>
      <td><strong className="equip-category-table__code">{item.code}</strong></td>
      <td>
        <strong className="equip-category-table__name">{item.name}</strong>
        {category.fieldSchema.length > 0 ? (
          <dl className="equip-category-table__attributes">
            {category.fieldSchema.map(field => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{String(item.attributes?.[field.key] ?? '—') || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </td>
      <td>
        {item.hasCalibration ? (
          <div className="equip-category-table__calibration">
            <Badge tone={statusTone[status]} dot multiline>
              {status === 'none' ? 'Sem calibração' : statusLabel[status]}
            </Badge>
            <span>Calibrado: {formatDate(item.calibratedAt)}</span>
            <span>Vence: {formatDate(item.expiresAt)}</span>
          </div>
        ) : <span className="equip-category-table__muted">Não se aplica</span>}
      </td>
      <td>
        <div className="equip-category-table__documents">
          {item.calibrationCertificate ? (
            <a className="fv-button fv-button--secondary fv-button--sm equip-category-table__doc-link" href={item.calibrationCertificate.publicUrl} target="_blank" rel="noreferrer" data-equip-cert-link>
              Certificado PDF
            </a>
          ) : null}
          {currentDoc ? (
            <a className="fv-button fv-button--secondary fv-button--sm equip-category-table__doc-link" href={currentDoc.publicUrl} target="_blank" rel="noreferrer" data-equip-technical-doc-link>
              Dados técnicos PDF
            </a>
          ) : null}
          {canCert ? (
            <>
              <input ref={certInput} type="file" accept="application/pdf,.pdf" hidden aria-label={`Selecionar certificado de ${item.code}`} onChange={event => handleFile('cert', event)} />
              <Button size="sm" multiline variant="ghost" disabled={isUploading} onClick={() => certInput.current?.click()}>Enviar certificado</Button>
            </>
          ) : null}
          {canTech ? (
            <>
              <input ref={techInput} type="file" accept="application/pdf,.pdf" hidden aria-label={`Selecionar documento técnico de ${item.code}`} onChange={event => handleFile('tech', event)} />
              <Button size="sm" multiline variant="ghost" disabled={isUploading} onClick={() => techInput.current?.click()}>Enviar PDF técnico</Button>
            </>
          ) : null}
          {!item.calibrationCertificate && !currentDoc && !canCert && !canTech ? <span className="equip-category-table__muted">Nenhum documento</span> : null}
        </div>
      </td>
      <td>
        <div className="equip-category-table__actions">
          <Button size="sm" multiline variant="secondary" onClick={() => onOpenMaintenanceHistory(item)}>Manutenções</Button>
          {category.technicalDocEnabled ? (
            <Button size="sm" multiline variant="secondary" onClick={() => onOpenTechnical(item)} title={isManager ? 'Editar dados técnicos' : 'Ver dados técnicos'} data-equip-technical-button>
              {isManager ? 'Dados' : 'Ver dados'}{item.technicalRevision > 0 ? ' ●' : ''}
            </Button>
          ) : null}
          {isManager ? (
            <>
              <Button size="sm" multiline variant="secondary" onClick={() => onEdit(item)} title="Editar cadastro">Cadastro</Button>
              <Button size="sm" multiline variant="danger" onClick={() => onRemove(item)}>Remover</Button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function EquipmentCategorySection({ category, items, total, isManager, onAdd, onEdit, onRemove, onOpenTechnical, onOpenMaintenanceHistory }: EquipmentCategorySectionProps) {
  const compact = useListingMobileViewport('lg');

  return (
    <section className="page-card equip-category-section" data-equip-category-section data-equip-category-id={category.id}>
      <div className="equip-category-section__header">
        <div>
          <h2>{category.name}</h2>
          <p>{items.length === total ? `${total} equipamento${total === 1 ? '' : 's'}` : `${items.length} de ${total} equipamentos`}</p>
        </div>
        {isManager ? <Button size="sm" variant="primary" onClick={onAdd}>+ Novo equipamento</Button> : null}
      </div>

      {items.length === 0 ? (
        <p className="equip-category-section__empty">Nenhum equipamento nesta categoria.</p>
      ) : compact ? (
        <div className="equip-grid">
          {items.map(item => (
            <EquipmentCard
              key={item.id}
              item={item}
              category={category}
              isManager={isManager}
              onEdit={() => onEdit(item)}
              onRemove={() => onRemove(item)}
              onOpenTechnical={() => onOpenTechnical(item)}
              onOpenMaintenanceHistory={() => onOpenMaintenanceHistory(item)}
            />
          ))}
        </div>
      ) : (
        <div className="equip-category-table-wrap">
          <table className="equip-category-table">
            <caption className="fv-sr-only">Equipamentos da categoria {category.name}</caption>
            <colgroup><col className="equip-category-table__col-code" /><col className="equip-category-table__col-name" /><col className="equip-category-table__col-calibration" /><col className="equip-category-table__col-documents" /><col className="equip-category-table__col-actions" /></colgroup>
            <thead><tr><th scope="col">Código</th><th scope="col">Equipamento</th><th scope="col">Calibração</th><th scope="col">Documentos</th><th scope="col">Ações</th></tr></thead>
            <tbody>
              {items.map(item => (
                <EquipmentRow
                  key={item.id}
                  category={category}
                  item={item}
                  isManager={isManager}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  onOpenTechnical={onOpenTechnical}
                  onOpenMaintenanceHistory={onOpenMaintenanceHistory}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
