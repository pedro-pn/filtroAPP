import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { functioningChecklistDownloadPath, saveFunctioningChecklist, type CompanyEquipment, type EquipmentCategory, type FunctioningChecklistTemplate } from '../../api/equipamentos';
import { downloadQrDocument } from '../../api/equipmentQrPage';
import { Modal } from '../../components/ui/Modal';
import { Alert, Button } from '../../components/ui/ds';
import { FunctioningChecklistEditor } from './FunctioningChecklistEditor';

function ChecklistModal({ item, category, isManager, onClose }: {
  item: CompanyEquipment; category: EquipmentCategory; isManager: boolean; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const categoryTemplate = category.functioningChecklist || { format: 'MONTHLY' as const, items: [] };
  const [hasOverride, setHasOverride] = useState(item.functioningChecklist != null);
  const [template, setTemplate] = useState<FunctioningChecklistTemplate>(item.functioningChecklist ?? categoryTemplate);
  const [saved, setSaved] = useState(JSON.stringify(item.functioningChecklist ?? null));
  const [downloadError, setDownloadError] = useState('');
  const changed = JSON.stringify(hasOverride ? template : null) !== saved;
  const hasDocument = template.format === 'INSPECTION' || template.items.some(item => item.trim());
  const invalidLabels = template.format === 'INSPECTION' && template.responsibleLabels?.some(label => !label.trim());
  const save = useMutation({
    mutationFn: () => saveFunctioningChecklist(item.id, hasOverride ? { ...template, items: template.items.map(item => item.trim()).filter(Boolean) } : null),
    onSuccess: async equipment => {
      setSaved(JSON.stringify(equipment.functioningChecklist ?? null));
      setTemplate(equipment.functioningChecklist ?? categoryTemplate);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['equipamentos'] }),
        queryClient.invalidateQueries({ queryKey: ['equipment-qr-page'] }),
        queryClient.invalidateQueries({ queryKey: ['equipamentos', 'qr-link', item.id] })
      ]);
    }
  });
  const download = useMutation({
    mutationFn: async (format: 'pdf' | 'xlsx') => {
      setDownloadError('');
      await downloadQrDocument(functioningChecklistDownloadPath(item.id, format), `Checklist de funcionamento - ${item.code}.${format}`);
    },
    onError: () => setDownloadError('Não foi possível baixar o checklist. Tente novamente.')
  });
  return <Modal open onClose={() => { if (!save.isPending) onClose(); }} appearance="design-system" size="lg" title="Checklist de funcionamento"
    panelClassName="equip-entity-modal" showCloseButton={!save.isPending} closeOnBackdrop={false}
    footer={<>
      <Button variant="secondary" size="sm" onClick={onClose} disabled={save.isPending}>Fechar</Button>
      {isManager && <Button variant="primary" size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!changed || invalidLabels}>Salvar modelo</Button>}
    </>}>
    <p className="equip-entity-subtitle">{item.code} — {item.name}</p>
    <div className="equip-form">
      <div className="admin-toolbar">
        <p className="rel-meta">{hasOverride ? 'Modelo próprio deste equipamento' : `Herdado da categoria ${category.name}`}</p>
        {isManager && <Button variant="secondary" size="sm" disabled={!hasOverride || save.isPending} onClick={() => { setHasOverride(false); setTemplate(categoryTemplate); }}>Usar modelo da categoria</Button>}
      </div>
      <FunctioningChecklistEditor value={template} disabled={!isManager || save.isPending} onChange={value => { setHasOverride(true); setTemplate(value); }} />
      <p className="form-hint">Imprima para preencher em campo. O PDF disponível no QR Code acompanha o modelo salvo. A planilha no QR Code exige login de colaborador.</p>
      <div className="admin-toolbar">
        <Button variant="secondary" size="sm" disabled={changed || !hasDocument || save.isPending} loading={download.isPending && download.variables === 'pdf'} onClick={() => download.mutate('pdf')}>Baixar PDF</Button>
        <Button variant="secondary" size="sm" disabled={changed || !hasDocument || save.isPending} loading={download.isPending && download.variables === 'xlsx'} onClick={() => download.mutate('xlsx')}>Baixar XLSX</Button>
      </div>
      {changed && <p className="rel-meta">Salve as alterações antes de baixar o documento atualizado.</p>}
      {!hasDocument && <Alert tone="info">Cadastre os pontos no modelo da categoria ou neste equipamento para disponibilizar o documento.</Alert>}
      {invalidLabels && <Alert tone="warning">Preencha a identificação dos quatro responsáveis.</Alert>}
      {save.isError && <Alert tone="danger">Não foi possível salvar o modelo. Tente novamente.</Alert>}
      {downloadError && <Alert tone="danger">{downloadError}</Alert>}
    </div>
  </Modal>;
}

export function FunctioningChecklist({ item, category, isManager }: { item: CompanyEquipment; category: EquipmentCategory; isManager: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="secondary" size="sm" multiline onClick={() => setOpen(true)}>Checklist de funcionamento</Button>
    {open && <ChecklistModal item={item} category={category} isManager={isManager} onClose={() => setOpen(false)} />}
  </>;
}
