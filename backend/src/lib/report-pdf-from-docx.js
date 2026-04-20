import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import env from '../config/env.js';
import { saveReportDocx } from './report-docx.js';

const execFileAsync = promisify(execFile);

function pdfNameFromDocx(fileName) {
  return fileName.replace(/\.docx$/i, '.pdf');
}

async function ensurePdfCreated(pdfPath) {
  try {
    await fs.access(pdfPath);
  } catch {
    const error = new Error('Conversao DOCX -> PDF nao gerou o arquivo esperado.');
    error.statusCode = 500;
    throw error;
  }
}

async function convertWithWord(docxPath, pdfPath) {
  const script = `
param([string]$DocxPath,[string]$PdfPath)
$ErrorActionPreference = 'Stop'
$word = $null
$document = $null
try {
  $pdfDir = Split-Path -Parent $PdfPath
  if(!(Test-Path $pdfDir)){ New-Item -ItemType Directory -Path $pdfDir | Out-Null }
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($DocxPath, $false, $true)
  $document.ExportAsFixedFormat($PdfPath, 17)
} finally {
  if($document -ne $null){ $document.Close([ref]$false) }
  if($word -ne $null){ $word.Quit() }
}
`;
  const scriptPath = path.join(env.uploadDir, `tmp-docx-to-pdf-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, script, 'utf8');
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, docxPath, pdfPath],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
  } finally {
    await fs.rm(scriptPath, { force: true });
  }
}

async function convertWithLibreOffice(docxPath, pdfPath) {
  const outDir = path.dirname(pdfPath);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtrovali-soffice-'));
  try {
    await fs.mkdir(outDir, { recursive: true });
    await execFileAsync(
      env.libreOfficeBinary,
      [
        '--headless',
        '--nologo',
        '--nolockcheck',
        '--norestore',
        '--nodefault',
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        docxPath
      ],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
    await ensurePdfCreated(pdfPath);
  } finally {
    await fs.rm(profileDir, { recursive: true, force: true });
  }
}

async function convertDocxToPdf(docxPath, pdfPath) {
  if (process.platform === 'win32') {
    await convertWithWord(docxPath, pdfPath);
    return;
  }

  await convertWithLibreOffice(docxPath, pdfPath);
}

export async function saveReportPdf(report) {
  const docx = await saveReportDocx(report);
  const pdfFileName = pdfNameFromDocx(docx.fileName);
  const pdfPath = path.join(path.dirname(docx.targetPath), pdfFileName);

  await convertDocxToPdf(docx.targetPath, pdfPath);

  return {
    fileName: pdfFileName,
    targetPath: pdfPath,
    publicUrl: docx.publicUrl.replace(/\.docx$/i, '.pdf')
  };
}
