import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import env from '../config/env.js';
import { saveReportDocx } from './report-docx.js';

const execFileAsync = promisify(execFile);

function pdfNameFromDocx(fileName) {
  return fileName.replace(/\.docx$/i, '.pdf');
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

export async function saveReportPdf(report) {
  const docx = await saveReportDocx(report);
  const dir = path.join(env.uploadDir, 'generated-pdf');
  await fs.mkdir(dir, { recursive: true });
  const pdfFileName = pdfNameFromDocx(docx.fileName);
  const pdfPath = path.join(dir, pdfFileName);

  await convertWithWord(docx.targetPath, pdfPath);

  return {
    fileName: pdfFileName,
    targetPath: pdfPath,
    publicUrl: `/uploads/generated-pdf/${encodeURIComponent(pdfFileName)}`
  };
}
