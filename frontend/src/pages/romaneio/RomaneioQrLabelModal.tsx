import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { RomaneioCatalogItem } from '../../api/romaneio';
import { Modal } from '../../components/ui/Modal';
import {
  buildRomaneioItemQrValue,
  paginateRomaneioQrLabels,
  ROMANEIO_QR_LABEL_SHEET,
  ROMANEIO_QR_LABEL_SIZES,
  type RomaneioQrLabelSizeId
} from '../../utils/romaneioQr';
import {
  buildRomaneioQrLabelArtStyles,
  buildRomaneioQrLabelSizeStyles,
  fitRomaneioQrLabelText,
  trimRomaneioQrSvgQuietZone
} from './romaneioQrLabelArt';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const brandLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_COLORIDO.png`;

const labelSizeOptions = ROMANEIO_QR_LABEL_SIZES;
const labelCaption = 'Identificação de equipamento';

const previewLabelStyles = `${buildRomaneioQrLabelArtStyles()}${buildRomaneioQrLabelSizeStyles(labelSizeOptions, 'preview')}`;

function formatMillimeters(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

interface RomaneioQrLabelProps {
  item: RomaneioCatalogItem;
  qrSvgMarkup: string;
  sizeId: RomaneioQrLabelSizeId;
  ariaLabel: string;
}

function RomaneioQrLabelPreview({ item, qrSvgMarkup, sizeId, ariaLabel }: RomaneioQrLabelProps) {
  const labelRef = useRef<HTMLElement>(null);
  const uppercaseName = item.name.toLocaleUpperCase('pt-BR');

  useLayoutEffect(() => {
    const label = labelRef.current;
    if (!label) return;

    const fit = () => fitRomaneioQrLabelText(label);
    fit();
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(label);
    return () => resizeObserver.disconnect();
  }, [item.code, uppercaseName, qrSvgMarkup]);

  return (
    <article className="romaneio-qr-label" data-label-size={sizeId} ref={labelRef} aria-label={ariaLabel}>
      <div className="romaneio-qr-label-content">
        <div className="romaneio-qr-label-qr" dangerouslySetInnerHTML={{ __html: qrSvgMarkup }} />
        <div className="romaneio-qr-label-divider" />
        <div className="romaneio-qr-label-details">
          <img className="romaneio-qr-label-logo" src={brandLogoUrl} alt="Filtrovali" />
          <div className="romaneio-qr-label-identity">
            <span className="romaneio-qr-label-caption">{labelCaption}</span>
            {item.code ? (
              <span className="romaneio-qr-label-code" title={item.code}>
                <span className="romaneio-qr-label-fit">{item.code}</span>
              </span>
            ) : null}
          </div>
          <strong className="romaneio-qr-label-name" title={uppercaseName}>
            <span className="romaneio-qr-label-fit">{uppercaseName}</span>
          </strong>
        </div>
      </div>
    </article>
  );
}

interface RomaneioQrLabelModalProps {
  items: RomaneioCatalogItem[];
  categoryName?: string;
  onClose: () => void;
}

export function RomaneioQrLabelModal({ items, categoryName, onClose }: RomaneioQrLabelModalProps) {
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [qrSvgMarkupByItemId, setQrSvgMarkupByItemId] = useState<Record<string, string>>({});
  const [selectedLabelSizes, setSelectedLabelSizes] = useState<RomaneioQrLabelSizeId[]>(['large']);

  useEffect(() => {
    if (items.length === 0) return;

    let disposed = false;
    setQrSvgMarkupByItemId({});
    setIsGenerating(true);
    void import('@zxing/browser').then(({ BrowserQRCodeSvgWriter }) => {
      if (disposed) return;
      const writer = new BrowserQRCodeSvgWriter();
      const markups = Object.fromEntries(items.map(item => {
        const value = buildRomaneioItemQrValue(item.id);
        const qrCode = trimRomaneioQrSvgQuietZone(writer.write(value, 320, 320));
        qrCode.setAttribute('role', 'img');
        qrCode.setAttribute('aria-label', `QR code de ${item.name}`);
        return [item.id, qrCode.outerHTML];
      }));
      setQrSvgMarkupByItemId(markups);
      setError('');
      setIsGenerating(false);
    }).catch(() => {
      if (disposed) return;
      setQrSvgMarkupByItemId({});
      setError('Não foi possível gerar os QR codes selecionados.');
      setIsGenerating(false);
    });

    return () => {
      disposed = true;
    };
  }, [items]);

  const selectedSizeOptions = labelSizeOptions.filter(option => selectedLabelSizes.includes(option.id));
  const labelPages = paginateRomaneioQrLabels(items, selectedLabelSizes);
  const totalLabels = items.length * selectedSizeOptions.length;
  const firstPreviewPage = labelPages[0];
  const isBatch = Boolean(categoryName);
  const isReady = items.length > 0 && Object.keys(qrSvgMarkupByItemId).length === items.length;

  function toggleLabelSize(size: RomaneioQrLabelSizeId) {
    setSelectedLabelSizes(current => {
      const isSelected = current.includes(size);
      if (isSelected && current.length === 1) return current;
      const next = isSelected ? current.filter(value => value !== size) : [...current, size];
      return labelSizeOptions.filter(option => next.includes(option.id)).map(option => option.id);
    });
  }

  function printLabel() {
    if (!isReady || selectedSizeOptions.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=900,height=900');
    if (!printWindow) {
      setError('O navegador bloqueou a impressão. Permita pop-ups e tente novamente.');
      return;
    }

    const { document } = printWindow;
    document.title = '​';
    const sheet = ROMANEIO_QR_LABEL_SHEET;
    const style = document.createElement('style');
    style.textContent = `
      @page { size: A4 portrait; margin: 0; }
      html, body { width: ${sheet.widthMillimeters}mm; height: ${sheet.heightMillimeters}mm; margin: 0; }
      body {
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .romaneio-qr-sheet {
        box-sizing: border-box;
        width: ${sheet.widthMillimeters}mm;
        height: ${sheet.heightMillimeters}mm;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        gap: ${sheet.gapMillimeters}mm;
        padding: ${sheet.marginMillimeters}mm;
        break-after: page;
        page-break-after: always;
      }
      .romaneio-qr-sheet:last-child { break-after: auto; page-break-after: auto; }
      .romaneio-qr-sheet-row {
        display: flex;
        flex: 0 0 auto;
        align-items: flex-start;
        justify-content: center;
        gap: ${sheet.gapMillimeters}mm;
      }
      ${buildRomaneioQrLabelArtStyles()}
      ${buildRomaneioQrLabelSizeStyles(selectedSizeOptions, 'print')}
    `;
    document.head.append(style);

    const logos: HTMLImageElement[] = [];
    const labels: HTMLElement[] = [];

    labelPages.forEach(page => {
      const sheetElement = document.createElement('main');
      sheetElement.className = 'romaneio-qr-sheet';

      page.rows.forEach(row => {
        const labelRow = document.createElement('div');
        labelRow.className = 'romaneio-qr-sheet-row';

        row.entries.forEach(({ item, size }) => {
          const qrSvgMarkup = qrSvgMarkupByItemId[item.id];
          if (!qrSvgMarkup) return;

          const label = document.createElement('article');
          label.className = 'romaneio-qr-label';
          label.dataset.labelSize = size.id;

          const content = document.createElement('div');
          content.className = 'romaneio-qr-label-content';

          const qrShell = document.createElement('div');
          qrShell.className = 'romaneio-qr-label-qr';
          qrShell.innerHTML = qrSvgMarkup;
          content.append(qrShell);

          const divider = document.createElement('div');
          divider.className = 'romaneio-qr-label-divider';
          content.append(divider);

          const details = document.createElement('div');
          details.className = 'romaneio-qr-label-details';

          const logo = document.createElement('img');
          logo.className = 'romaneio-qr-label-logo';
          logo.src = new URL(brandLogoUrl, window.location.href).href;
          logo.alt = 'Filtrovali';
          logos.push(logo);
          details.append(logo);

          const identity = document.createElement('div');
          identity.className = 'romaneio-qr-label-identity';
          const caption = document.createElement('span');
          caption.className = 'romaneio-qr-label-caption';
          caption.textContent = labelCaption;
          identity.append(caption);

          if (item.code) {
            const code = document.createElement('span');
            code.className = 'romaneio-qr-label-code';
            const codeText = document.createElement('span');
            codeText.className = 'romaneio-qr-label-fit';
            codeText.textContent = item.code;
            code.append(codeText);
            identity.append(code);
          }
          details.append(identity);

          const name = document.createElement('strong');
          name.className = 'romaneio-qr-label-name';
          const nameText = document.createElement('span');
          nameText.className = 'romaneio-qr-label-fit';
          nameText.textContent = item.name.toLocaleUpperCase('pt-BR');
          name.append(nameText);
          details.append(name);

          content.append(details);
          label.append(content);
          labelRow.append(label);
          labels.push(label);
        });

        sheetElement.append(labelRow);
      });

      document.body.append(sheetElement);
    });

    let printStarted = false;
    const startPrint = () => {
      if (printStarted) return;
      printStarted = true;
      labels.forEach(fitRomaneioQrLabelText);
      printWindow.focus();
      printWindow.print();
    };

    const pendingLogos = logos.filter(logo => !logo.complete);
    if (pendingLogos.length === 0) {
      window.setTimeout(startPrint, 100);
    } else {
      let pendingCount = pendingLogos.length;
      const handleLogoReady = () => {
        pendingCount -= 1;
        if (pendingCount === 0) startPrint();
      };
      pendingLogos.forEach(logo => {
        logo.addEventListener('load', handleLogoReady, { once: true });
        logo.addEventListener('error', handleLogoReady, { once: true });
      });
      window.setTimeout(startPrint, 1200);
    }
  }

  return (
    <Modal
      open={items.length > 0}
      onClose={onClose}
      ariaLabelledBy="romaneio-qr-label-title"
      ariaDescribedBy="romaneio-qr-label-description"
      panelClassName="modal-card romaneio-qr-label-modal"
    >
      <style dangerouslySetInnerHTML={{ __html: previewLabelStyles }} />
      <div className="romaneio-qr-label-modal-body">
        <div className="section-title" id="romaneio-qr-label-title">
          {isBatch ? `QR codes da categoria ${categoryName}` : 'QR code do equipamento'}
        </div>
        <p className="placeholder-copy" id="romaneio-qr-label-description">
          {isBatch
            ? `${items.length} equipamentos serão organizados automaticamente em folhas A4. Na impressão, escolha uma impressora ou Salvar como PDF.`
            : 'Imprima a etiqueta e cole-a no equipamento correspondente.'}
        </p>
        <fieldset className="romaneio-qr-label-size-fieldset">
          <legend>Tamanhos para imprimir</legend>
          <p>Selecione um ou mais tamanhos para compor a mesma folha A4.</p>
          <div className="romaneio-qr-label-size-options">
            {labelSizeOptions.map(option => {
              const isSelected = selectedLabelSizes.includes(option.id);
              return (
                <button
                  className={isSelected ? 'is-selected' : ''}
                  type="button"
                  key={option.id}
                  aria-pressed={isSelected}
                  title={isSelected && selectedLabelSizes.length === 1 ? 'Mantenha ao menos um tamanho selecionado.' : undefined}
                  onClick={() => toggleLabelSize(option.id)}
                >
                  <span className="romaneio-qr-label-size-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
                  <strong>{option.label}</strong>
                  <span>{formatMillimeters(option.widthMillimeters)} × {formatMillimeters(option.heightMillimeters)} mm</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {items.length > 0 ? (
          <div className="romaneio-qr-sheet-preview-section">
            <div className="romaneio-qr-sheet-preview-heading">
              <strong>{labelPages.length > 1 ? 'Prévia da primeira folha A4' : 'Prévia da folha A4'}</strong>
              <span>
                {totalLabels} {totalLabels === 1 ? 'etiqueta' : 'etiquetas'} · {labelPages.length} {labelPages.length === 1 ? 'página' : 'páginas'}
              </span>
            </div>
            <div
              className="romaneio-qr-sheet-preview"
              aria-live="polite"
              aria-label={`Pré-visualização da primeira folha A4 de um total de ${labelPages.length} ${labelPages.length === 1 ? 'página' : 'páginas'}`}
            >
              {isGenerating ? <span className="rel-meta">Gerando QR code...</span> : null}
              {isReady && firstPreviewPage ? (
                <div className="romaneio-qr-sheet-preview-rows">
                  {firstPreviewPage.rows.map((row, rowIndex) => (
                    <div className="romaneio-qr-sheet-preview-row" key={rowIndex}>
                      {row.entries.map(({ item, size }) => (
                        <RomaneioQrLabelPreview
                          key={`${item.id}-${size.id}`}
                          item={item}
                          sizeId={size.id}
                          qrSvgMarkup={qrSvgMarkupByItemId[item.id]}
                          ariaLabel={`Etiqueta de ${item.name}, tamanho ${size.label}, ${formatMillimeters(size.widthMillimeters)} por ${formatMillimeters(size.heightMillimeters)} milímetros`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>
      <div className="admin-form-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Fechar</button>
        <button
          className="primary-button"
          type="button"
          onClick={printLabel}
          disabled={Boolean(error) || isGenerating || !isReady}
        >
          {`Baixar / imprimir ${totalLabels} ${totalLabels === 1 ? 'etiqueta' : 'etiquetas'}`}
        </button>
      </div>
    </Modal>
  );
}
