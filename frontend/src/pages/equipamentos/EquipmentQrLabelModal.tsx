import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import type { RomaneioCatalogItem } from '../../api/romaneio';
import { RomaneioQrLabelModal } from '../romaneio/RomaneioQrLabelModal';
// A prévia e a folha de etiquetas usam o estilo do módulo Romaneio.
import '../romaneio/RomaneioPage.ds.css';

interface Props {
  equipment: CompanyEquipment;
  category: EquipmentCategory;
  onClose: () => void;
}

/**
 * QR code do equipamento: é o MESMO da etiqueta do Romaneio (codifica o item de catálogo sincronizado),
 * então a etiqueta impressa aqui é lida normalmente pelo leitor do Romaneio.
 */
export default function EquipmentQrLabelModal({ equipment, category, onClose }: Props) {
  const catalogItemId = equipment.romaneioCatalogItemId;
  if (!catalogItemId) return null;
  const item: RomaneioCatalogItem = {
    id: catalogItemId,
    sourceType: 'EQUIPAMENTOS',
    sourceId: equipment.id,
    code: equipment.code,
    name: equipment.name,
    categoryName: category.name,
    kind: 'EQUIPMENT',
    measureType: 'UNIT',
    defaultUnitLabel: 'unidade',
    isSerialized: true,
    isActive: true,
    createdAt: '',
    updatedAt: ''
  };
  return <RomaneioQrLabelModal items={[item]} onClose={onClose} />;
}
