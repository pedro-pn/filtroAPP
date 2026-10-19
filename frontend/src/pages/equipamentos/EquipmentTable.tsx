import { useRef, type ChangeEvent } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { SortableTable } from '../../components/ui/SortableTable';
import { Badge, Button } from '../../components/ui/ds';
import { calibrationStatus, formatDate, statusLabel, statusTone } from './equipmentStatus';
import { useEquipmentDocumentUpload, type EquipmentDocumentKind } from './useEquipmentDocumentUpload';

export interface EquipmentTableActions {
  isManager: boolean;
  onEdit: (item: CompanyEquipment) => void;
  onRemove: (item: CompanyEquipment) => void;
  onOpenTechnical: (item: CompanyEquipment) => void;
  onOpenMaintenanceHistory: (item: CompanyEquipment) => void;
}

interface EquipmentRowProps extends EquipmentTableActions {
  category: EquipmentCategory;
  item: CompanyEquipment;
  showCategory?: boolean;
}

function EquipmentRow({ category, item, showCategory, isManager, onEdit, onRemove, onOpenTechnical, onOpenMaintenanceHistory }: EquipmentRowProps) {
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
      {showCategory && <td>{category.name}</td>}
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
            <div className="equip-category-table__tech-upload">
              <PdfDropzone
                appearance="design-system"
                id={`equip-technical-pdf-${item.id}`}
                label={`Enviar PDF técnico de ${item.code}`}
                onFile={file => void uploadDoc('tech', file || undefined)}
                disabled={isUploading}
                emptyText="Enviar PDF técnico"
                emptyHint="Clique ou arraste o PDF"
              />
            </div>
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
              <RemoveIconButton label={`Remover equipamento ${item.code}`} onClick={() => onRemove(item)} />
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function EquipmentTable({ categories, items, showCategory = false, ...actions }: EquipmentTableActions & {
  categories: EquipmentCategory[];
  items: CompanyEquipment[];
  showCategory?: boolean;
}) {
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const rows = items.flatMap(item => {
    const category = categoryById.get(item.categoryId);
    return category ? [{ item, category }] : [];
  });

  return (
    <div className={`equip-category-table-wrap${showCategory ? ' equip-all-equipment__table-wrap' : ''}`}>
      <SortableTable className={`equip-category-table${showCategory ? ' equip-all-equipment__table' : ''}`} sortValues={rows.map(({ item, category }) => [
        item.code, item.name,
        ...(showCategory ? [category.name] : []),
        item.hasCalibration ? statusLabel[calibrationStatus(item)] : 'Não se aplica',
        Number(Boolean(item.calibrationCertificate)) + Number(Boolean(item.technicalDoc || item.technicalDocGenerated))
      ])}>
        <caption className="fv-sr-only">{showCategory ? 'Todos os equipamentos' : `Equipamentos da categoria ${categories[0]?.name || ''}`}</caption>
        <colgroup>
          <col className="equip-category-table__col-code" />
          <col className="equip-category-table__col-name" />
          {showCategory && <col className="equip-category-table__col-category" />}
          <col className="equip-category-table__col-calibration" />
          <col className="equip-category-table__col-documents" />
          <col className="equip-category-table__col-actions" />
        </colgroup>
        <thead><tr>
          <th scope="col">Código</th><th scope="col">Equipamento</th>
          {showCategory && <th scope="col">Categoria</th>}
          <th scope="col">Calibração</th><th scope="col">Documentos</th><th scope="col">Ações</th>
        </tr></thead>
        <tbody>
          {rows.map(({ item, category }) => <EquipmentRow key={item.id} item={item} category={category} showCategory={showCategory} {...actions} />)}
          {rows.length === 0 && <tr><td colSpan={showCategory ? 6 : 5} className="rel-meta">Nenhum equipamento encontrado.</td></tr>}
        </tbody>
      </SortableTable>
    </div>
  );
}
