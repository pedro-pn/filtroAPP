import { ROMANEIO_QR_LABEL_SHEET, type RomaneioQrLabelSize } from '../../utils/romaneioQr';

/**
 * Medidas da etiqueta extraídas da arte de referência (etiqueta grande: 967 × 333 px).
 * Todos os valores são percentuais da largura da etiqueta, porque a arte escala
 * linearmente entre os três tamanhos. Na folha de estilo cada valor vira
 * `calc(<valor> * var(--u))`, onde `--u` vale 1% da largura da etiqueta.
 */
export const ROMANEIO_QR_LABEL_ART = {
  green: '#30503a',
  hairline: 'rgba(48, 80, 58, 0.23)',
  aspectRatio: 2.9039,
  borderWidth: 0.31,
  borderRadius: 1.24,
  paddingLeft: 3.52,
  paddingRight: 7.08,
  qrSize: 27.09,
  qrQuietZone: 2.58,
  qrBorderWidth: 0.16,
  qrRadius: 1.35,
  dividerGap: 4.03,
  dividerWidth: 0.36,
  dividerHeight: 27.4,
  detailsGap: 4.34,
  detailsLift: 0.91,
  logoWidth: 28.02,
  captionOffset: 0.71,
  captionFont: 1.735,
  captionTracking: 0.08,
  codeOffset: 1.9,
  codeFont: 8.23,
  codePaddingY: 0.88,
  codePaddingX: 7.65,
  codeTracking: 0.1,
  nameOffset: 2.21,
  nameFont: 4.478,
  nameTracking: 0.042
} as const;

const art = ROMANEIO_QR_LABEL_ART;

/** Converte um percentual da largura da etiqueta em uma expressão CSS. */
function unit(value: number) {
  return `calc(${value} * var(--u))`;
}

/**
 * Regras da arte da etiqueta, idênticas na prévia e na impressão. O único
 * parâmetro que muda entre os dois contextos é `--u`.
 */
export function buildRomaneioQrLabelArtStyles() {
  return `
    .romaneio-qr-label {
      --romaneio-label-green: ${art.green};
      --romaneio-label-hairline: ${art.hairline};
      position: relative;
      margin: 0;
      color: var(--romaneio-label-green);
      font-family: Arial, Helvetica, sans-serif;
      text-align: left;
    }
    .romaneio-qr-label,
    .romaneio-qr-label * { box-sizing: border-box; }
    /*
     * A moldura fica no elemento interno porque, na prévia, a etiqueta é o
     * próprio container de consulta: unidades cqw aplicadas nela resolveriam
     * contra o ancestral, não contra a largura da etiqueta.
     */
    .romaneio-qr-label-content {
      width: 100%;
      height: 100%;
      overflow: hidden;
      display: flex;
      align-items: center;
      border: ${unit(art.borderWidth)} solid var(--romaneio-label-green);
      border-radius: ${unit(art.borderRadius)};
      background: #fff;
      padding: 0 ${unit(art.paddingRight)} 0 ${unit(art.paddingLeft)};
    }
    .romaneio-qr-label-qr {
      flex: 0 0 auto;
      width: ${unit(art.qrSize)};
      height: ${unit(art.qrSize)};
      padding: ${unit(art.qrQuietZone)};
      border: ${unit(art.qrBorderWidth)} solid var(--romaneio-label-hairline);
      border-radius: ${unit(art.qrRadius)};
      background: #fff;
    }
    .romaneio-qr-label-qr svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .romaneio-qr-label-divider {
      flex: 0 0 auto;
      width: ${unit(art.dividerWidth)};
      height: ${unit(art.dividerHeight)};
      margin-left: ${unit(art.dividerGap)};
      background: var(--romaneio-label-hairline);
    }
    .romaneio-qr-label-details {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      margin-left: ${unit(art.detailsGap)};
      padding-bottom: ${unit(art.detailsLift)};
    }
    .romaneio-qr-label-logo {
      display: block;
      width: ${unit(art.logoWidth)};
      max-width: 100%;
      height: auto;
    }
    .romaneio-qr-label-identity {
      width: fit-content;
      max-width: 100%;
      min-width: 0;
      margin-top: ${unit(art.captionOffset)};
    }
    .romaneio-qr-label-caption {
      display: block;
      width: 100%;
      font-size: ${unit(art.captionFont)};
      font-weight: 700;
      letter-spacing: ${art.captionTracking}em;
      line-height: 1;
      text-align: center;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .romaneio-qr-label-code {
      display: block;
      width: fit-content;
      max-width: 100%;
      margin-top: ${unit(art.codeOffset)};
      padding: ${unit(art.codePaddingY)} ${unit(art.codePaddingX)};
      border-radius: 999px;
      color: #fff;
      background: var(--romaneio-label-green);
      font-size: ${unit(art.codeFont)};
      font-weight: 700;
      line-height: 1;
      text-align: center;
      white-space: nowrap;
    }
    .romaneio-qr-label-name {
      display: block;
      max-width: 100%;
      margin-top: ${unit(art.nameOffset)};
      font-size: ${unit(art.nameFont)};
      font-weight: 700;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .romaneio-qr-label-fit {
      display: inline-block;
      transform-origin: left center;
      white-space: nowrap;
    }
    /*
     * O espaçamento entre letras fica no próprio texto ajustável: em herdado
     * vira comprimento absoluto no filho e deixaria de acompanhar a fonte
     * reduzida. A margem negativa descarta o espaço solto após a última letra,
     * mantendo a pílula simétrica.
     */
    .romaneio-qr-label-code .romaneio-qr-label-fit {
      letter-spacing: ${art.codeTracking}em;
      margin-right: -${art.codeTracking}em;
    }
    .romaneio-qr-label-name .romaneio-qr-label-fit {
      letter-spacing: ${art.nameTracking}em;
      margin-right: -${art.nameTracking}em;
    }
  `;
}

