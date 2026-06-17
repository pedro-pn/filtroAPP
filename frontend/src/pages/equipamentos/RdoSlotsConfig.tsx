import { useMemo } from 'react';

import type { EquipmentCategory, RdoEquipmentSlot } from '../../api/equipamentos';
import { useToast } from '../../components/ui/Toast';
import { useEquipamentoMutations, useRdoSlots } from '../../hooks/useEquipamentos';

interface Props {
  categories: EquipmentCategory[];
}

const serviceLabels: Record<string, string> = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  flushing: 'Flushing',
  filtragem: 'Filtragem'
};

export function RdoSlotsConfig({ categories }: Props) {
  const slotsQuery = useRdoSlots();
  const { updateSlot } = useEquipamentoMutations();
  const showToast = useToast();

  const slots = slotsQuery.data;
  const grouped = useMemo(() => {
    const map = new Map<string, RdoEquipmentSlot[]>();
    for (const slot of slots || []) {
      const list = map.get(slot.serviceType) || [];
      list.push(slot);
      map.set(slot.serviceType, list);
    }
    return Array.from(map.entries());
  }, [slots]);

  function handleChange(slotKey: string, value: string) {
    updateSlot.mutate(
      { slotKey, categoryId: value || null },
      {
        onSuccess: () => showToast('Vínculo atualizado.', 'success'),
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
      }
    );
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Vínculo com relatórios (RDO)</div>
      </div>
      <p className="rel-meta equip-slots-hint">
        Defina qual categoria de equipamento alimenta cada ponto do formulário de relatório.
        Assim é possível editar/renomear as categorias sem perder o vínculo com o RDO.
      </p>

      {slotsQuery.isLoading && <p className="rel-meta">Carregando…</p>}

      {grouped.map(([serviceType, slots]) => (
        <div className="equip-slots-group" key={serviceType}>
          <h4 className="equip-slots-service">{serviceLabels[serviceType] || serviceType}</h4>
          <div className="equip-slots-list">
            {(slots || []).map(slot => (
              <div className="equip-slot-row" key={slot.key}>
                <label htmlFor={`slot-${slot.key}`}>{slot.label.split('·').slice(1).join('·').trim() || slot.label}</label>
                <select
                  id={`slot-${slot.key}`}
                  value={slot.categoryId || ''}
                  disabled={updateSlot.isPending}
                  onChange={e => handleChange(slot.key, e.target.value)}
                >
                  <option value="">— Não usar —</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
