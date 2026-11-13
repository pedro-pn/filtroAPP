import type { EquipmentCategory, EquipmentTechnicalStandard, MeasurementDimension, TechnicalStandardPayload } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import { useEquipamentoMutations } from '../../hooks/useEquipamentos';
import { StandardForm } from './TechnicalStandardsManager';

interface Props {
  category: EquipmentCategory;
  standards: EquipmentTechnicalStandard[];
  unitsCatalog: MeasurementDimension[];
  onClose: () => void;
}

/**
 * Modelo de dados técnicos aberto direto da categoria: edita o padrão vinculado a ela ou, se ainda
 * não houver, cria um (a partir dos campos atuais) e já o vincula à categoria.
 */
export function CategoryTechnicalModelModal({ category, standards, unitsCatalog, onClose }: Props) {
  const mutations = useEquipamentoMutations();
  const showToast = useToast();
  const standard = category.technicalStandardId ? standards.find(item => item.id === category.technicalStandardId) || null : null;
  const saving = mutations.createStandard.isPending || mutations.updateStandard.isPending || mutations.updateCategory.isPending;
  const onError = (error: unknown) => showToast(error instanceof Error ? error.message : 'Não foi possível salvar o modelo.', 'error');

  function submit(payload: TechnicalStandardPayload) {
    if (standard) {
      mutations.updateStandard.mutate({ id: standard.id, payload }, {
        onSuccess: () => { showToast('Modelo de dados técnicos salvo. Os equipamentos vinculados foram atualizados.', 'success'); onClose(); },
        onError
      });
      return;
    }
    mutations.createStandard.mutate(payload, {
      onSuccess: created => {
        mutations.updateCategory.mutate(
          { id: category.id, payload: { name: category.name, technicalStandardId: created.id, technicalDocEnabled: true } },
          { onSuccess: () => { showToast('Modelo de dados técnicos criado e vinculado à categoria.', 'success'); onClose(); }, onError }
        );
      },
      onError
    });
  }

  return (
    <StandardForm
      standard={standard}
      seedName={category.name}
      seedFields={category.technicalSchema}
      unitsCatalog={unitsCatalog}
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
    />
  );
}