/**
 * Define `--u` e as dimensões de cada tamanho. Na impressão a etiqueta sai em
 * milímetros reais; na prévia ela ocupa a fração correspondente da folha A4.
 */
export function buildRomaneioQrLabelSizeStyles(
  sizes: readonly RomaneioQrLabelSize[],
  mode: 'print' | 'preview'
) {
  return sizes.map(size => {
    const selector = `.romaneio-qr-label[data-label-size="${size.id}"]`;
    if (mode === 'print') {
      return `
        ${selector} {
          --u: ${(size.widthMillimeters / 100).toFixed(4)}mm;
          width: ${size.widthMillimeters}mm;
          height: ${size.heightMillimeters}mm;
          flex: 0 0 ${size.widthMillimeters}mm;
        }
      `;
    }
    const sheetShare = size.widthMillimeters / ROMANEIO_QR_LABEL_SHEET.contentWidthMillimeters * 100;
    return `
      ${selector} {
        container-type: inline-size;
        --u: 1cqw;
        width: ${sheetShare.toFixed(3)}%;
        aspect-ratio: ${size.widthMillimeters} / ${size.heightMillimeters};
        flex: 0 0 auto;
      }
    `;
  }).join('');
}

function fitText(text: HTMLElement | null, availableWidth: number) {
  const view = text?.ownerDocument.defaultView;
  if (!text || !view) return;

  text.style.transform = 'none';
  text.style.fontSize = '';
  let fontSize = Number.parseFloat(view.getComputedStyle(text).fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return;

  while (text.scrollWidth > availableWidth && fontSize > 0.5) {
    fontSize = Math.max(0.5, fontSize - Math.max(0.25, fontSize * 0.02));
    text.style.fontSize = `${fontSize.toFixed(3)}px`;
  }
  if (text.scrollWidth > availableWidth) {
    text.style.transform = `scaleX(${Math.max(0.01, availableWidth / text.scrollWidth).toFixed(4)})`;
  }
}

/**
 * Reduz o código e o nome até caberem na coluna de textos, preservando-os
 * inteiros (sem reticências) mesmo em equipamentos com descrições longas.
 */
export function fitRomaneioQrLabelText(label: HTMLElement) {
  const details = label.querySelector<HTMLElement>('.romaneio-qr-label-details');
  const view = label.ownerDocument.defaultView;
  if (!details || !view) return;

  const availableWidth = Math.max(1, details.clientWidth);
  const code = label.querySelector<HTMLElement>('.romaneio-qr-label-code');
  if (code) {
    const codeStyle = view.getComputedStyle(code);
    const codePadding = Number.parseFloat(codeStyle.paddingLeft) + Number.parseFloat(codeStyle.paddingRight);
    fitText(code.querySelector('.romaneio-qr-label-fit'), Math.max(1, availableWidth - codePadding));
  }
  fitText(label.querySelector('.romaneio-qr-label-name .romaneio-qr-label-fit'), availableWidth);
}

/**
 * Recorta a moldura branca que o gerador acrescenta ao SVG para que a zona de
 * silêncio passe a ser controlada pelo padding da caixa do QR.
 */
export function trimRomaneioQrSvgQuietZone(qrCode: SVGSVGElement) {
  const rects = Array.from(qrCode.querySelectorAll('rect'));
  if (rects.length === 0) return qrCode;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  rects.forEach(rect => {
    const x = Number.parseFloat(rect.getAttribute('x') || '0');
    const y = Number.parseFloat(rect.getAttribute('y') || '0');
    const width = Number.parseFloat(rect.getAttribute('width') || '0');
    const height = Number.parseFloat(rect.getAttribute('height') || '0');
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return qrCode;

  qrCode.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  qrCode.setAttribute('width', '100%');
  qrCode.setAttribute('height', '100%');
  qrCode.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return qrCode;
}
