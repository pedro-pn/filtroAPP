#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_DATASET = path.resolve(
  path.dirname(__filename),
  'data/legacy-maintenance-history.json'
);
const INDEX_FILE = 'assets-index.json';
const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';

function usage() {
  return [
    'Uso:',
    '  GOOGLE_DRIVE_ACCESS_TOKEN=<token> node scripts/download-legacy-maintenance-assets.js --output-dir <diretório>',
    '',
    'Opções:',
    `  --data <arquivo.json>         Padrão: ${DEFAULT_DATASET}`,
    '  --output-dir <diretório>      Obrigatório',
    '  --documents-only              Baixa somente os PDFs (ignora fotos)',
    '  --concurrency <n>             Padrão: 5; máximo: 10',
    '  --overwrite                   Baixa novamente arquivos já indexados',
    '',
    'O token deve possuir acesso de leitura aos arquivos do Google Drive.',
    'Ele é lido apenas da variável GOOGLE_DRIVE_ACCESS_TOKEN e nunca é gravado.'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    data: DEFAULT_DATASET,
    outputDir: '',
    documentsOnly: false,
    concurrency: 5,
    overwrite: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--documents-only') {
      options.documentsOnly = true;
      continue;
    }
    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    const value = argv[index + 1];
    if (!arg.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error(`Argumento inválido: ${arg}`);
    }
    index += 1;
    switch (arg.slice(2)) {
      case 'data':
        options.data = value;
        break;
      case 'output-dir':
        options.outputDir = value;
        break;
      case 'concurrency':
        options.concurrency = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`Opção desconhecida: ${arg}`);
    }
  }
  if (!options.help && !options.outputDir) {
    throw new Error('Informe o diretório de destino com --output-dir.');
  }
  if (
    !Number.isInteger(options.concurrency)
    || options.concurrency < 1
    || options.concurrency > 10
  ) {
    throw new Error('--concurrency deve estar entre 1 e 10.');
  }
  return options;
}

function uniqueAssets(dataset, { documentsOnly = false } = {}) {
  const assets = new Map();
  for (const record of dataset.records || []) {
    if (record.document) {
      const id = record.document.driveFileId;
      const current = assets.get(id) || {
        driveFileId: id,
        kind: 'DOCUMENT',
        sourceRows: []
      };
      current.sourceRows.push(record.sourceRow);
      assets.set(id, current);
    }
    if (!documentsOnly) {
      for (const photo of record.photos || []) {
        const id = photo.driveFileId;
        const current = assets.get(id) || {
          driveFileId: id,
          kind: 'PHOTO',
          sourceRows: []
        };
        if (current.kind !== 'PHOTO') {
          throw new Error(`O arquivo ${id} aparece como documento e foto.`);
        }
        current.sourceRows.push(record.sourceRow);
        assets.set(id, current);
      }
    }
  }
  return Array.from(assets.values()).map((asset) => ({
    ...asset,
    sourceRows: Array.from(new Set(asset.sourceRows)).sort((a, b) => a - b)
  }));
}

function extensionFor(mimeType, name, kind) {
  if (kind === 'DOCUMENT') return '.pdf';
  const extension = path.extname(String(name || '')).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(extension)) return extension;
  const byMime = new Map([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/heic', '.heic'],
    ['image/heif', '.heif']
  ]);
  return byMime.get(mimeType) || '.bin';
}

function metadataUrl(fileId) {
  const fields = encodeURIComponent(
    'id,name,mimeType,size,md5Checksum,capabilities(canDownload),shortcutDetails(targetId,targetMimeType)'
  );
  return (
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
    + `?fields=${fields}&supportsAllDrives=true`
  );
}

function contentUrl(fileId, mimeType, kind) {
  if (mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
    if (kind !== 'DOCUMENT') {
      throw new Error(`Foto ${fileId} está em um formato Google Workspace.`);
    }
    return (
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
      + `/export?mimeType=${encodeURIComponent('application/pdf')}`
    );
  }
  return (
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
    + '?alt=media&supportsAllDrives=true'
  );
}

async function fetchWithRetry(url, token, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          authorization: `Bearer ${token}`
        }
      });
      if (response.ok) return response;
      const body = await response.text();
      const error = new Error(
        `Google Drive respondeu ${response.status}: ${body.slice(0, 300)}`
      );
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        error.retryable = false;
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

async function loadMetadata(fileId, token) {
  const response = await fetchWithRetry(metadataUrl(fileId), token);
  const metadata = await response.json();
  if (metadata.mimeType === 'application/vnd.google-apps.shortcut') {
    const targetId = metadata.shortcutDetails?.targetId;
    if (!targetId) throw new Error(`Atalho ${fileId} sem arquivo de destino.`);
    const target = await loadMetadata(targetId, token);
    return { ...target, shortcutId: fileId };
  }
  return metadata;
}

