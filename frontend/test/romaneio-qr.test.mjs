import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

async function loadRomaneioQr() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/romaneioQr.ts');
  } finally {
    await server.close();
  }
}

async function loadRomaneioQrLabelArt() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/pages/romaneio/romaneioQrLabelArt.ts');
  } finally {
    await server.close();
  }
}

async function loadNavigation() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/auth/moduleNavigation.ts');
  } finally {
    await server.close();
  }
}

test('QR do romaneio preserva o identificador do item em formato versionado', async () => {
  const { buildRomaneioItemQrValue, parseRomaneioItemQrValue } = await loadRomaneioQr();
  const value = buildRomaneioItemQrValue('cm123_item-9');

  assert.equal(value, 'FILTROVALI:ROMANEIO_ITEM:1:cm123_item-9');
  assert.equal(parseRomaneioItemQrValue(value), 'cm123_item-9');
});

test('leitor rejeita QR externo, versão desconhecida e identificador malformado', async () => {
  const { parseRomaneioItemQrValue } = await loadRomaneioQr();

  assert.equal(parseRomaneioItemQrValue('https://example.com/equipamento/123'), null);
  assert.equal(parseRomaneioItemQrValue('FILTROVALI:ROMANEIO_ITEM:2:item-1'), null);
  assert.equal(parseRomaneioItemQrValue('FILTROVALI:ROMANEIO_ITEM:1:item/1'), null);
});

test('itens não serializados e medidas variáveis pedem quantidade após o scan', async () => {
  const { romaneioQrRequiresQuantity } = await loadRomaneioQr();

  assert.equal(romaneioQrRequiresQuantity({ isSerialized: true, measureType: 'UNIT' }), false);
  assert.equal(romaneioQrRequiresQuantity({ isSerialized: false, measureType: 'UNIT' }), true);
  assert.equal(romaneioQrRequiresQuantity({ isSerialized: true, measureType: 'LENGTH' }), true);
  assert.equal(romaneioQrRequiresQuantity({ isSerialized: true, measureType: 'WEIGHT' }), true);
});

test('impressão em lote pagina todos os equipamentos e tamanhos sem perder etiquetas', async () => {
  const { paginateRomaneioQrLabels, ROMANEIO_QR_LABEL_SIZES } = await loadRomaneioQr();
  const items = Array.from({ length: 25 }, (_, index) => ({ id: `item-${index + 1}` }));

  assert.deepEqual(
    ROMANEIO_QR_LABEL_SIZES.map(size => [size.widthMillimeters, size.heightMillimeters]),
    [[120, 41.3], [80, 27.5], [60, 20.7]]
  );

  // A arte de referência é a mesma etiqueta em escala, então os três tamanhos
  // precisam manter a proporção horizontal de 2,9039:1.
  ROMANEIO_QR_LABEL_SIZES.forEach(size => {
    const aspectRatio = size.widthMillimeters / size.heightMillimeters;
    assert.ok(
      Math.abs(aspectRatio - 2.9039) < 0.02,
      `tamanho ${size.id} fora da proporção da arte: ${aspectRatio}`
    );
  });

  const smallPages = paginateRomaneioQrLabels(items, ['small']);
  const smallEntries = smallPages.map(page => page.rows.flatMap(row => row.entries));
  assert.equal(smallPages.length, 1);
  assert.equal(smallEntries[0].length, 25);

  const mixedPages = paginateRomaneioQrLabels(items.slice(0, 3), ['large', 'medium', 'small']);
  const mixedEntries = mixedPages.flatMap(page => page.rows.flatMap(row => row.entries));
  assert.equal(mixedEntries.length, 9);
  assert.deepEqual(
    mixedEntries.map(entry => `${entry.item.id}:${entry.size.id}`),
    [
      'item-1:large',
      'item-1:medium',
      'item-1:small',
      'item-2:large',
      'item-2:medium',
      'item-2:small',
      'item-3:large',
      'item-3:medium',
      'item-3:small'
    ]
  );
});

