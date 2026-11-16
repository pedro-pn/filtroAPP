import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getQrLink, saveQrAccess, type CompanyEquipment, type EquipmentCategory, type QrAccessMode } from '../../api/equipamentos';
import type { RomaneioCatalogItem } from '../../api/romaneio';
import { useToast } from '../../components/ui/ToastContext';
import { Button } from '../../components/ui/ds';
import { RomaneioQrLabelModal } from '../romaneio/RomaneioQrLabelModal';
// A prévia e a folha de etiquetas usam o estilo do módulo Romaneio.
import '../romaneio/RomaneioPage.ds.css';

interface Props {
  equipment: CompanyEquipment;
  category: EquipmentCategory;
  isManager: boolean;
  onClose: () => void;
}

const accessLabels: Record<QrAccessMode, string> = {
  PUBLIC: 'Público',
  LOGIN: 'Exigir login para baixar',
  HIDDEN: 'Ocultar do link'
};

/** Acesso a cada documento na página aberta pelo QR code (o gestor escolhe; os demais só consultam). */
function QrAccessPanel({ equipment, isManager }: { equipment: CompanyEquipment; isManager: boolean }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const query = useQuery({ queryKey: ['equipamentos', 'qr-link', equipment.id], queryFn: () => getQrLink(equipment.id) });
  const [draft, setDraft] = useState<Record<string, QrAccessMode>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(Object.fromEntries(query.data.documents.map(doc => [doc.key, doc.access])));
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => saveQrAccess(equipment.id, draft),
    onSuccess: data => {
      queryClient.setQueryData(['equipamentos', 'qr-link', equipment.id], data);
      showToast('Acesso aos documentos do link salvo.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const settings = query.data;
  if (!settings?.qrUrl) return null;
  const changed = settings.documents.some(doc => (draft[doc.key] ?? doc.access) !== doc.access);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(settings?.qrUrl || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Não foi possível copiar. Selecione o link e copie manualmente.', 'error');
    }
  }

  return (
    <section className="equip-qr-access" data-equip-qr-access aria-label="Link e documentos do QR code">
      <div className="sec">Página do QR code</div>
      <p className="rel-meta">O QR code abre esta página, sem login. Ela continua valendo se o equipamento ainda não tiver documentos: quando forem adicionados, aparecem no mesmo link.</p>
      <div className="equip-qr-access__link">
        <input type="text" readOnly value={settings.qrUrl} aria-label="Link da página do QR code" onFocus={event => event.currentTarget.select()} />
        <Button size="sm" variant="secondary" onClick={() => void copyLink()}>{copied ? 'Copiado' : 'Copiar link'}</Button>
        <a className="fv-button fv-button--secondary fv-button--sm" href={settings.qrUrl} target="_blank" rel="noreferrer">Abrir página</a>
      </div>
      {settings.documents.length === 0 ? (
        <p className="rel-meta">Este equipamento ainda não tem documentos: a página aparece vazia.</p>
      ) : (
        <ul className="equip-qr-access__docs">
          {settings.documents.map(doc => (
            <li key={doc.key}>
              <div>
                <strong>{doc.label}</strong>
                {doc.fileName !== doc.label ? <span>{doc.fileName}</span> : null}
              </div>
              {isManager ? (
                <select
                  value={draft[doc.key] ?? doc.access}
                  aria-label={`Acesso a ${doc.label}`}
                  onChange={event => setDraft(current => ({ ...current, [doc.key]: event.target.value as QrAccessMode }))}
                >
                  {(Object.keys(accessLabels) as QrAccessMode[]).map(mode => <option key={mode} value={mode}>{accessLabels[mode]}</option>)}
                </select>
              ) : (
                <span className="equip-qr-access__mode">{accessLabels[doc.access]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isManager && settings.documents.length > 0 ? (
        <div className="equip-qr-access__actions">
          <Button size="sm" variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()} data-equip-qr-access-save>Salvar acesso</Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * QR code do equipamento: é o MESMO da etiqueta do Romaneio. Ele abre a página pública do equipamento e
 * continua sendo lido pelo leitor do Romaneio (que adiciona o item ao romaneio).
 */
export default function EquipmentQrLabelModal({ equipment, category, isManager, onClose }: Props) {
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
    qrUrl: equipment.romaneioQrUrl || undefined,
    createdAt: '',
    updatedAt: ''
  };
  return <RomaneioQrLabelModal items={[item]} onClose={onClose} extraContent={<QrAccessPanel equipment={equipment} isManager={isManager} />} />;
}