async function readExistingIndex(outputDir) {
  const assets = new Map();
  try {
    const content = await fs.readFile(path.join(outputDir, INDEX_FILE), 'utf8');
    const parsed = JSON.parse(content);
    for (const asset of parsed.assets || []) {
      assets.set(asset.driveFileId, asset);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const name of await fs.readdir(outputDir)) {
    if (name === INDEX_FILE || name.endsWith('.part')) continue;
    const driveFileId = path.parse(name).name;
    if (!/^[A-Za-z0-9_-]{15,}$/.test(driveFileId)) continue;
    if (!assets.has(driveFileId)) {
      assets.set(driveFileId, {
        driveFileId,
        localFileName: name,
        originalName: name,
        mimeType: ''
      });
    }
  }
  return assets;
}

async function downloadAsset(asset, { token, outputDir, overwrite, existing }) {
  const indexed = existing.get(asset.driveFileId);
  if (!overwrite && indexed?.localFileName) {
    const indexedPath = path.join(outputDir, indexed.localFileName);
    const stat = await fs.stat(indexedPath).catch(() => null);
    if (stat?.isFile() && stat.size > 0) {
      return {
        ...asset,
        ...indexed,
        size: stat.size,
        sourceRows: asset.sourceRows,
        skipped: true
      };
    }
  }

  const metadata = await loadMetadata(asset.driveFileId, token);
  if (metadata.capabilities?.canDownload === false) {
    throw new Error(`Download não permitido para ${asset.driveFileId}.`);
  }
  if (
    asset.kind === 'DOCUMENT'
    && metadata.mimeType !== 'application/pdf'
    && !metadata.mimeType.startsWith(GOOGLE_APPS_PREFIX)
  ) {
    throw new Error(
      `O registro ${asset.driveFileId} não é PDF: ${metadata.mimeType}.`
    );
  }

  const effectiveId = metadata.id;
  const response = await fetchWithRetry(
    contentUrl(effectiveId, metadata.mimeType, asset.kind),
    token
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Arquivo vazio: ${asset.driveFileId}.`);
  if (asset.kind === 'DOCUMENT' && bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(`Conteúdo não reconhecido como PDF: ${asset.driveFileId}.`);
  }

  const mimeType = asset.kind === 'DOCUMENT'
    ? 'application/pdf'
    : metadata.mimeType;
  const localFileName = `${asset.driveFileId}${extensionFor(
    mimeType,
    metadata.name,
    asset.kind
  )}`;
  const targetPath = path.join(outputDir, localFileName);
  const temporaryPath = `${targetPath}.part`;
  await fs.writeFile(temporaryPath, bytes, { mode: 0o600 });
  await fs.rename(temporaryPath, targetPath);
  await fs.chmod(targetPath, 0o600);
  return {
    driveFileId: asset.driveFileId,
    resolvedDriveFileId: effectiveId,
    kind: asset.kind,
    sourceRows: asset.sourceRows,
    originalName: metadata.name || localFileName,
    mimeType,
    size: bytes.length,
    md5Checksum: metadata.md5Checksum || null,
    localFileName,
    skipped: false
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, consume)
  );
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const token = String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new Error('Defina GOOGLE_DRIVE_ACCESS_TOKEN antes de executar.');
  }
  const dataset = JSON.parse(await fs.readFile(path.resolve(options.data), 'utf8'));
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const existing = await readExistingIndex(outputDir);
  const assets = uniqueAssets(dataset, options);
  let completed = 0;
  const downloaded = await runPool(
    assets,
    options.concurrency,
    async (asset) => {
      const result = await downloadAsset(asset, {
        token,
        outputDir,
        overwrite: options.overwrite,
        existing
      });
      completed += 1;
      console.log(
        `[arquivos] ${completed}/${assets.length} ${asset.kind} ${asset.driveFileId}`
        + (result.skipped ? ' (já existia)' : '')
      );
      return result;
    }
  );

  const index = {
    version: 1,
    source: dataset.source,
    generatedAt: new Date().toISOString(),
    assets: downloaded.map(({ skipped: _skipped, ...asset }) => asset)
  };
  const indexPath = path.join(outputDir, INDEX_FILE);
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, {
    mode: 0o600
  });
  console.log(`[arquivos] Índice salvo em ${indexPath}`);
}

export {
  contentUrl,
  extensionFor,
  metadataUrl,
  uniqueAssets
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
