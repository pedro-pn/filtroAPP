import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

import type { DatabookCampoDocumento } from '../../api/databook';
import { Alert, Button, Spinner } from '../ui/ds';

// O menu de Data Book pode abrir sem carregar ou inicializar o motor de PDF.
const DatabookPdfViewer = lazy(() => import('./DatabookPdfViewer').then(m => ({ default: m.DatabookPdfViewer })));

class DatabookPdfBoundary extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  render() {
    if (this.state.falhou) {
      return <Alert tone="warning" title="Não foi possível exibir o PDF nesta tela.">
        Use Abrir prévia em outra aba para conferir o documento ou reabra esta tela para tentar novamente.
      </Alert>;
    }
    return this.props.children;
  }
}

export function DatabookPreviaDocumento({ pdf, carregando, desatualizada, erro, campos, edicoes, disabled, onEditarCampo, onEdicaoAtiva, onTentarNovamente }: {
  pdf: Blob | null;
  carregando: boolean;
  desatualizada: boolean;
  erro?: string;
  campos: DatabookCampoDocumento[];
  edicoes: Record<string, string>;
  disabled: boolean;
  onEditarCampo: (id: string, valor: string) => void;
  onEdicaoAtiva: (id: string | null) => void;
  onTentarNovamente: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pdf) { setUrl(null); return; }
    const novaUrl = URL.createObjectURL(pdf);
    setUrl(novaUrl);
    return () => URL.revokeObjectURL(novaUrl);
  }, [pdf]);

  return (
    <section className="databook-previa__documento" aria-label="Prévia do documento">
      <h3>Prévia do PDF</h3>
      <p className="databook-dialog__ajuda">Clique no texto ou número e edite no próprio documento. Enter aplica; Shift+Enter quebra a linha; Esc cancela.</p>
      <div className="databook-previa__sincronizacao" role="status" aria-live="polite">
        {carregando ? (pdf ? 'Aplicando alterações ao documento…' : 'Preparando o documento…')
          : erro ? 'As alterações continuam neste rascunho.' : desatualizada ? 'As alterações serão aplicadas automaticamente ao sair do campo.' : 'Prévia atualizada.'}
      </div>
      {carregando && !pdf ? <Spinner label="Preparando a prévia do documento…" /> : null}
      {erro ? <Alert tone="danger" title="Não foi possível atualizar a prévia.">
        {erro} <Button variant="secondary" size="sm" type="button" onClick={onTentarNovamente}>Tentar novamente</Button>
      </Alert> : null}
      {url ? <>
        <a href={url} target="_blank" rel="noreferrer">Abrir prévia em outra aba</a>
        {pdf ? <DatabookPdfBoundary>
          <Suspense fallback={<Spinner label="Carregando visualizador do PDF…" />}>
            <div className="databook-previa__pdf"><DatabookPdfViewer blob={pdf} campos={campos} edicoes={edicoes}
              disabled={disabled} onEditarCampo={onEditarCampo} onEdicaoAtiva={onEdicaoAtiva} /></div>
          </Suspense>
        </DatabookPdfBoundary> : null}
      </> : !carregando && !erro ? <p>A prévia será exibida aqui automaticamente.</p> : null}
    </section>
  );
}