test('campanha do QR é individual e expira globalmente após dez dias', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-09-06T12:00:00-03:00').getTime();
    const navigation = await loadNavigation();
    assert.equal(navigation.ROMANEIO_QR_NOVELTY_IMPLEMENTED_AT, '2026-08-27');
    assert.equal(navigation.shouldShowRomaneioQrNovelty({ id: 'operator-1' }), true);
    navigation.markRomaneioQrNoveltySeen({ id: 'operator-1' });
    assert.equal(navigation.shouldShowRomaneioQrNovelty({ id: 'operator-1' }), false);
    assert.equal(navigation.shouldShowRomaneioQrNovelty({ id: 'operator-2' }), true);

    Date.now = () => new Date('2026-09-07T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowRomaneioQrNovelty({ id: 'operator-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('campanha apresenta etiquetas e scanner apontando para controles reais', async () => {
  const [noveltySource, overviewSource, formSource, labelModalSource, labelArtSource] = await Promise.all([
    readFile(new URL('../src/pages/romaneio/RomaneioQrNovelty.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/romaneio/RomaneioPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/romaneio/NewRomaneioPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/romaneio/RomaneioQrLabelModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/romaneio/romaneioQrLabelArt.ts', import.meta.url), 'utf8')
  ]);

  assert.match(noveltySource, /QR codes no romaneio/);
  assert.match(noveltySource, /QR_LABEL_TRIGGER_SELECTOR/);
  assert.match(noveltySource, /CATEGORY_QR_TRIGGER_SELECTOR/);
  assert.match(noveltySource, /QR_SCANNER_SELECTOR/);
  assert.match(overviewSource, /data-romaneio-category-qr-trigger/);
  assert.match(overviewSource, /data-romaneio-qr-label-trigger/);
  assert.match(formSource, /data-romaneio-qr-scanner-trigger/);

  // A prévia e a impressão compartilham a mesma folha de estilo da etiqueta.
  assert.match(labelModalSource, /buildRomaneioQrLabelArtStyles\(\)/g);
  assert.equal(labelModalSource.match(/buildRomaneioQrLabelArtStyles\(\)/g).length, 2);
  assert.match(labelModalSource, /buildRomaneioQrLabelSizeStyles\(labelSizeOptions, 'preview'\)/);
  assert.match(labelModalSource, /buildRomaneioQrLabelSizeStyles\(selectedSizeOptions, 'print'\)/);
  assert.match(labelModalSource, /trimRomaneioQrSvgQuietZone/);
  assert.doesNotMatch(labelModalSource, /text-overflow:\s*ellipsis/);

  // Medidas extraídas da arte de referência, em % da largura da etiqueta.
  assert.match(labelArtSource, /green:\s*'#30503a'/);
  assert.match(labelArtSource, /aspectRatio:\s*2\.9039/);
  assert.match(labelArtSource, /qrSize:\s*27\.09/);
  assert.match(labelArtSource, /codeFont:\s*8\.23/);
  assert.match(labelArtSource, /nameFont:\s*4\.478/);
  assert.match(labelArtSource, /captionFont:\s*1\.735/);
  assert.match(labelArtSource, /align-items: flex-start/);
  assert.doesNotMatch(labelArtSource, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(labelArtSource, /#135e49|#176b55|#0c5e4b|#183b32|#17352e/);
});

test('a arte da etiqueta escala linearmente e ajusta apenas a unidade base', async () => {
  const { buildRomaneioQrLabelArtStyles, buildRomaneioQrLabelSizeStyles } = await loadRomaneioQrLabelArt();
  const { ROMANEIO_QR_LABEL_SIZES } = await loadRomaneioQr();
  const art = buildRomaneioQrLabelArtStyles();

  // Todas as medidas da arte saem de --u, então prévia e impressão só divergem
  // no valor dessa unidade.
  assert.doesNotMatch(art, /[0-9.]+(mm|cqw)\b/);
  assert.match(art, /calc\(27\.09 \* var\(--u\)\)/);

  const printStyles = buildRomaneioQrLabelSizeStyles(ROMANEIO_QR_LABEL_SIZES, 'print');
  assert.match(printStyles, /--u: 1\.2000mm;\s*width: 120mm;\s*height: 41\.3mm/);
  assert.match(printStyles, /--u: 0\.8000mm;\s*width: 80mm;\s*height: 27\.5mm/);
  assert.match(printStyles, /--u: 0\.6000mm;\s*width: 60mm;\s*height: 20\.7mm/);

  const previewStyles = buildRomaneioQrLabelSizeStyles(ROMANEIO_QR_LABEL_SIZES, 'preview');
  assert.match(previewStyles, /container-type: inline-size;\s*--u: 1cqw;\s*width: 63\.158%/);
  assert.match(previewStyles, /aspect-ratio: 120 \/ 41\.3/);

  // A moldura precisa ficar no elemento interno: na prévia a etiqueta é o
  // próprio container e cqw aplicado nela resolveria contra o ancestral.
  const labelRule = art.slice(art.indexOf('.romaneio-qr-label {'), art.indexOf('.romaneio-qr-label-qr {'));
  const [, ownRule] = labelRule.split('.romaneio-qr-label-content {');
  assert.doesNotMatch(labelRule.split('.romaneio-qr-label,')[0], /var\(--u\)/);
  assert.match(ownRule, /border: calc\([0-9.]+ \* var\(--u\)\) solid/);

  // O espaçamento entre letras fica no texto ajustável, senão o em herdado
  // vira comprimento absoluto e não acompanha a fonte reduzida.
  assert.match(art, /\.romaneio-qr-label-code \.romaneio-qr-label-fit \{\s*letter-spacing: 0\.1em;/);
  assert.match(art, /\.romaneio-qr-label-name \.romaneio-qr-label-fit \{\s*letter-spacing: 0\.042em;/);
  const codeRule = art.slice(art.indexOf('.romaneio-qr-label-code {'), art.indexOf('.romaneio-qr-label-name {'));
  assert.doesNotMatch(codeRule, /letter-spacing/);
});

test('o QR perde a moldura embutida para que a zona de silêncio venha da etiqueta', async () => {
  const { trimRomaneioQrSvgQuietZone } = await loadRomaneioQrLabelArt();
  const attributes = {};
  const modules = [];
  for (let index = 0; index < 25; index += 1) {
    modules.push({ x: 40 + index * 8, y: 40, width: 8, height: 8 });
    modules.push({ x: 40, y: 40 + index * 8, width: 8, height: 8 });
  }
  const qrCode = {
    querySelectorAll: () => modules.map(rect => ({
      getAttribute: name => String(rect[name])
    })),
    setAttribute: (name, value) => { attributes[name] = value; }
  };

  assert.equal(trimRomaneioQrSvgQuietZone(qrCode), qrCode);
  assert.equal(attributes.viewBox, '40 40 200 200');
  assert.equal(attributes.width, '100%');
  assert.equal(attributes.height, '100%');

  // Um SVG sem módulos é devolvido intacto em vez de receber um viewBox vazio.
  const untouched = {};
  const emptyQrCode = {
    querySelectorAll: () => [],
    setAttribute: (name, value) => { untouched[name] = value; }
  };
  trimRomaneioQrSvgQuietZone(emptyQrCode);
  assert.deepEqual(untouched, {});
});
