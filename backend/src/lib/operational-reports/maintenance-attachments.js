import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import env from "../../config/env.js";
import {
  inlineContentDisposition,
  resolveManagedDocumentPath,
  unlinkManagedDocumentFile,
  writeManagedDocumentFile,
} from "../documents/storage.js";
import {
  optimizeImageForReport,
  readStoredImageAsset,
} from "../stored-image.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ACCEPTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function safeName(value, fallback) {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\n\r]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function parseImageDataUrl(upload) {
  const dataUrl = String(upload?.dataUrl || "").trim();
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    const error = new Error("A foto deve ser uma imagem válida.");
    error.statusCode = 400;
    throw error;
  }
  const mimeType = match[1].toLowerCase();
  if (!ACCEPTED_IMAGE_MIMES.has(mimeType)) {
    const error = new Error(
      "Formato de foto não suportado. Use JPG, PNG, WEBP ou HEIC.",
    );
    error.statusCode = 400;
    throw error;
  }
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error("Foto inválida ou maior que 15 MB.");
    error.statusCode = 400;
    throw error;
  }
  const extension = mimeType.split("/")[1].replace("jpeg", "jpg");
  return { bytes, mimeType, extension };
}

async function writeFile({ token, fileName, bytes, extension, equipmentCode }) {
  return writeManagedDocumentFile({
    rootDir: env.uploadDir,
    folderParts: [
      "Equipamentos",
      "Manutenções",
      safeName(equipmentCode, "Sem código"),
    ],
    token,
    fileName,
    bytes,
    extension,
  });
}

export function serializeMaintenanceAttachment(
  attachment,
  reportPrefix = "/api/rdo",
) {
  if (!attachment) return null;
  return {
    id: attachment.id,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    createdAt: attachment.createdAt,
    url: `${reportPrefix}/operational-reports/maintenance/attachments/${encodeURIComponent(attachment.id)}`,
  };
}

export async function createMaintenancePhoto(
  client,
  { maintenanceId, equipmentCode, upload },
) {
  const parsed = parseImageDataUrl(upload);
  const optimized = await optimizeImageForReport(parsed.bytes, {
    extension: parsed.extension,
    mimeType: parsed.mimeType,
  });
  if (!optimized?.bytes?.length) {
    const error = new Error("Não foi possível processar a foto.");
    error.statusCode = 400;
    throw error;
  }
  const publicToken = randomUUID();
  const fileName = safeName(
    upload?.fileName,
    `foto-${publicToken.slice(0, 8)}.jpg`,
  ).replace(/\.[^.]+$/, ".jpg");
  const storagePath = await writeFile({
    token: publicToken,
    fileName,
    bytes: optimized.bytes,
    extension: "jpg",
    equipmentCode,
  });
  try {
    return await client.maintenanceAttachment.create({
      data: {
        maintenanceId,
        kind: "PHOTO",
        fileName,
        mimeType: "image/jpeg",
        storagePath,
        publicToken,
      },
    });
  } catch (error) {
    await unlinkManagedDocumentFile(storagePath, {
      rootDir: env.uploadDir,
      requiredPrefix: "Equipamentos/Manutenções/",
    }).catch(() => {});
    throw error;
  }
}

export async function createMaintenanceDocument(
  client,
  { maintenanceId, equipmentCode, fileName, bytes },
) {
  const publicToken = randomUUID();
  const safeFileName = safeName(fileName, `Manutenção-${maintenanceId}.pdf`);
  const storagePath = await writeFile({
    token: publicToken,
    fileName: safeFileName,
    bytes,
    extension: "pdf",
    equipmentCode,
  });
  try {
    return await client.maintenanceAttachment.create({
      data: {
        maintenanceId,
        kind: "DOCUMENT",
        fileName: safeFileName,
        mimeType: "application/pdf",
        storagePath,
        publicToken,
      },
    });
  } catch (error) {
    await unlinkManagedDocumentFile(storagePath, {
      rootDir: env.uploadDir,
      requiredPrefix: "Equipamentos/Manutenções/",
    }).catch(() => {});
    throw error;
  }
}

export async function removeMaintenancePhotos(client, maintenanceId, ids) {
  const idList = Array.from(new Set((ids || []).filter(Boolean)));
  if (!idList.length) return 0;
  const rows = await client.maintenanceAttachment.findMany({
    where: { maintenanceId, kind: "PHOTO", id: { in: idList } },
  });
  if (!rows.length) return 0;
  await client.maintenanceAttachment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await unlinkManagedDocumentFile(row.storagePath, {
      rootDir: env.uploadDir,
      requiredPrefix: "Equipamentos/Manutenções/",
    });
  }
  return rows.length;
}

export async function removeAllMaintenanceAttachments(client, maintenanceId) {
  const rows = await client.maintenanceAttachment.findMany({
    where: { maintenanceId },
  });
  if (!rows.length) return 0;
  await client.maintenanceAttachment.deleteMany({ where: { maintenanceId } });
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await unlinkManagedDocumentFile(row.storagePath, {
      rootDir: env.uploadDir,
      requiredPrefix: "Equipamentos/Manutenções/",
    });
  }
  return rows.length;
}

export async function cleanupMaintenanceStoragePaths(storagePaths) {
  for (const storagePath of storagePaths || []) {
    // eslint-disable-next-line no-await-in-loop
    await unlinkManagedDocumentFile(storagePath, {
      rootDir: env.uploadDir,
      requiredPrefix: "Equipamentos/Manutenções/",
    }).catch(() => {});
  }
}

export async function resolveMaintenancePhotoAssets(client, maintenanceId) {
  const rows = await client.maintenanceAttachment.findMany({
    where: { maintenanceId, kind: "PHOTO" },
    orderBy: { createdAt: "asc" },
  });
  const assets = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const asset = await readStoredImageAsset(row.storagePath);
    if (asset?.bytes?.length) assets.push({ ...asset, label: row.fileName });
  }
  return assets;
}

export async function resolveSignatureAsset(signatureDataUrl) {
  if (!signatureDataUrl) return null;
  return readStoredImageAsset(signatureDataUrl);
}

export function resolveMaintenanceAttachmentPath(attachment) {
  return resolveManagedDocumentPath(attachment?.storagePath, {
    rootDir: env.uploadDir,
  });
}

export async function readMaintenanceAttachment(attachment) {
  const targetPath = resolveMaintenanceAttachmentPath(attachment);
  if (!targetPath) return null;
  const bytes = await fs.readFile(targetPath).catch(() => null);
  return bytes ? { bytes, targetPath } : null;
}

export function maintenanceAttachmentDisposition(fileName) {
  return inlineContentDisposition(
    path.basename(safeName(fileName, "manutencao.pdf")),
  );
}
