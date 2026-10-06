import { useState } from 'react';

import rdoUrl from '../../../assets/report-models/RDO-modelo.pdf?url';
import rcpuUrl from '../../../assets/report-models/RCPU-modelo.pdf?url';
import rlqUrl from '../../../assets/report-models/RLQ-modelo.pdf?url';
import rtpUrl from '../../../assets/report-models/RTP-modelo.pdf?url';
import { Button } from '../../../components/ui/Button';
import { Button as DsButton } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import './QualityDocumentModels.css';

const QUALITY_DOCUMENT_MODELS = [
  { type: 'RDO', name: 'Relatório diário de obra', url: rdoUrl },
  { type: 'RCPU', name: 'Relatório de contagem de partículas e umidade', url: rcpuUrl },
  { type: 'RLQ', name: 'Relatório de limpeza química', url: rlqUrl },
  { type: 'RTP', name: 'Relatório de teste de pressão', url: rtpUrl }
] as const;

export function QualityDocumentModels() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="mini" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        Modelos
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        appearance="design-system"
        title="Modelos de documentos de qualidade"
        size="sm"
        fullscreenOnMobile={false}
        backdropClassName="quality-document-models-backdrop"
        footer={<DsButton onClick={() => setOpen(false)}>Fechar</DsButton>}
      >
        <p className="quality-document-models-description">Exemplos preenchidos com dados fictícios para enviar ao cliente e avaliar a adequação dos modelos.</p>
        <ul className="quality-document-models-list">
          {QUALITY_DOCUMENT_MODELS.map(model => (
            <li key={model.type}>
              <div><strong>{model.type}</strong><span>{model.name}</span></div>
              <a
                className="fv-button fv-button--secondary fv-button--sm"
                href={model.url}
                download={`${model.type}-modelo.pdf`}
                aria-label={`Baixar modelo ${model.type} em PDF`}
              >
                <span className="fv-button__label">Baixar PDF</span>
              </a>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
