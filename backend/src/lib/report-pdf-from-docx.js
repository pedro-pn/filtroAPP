import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import env from '../config/env.js';
import { saveReportDocx } from './report-docx.js';

const MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024;
const pdfAbortSignalStorage = new AsyncLocalStorage();
let activePdfConversions = 0;

function pdfNameFromDocx(fileName) {
  return fileName.replace(/\.docx$/i, '.pdf');
}

function pdfAbortedError() {
  const error = new Error('Geração de PDF cancelada porque a conexão foi encerrada.');
  error.statusCode = 499;
  error.code = 'PDF_ABORTED';
  return error;
}

function pdfConversionBusyError() {
  const error = new Error('Outra conversão de PDF está em andamento. Tente novamente em alguns segundos.');
  error.statusCode = 503;
  return error;
}

function currentPdfAbortSignal() {
  return pdfAbortSignalStorage.getStore() || null;
}

export function runWithPdfAbortSignal(signal, task) {
  return pdfAbortSignalStorage.run(signal, task);
}

export async function isLikelyCompletePdf(pdfPath) {
  let handle;
  try {
    handle = await fs.open(pdfPath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 16) return false;

    const header = Buffer.alloc(5);
    await handle.read(header, 0, header.length, 0);
    if (header.toString('latin1') !== '%PDF-') return false;

    const tailLength = Math.min(2048, stat.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    return tail.toString('latin1').includes('%%EOF');
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function ensurePdfCreated(pdfPath) {
  if (!(await isLikelyCompletePdf(pdfPath))) {
    const error = new Error('Conversão DOCX -> PDF não gerou o arquivo esperado.');
    error.statusCode = 500;
    throw error;
  }
}

function conversionTimeoutError(error, engine) {
  if (error?.code === 'PDF_ABORTED') return error;
  if (error?.killed || error?.signal === 'SIGTERM' || error?.signal === 'SIGKILL' || error?.code === 'ETIMEDOUT') {
    const timeoutSeconds = Math.round(env.docxToPdfTimeoutMs / 1000);
    const next = new Error(`Conversão DOCX -> PDF excedeu ${timeoutSeconds}s (${engine}).`);
    next.statusCode = 504;
    return next;
  }
  return error;
}

function appendProcessOutput(chunks, chunk, size) {
  const nextSize = size + chunk.length;
  if (size < MAX_PROCESS_OUTPUT_BYTES) {
    chunks.push(chunk.slice(0, Math.max(0, MAX_PROCESS_OUTPUT_BYTES - size)));
  }
  return nextSize;
}

function killProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Process already exited.
  }
}

async function runProcess(file, args, options = {}) {
  const abortSignal = options.signal || null;
  if (abortSignal?.aborted) throw pdfAbortedError();

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 5000).unref?.();
    }, options.timeout);

    const onAbort = () => {
      aborted = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 5000).unref?.();
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', chunk => {
      stdoutSize = appendProcessOutput(stdout, chunk, stdoutSize);
    });
    child.stderr.on('data', chunk => {
      stderrSize = appendProcessOutput(stderr, chunk, stderrSize);
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      abortSignal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      abortSignal?.removeEventListener('abort', onAbort);
      if (aborted) {
        reject(pdfAbortedError());
        return;
      }
      if (timedOut) {
        const error = new Error(`Processo excedeu ${Math.round(options.timeout / 1000)}s.`);
        error.code = 'ETIMEDOUT';
        error.killed = true;
        error.signal = signal;
        reject(error);
        return;
      }
      if (code !== 0) {
        const output = Buffer.concat(stderr).toString('utf8') || Buffer.concat(stdout).toString('utf8');
        const error = new Error(output || `Processo finalizou com código ${code}.`);
        error.code = code;
        error.signal = signal;
        reject(error);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

async function acquirePdfConversionSlot() {
  if (activePdfConversions > 0) throw pdfConversionBusyError();
  activePdfConversions += 1;
  return () => {
    activePdfConversions = Math.max(0, activePdfConversions - 1);
  };
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
    await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, docxPath, pdfPath],
      {
        timeout: env.docxToPdfTimeoutMs,
        signal: currentPdfAbortSignal()
      }
    );
    await ensurePdfCreated(pdfPath);
  } catch (error) {
    await fs.rm(pdfPath, { force: true }).catch(() => {});
    throw conversionTimeoutError(error, 'Word');
  } finally {
    await fs.rm(scriptPath, { force: true });
  }
}

async function convertWithLibreOffice(docxPath, pdfPath) {
  const outDir = path.dirname(pdfPath);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtrovali-soffice-'));
  try {
    await fs.mkdir(outDir, { recursive: true });
    await runProcess(
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
      {
        timeout: env.docxToPdfTimeoutMs,
        signal: currentPdfAbortSignal()
      }
    );
    await ensurePdfCreated(pdfPath);
  } catch (error) {
    await fs.rm(pdfPath, { force: true }).catch(() => {});
    throw conversionTimeoutError(error, 'LibreOffice');
  } finally {
    await fs.rm(profileDir, { recursive: true, force: true });
  }
}

export async function convertDocxToPdf(docxPath, pdfPath) {
  const abortSignal = currentPdfAbortSignal();
  if (abortSignal?.aborted) throw pdfAbortedError();
  const release = await acquirePdfConversionSlot();
  try {
    if (process.platform === 'win32') {
      await convertWithWord(docxPath, pdfPath);
      return;
    }

    await convertWithLibreOffice(docxPath, pdfPath);
  } finally {
    release();
  }
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
