// Página pública do QR code do equipamento.
//
// O QR code de um item (etiqueta do Romaneio/Equipamentos) aponta para `<APP_URL>/q/<publicToken>`, onde
// `publicToken` é o token estável do item no catálogo do Romaneio. A página lista os documentos do
// equipamento (manual, dados técnicos, certificado e arquivos). Sem documentos, a página continua existindo
// (vazia), então o mesmo link/etiqueta serve para documentos adicionados depois.
//
// Por documento, o gestor escolhe o acesso: PUBLIC (qualquer pessoa baixa), LOGIN (aparece, mas o download
// exige login de colaborador) ou HIDDEN (não aparece na página).

import { publicUrlForPath } from '../documents/storage.js';
import { resolvePublicEquipmentAttachment, withCurrentAttachments } from '../equipment-attachments.js';
import { functioningChecklistFileName, hasFunctioningChecklist, resolveFunctioningChecklist } from './functioning-checklist.js';
import { buildFunctioningChecklistPdf } from './functioning-checklist-pdf.js';
import { buildFunctioningChecklistXlsx, CHECKLIST_XLSX_MIME } from './functioning-checklist-xlsx.js';
import { resolveMaintenanceAttachmentPath } from '../operational-reports/maintenance-attachments.js';

export const QrAccess = { PUBLIC: 'PUBLIC', LOGIN: 'LOGIN', HIDDEN: 'HIDDEN' };
const ACCESS_VALUES = new Set(Object.values(QrAccess));
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ACCESS_KEYS = 500;

export function isQrToken(value) {
  return TOKEN_PATTERN.test(String(value || ''));
}

export function qrPageUrl(token) {
  return publicUrlForPath(`/q/${encodeURIComponent(String(token || ''))}`);
}

// Guarda só o que foge do padrão e só chaves em formato conhecido.
export function normalizeQrAccess(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, mode] of Object.entries(value).slice(0, MAX_ACCESS_KEYS)) {
    const validKey = ['manual', 'datasheet', 'certificate', 'checklist', 'maintenance'].includes(key) || /^doc:[A-Za-z0-9_-]{1,64}$/.test(key);
    if (validKey && ACCESS_VALUES.has(mode) && mode !== defaultAccessOf(key)) out[key] = mode;
  }
  return out;
}

export function accessOf(accessMap, key) {
  const mode = accessMap?.[key];
  return ACCESS_VALUES.has(mode) ? mode : defaultAccessOf(key);
}

function defaultAccessOf(key) {
  return key.startsWith('doc:') ? QrAccess.HIDDEN : QrAccess.PUBLIC;
}

// Documentos vigentes do equipamento, na ordem em que aparecem na página.
export function listEquipmentQrDocuments(attachments) {
  const current = withCurrentAttachments({ attachments: Array.isArray(attachments) ? attachments : [] });
  const docs = [];
  if (current.operationManual) docs.push({ key: 'manual', group: 'Manual de operação', label: 'Manual de operação', attachment: current.operationManual });
  const datasheet = current.technicalDocGenerated || current.technicalDoc;
  if (datasheet) docs.push({ key: 'datasheet', group: 'Dados técnicos', label: 'Dados técnicos (datasheet)', attachment: datasheet });
  if (current.calibrationCertificate) docs.push({ key: 'certificate', group: 'Certificado de calibração', label: 'Certificado de calibração', attachment: current.calibrationCertificate });
  for (const document of current.documents || []) {
    docs.push({ key: `doc:${document.id}`, group: 'Arquivos', label: document.fileName, attachment: document });
  }
  return docs;
}

// Resolve o item de catálogo e (se for equipamento) o equipamento ativo com seus anexos.
export async function resolveQrTarget(client, token) {
  if (!isQrToken(token)) return null;
  const item = await client.romaneioCatalogItem.findUnique({ where: { publicToken: String(token).toLowerCase() } });
  if (!item || !item.isActive) return null;
  if (item.sourceType !== 'EQUIPAMENTOS' || !item.sourceId) return { item, equipment: null };
  const equipment = await client.companyEquipment.findUnique({
    where: { id: item.sourceId },
    include: { attachments: true, category: true }
  });
  if (!equipment?.isActive) return null;
  return { item, equipment };
}

export function downloadPathFor(token, key) {
  return `/api/equipamentos-qr/${encodeURIComponent(token)}/documentos/${encodeURIComponent(key)}/arquivo`;
}

function publicDownloadPathFor(token, key) {
  return `/api/equipamentos-qr/${encodeURIComponent(token)}/documentos/${encodeURIComponent(key)}/publico`;
}

// Consulta o documento do último registro aprovado, sem copiar anexos nem incluir
// fotos, notas internas ou manutenção ainda pendente de revisão.
async function listQrDocuments(client, equipment, token) {
  const docs = listEquipmentQrDocuments(equipment.attachments);
  if (hasFunctioningChecklist(resolveFunctioningChecklist(equipment, equipment.category))) {
    docs.push({ key: 'checklist', group: 'Checklist de funcionamento', label: 'Checklist de funcionamento', attachment: {
      fileName: functioningChecklistFileName(equipment), mimeType: 'application/pdf',
      createdAt: equipment.functioningChecklist ? equipment.updatedAt : equipment.category?.updatedAt,
      publicUrl: publicDownloadPathFor(token, 'checklist')
    } });
  }
  const maintenance = await client.maintenanceRecord.findFirst({
    where: { equipmentId: equipment.id, status: 'APPROVED' },
    orderBy: [{ maintenanceDate: 'desc' }, { approvedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: { attachments: { where: { kind: 'DOCUMENT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } }
  });
  const attachment = maintenance?.attachments?.[0];
  if (attachment) docs.push({ key: 'maintenance', group: 'Última manutenção', label: 'Última manutenção realizada', attachment: {
    ...attachment, publicUrl: publicDownloadPathFor(token, 'maintenance')
  } });
  return docs;
}

// Conteúdo da página pública (sem ids internos): documentos ocultos não aparecem; os que exigem login
// aparecem sem URL pública.
export async function buildPublicQrPage(client, token) {
  const target = await resolveQrTarget(client, token);
  if (!target) return null;
  const { item, equipment } = target;
  const accessMap = equipment?.qrDocumentAccess || {};
  const documents = equipment
    ? (await listQrDocuments(client, equipment, item.publicToken))
      .map(doc => ({ doc, access: accessOf(accessMap, doc.key) }))
      .filter(({ access }) => access !== QrAccess.HIDDEN)
      .map(({ doc, access }) => ({
        key: doc.key,
        group: doc.group,
        label: doc.label,
        fileName: doc.attachment.fileName,
        mimeType: doc.attachment.mimeType,
        createdAt: doc.attachment.createdAt,
        requiresLogin: access === QrAccess.LOGIN,
        url: access === QrAccess.PUBLIC ? doc.attachment.publicUrl : null,
        downloadPath: access === QrAccess.LOGIN ? downloadPathFor(item.publicToken, doc.key) : null,
        spreadsheetDownloadPath: doc.key === 'checklist'
          ? `/api/equipamentos-qr/${encodeURIComponent(item.publicToken)}/documentos/checklist/planilha` : null
      }))
    : [];
  return {
    name: equipment?.name || item.name,
    code: equipment?.code || item.code || null,
    categoryName: equipment?.category?.name || item.categoryName || null,
    isEquipment: Boolean(equipment),
    documents
  };
}

// Download autenticado de um documento com acesso LOGIN (ou PUBLIC): devolve anexo e caminho no disco.
export async function resolveQrDownload(client, token, key, { publicOnly = false, spreadsheet = false } = {}) {
  const target = await resolveQrTarget(client, token);
  if (!target?.equipment) return null;
  const access = accessOf(target.equipment.qrDocumentAccess, key);
  if (access === QrAccess.HIDDEN || (publicOnly && access !== QrAccess.PUBLIC) || (publicOnly && spreadsheet)) return null;
  const doc = (await listQrDocuments(client, target.equipment, token)).find(entry => entry.key === key);
  if (!doc) return null;
  if (spreadsheet && key !== 'checklist') return null;
  if (key === 'checklist') {
    const equipment = target.equipment;
    const bytes = spreadsheet ? buildFunctioningChecklistXlsx(equipment, equipment.category) : await buildFunctioningChecklistPdf(equipment, equipment.category);
    return { bytes, fileName: functioningChecklistFileName(equipment, spreadsheet ? 'xlsx' : 'pdf'), attachment: {
      ...doc.attachment, mimeType: spreadsheet ? CHECKLIST_XLSX_MIME : 'application/pdf'
    } };
  }
  if (key === 'maintenance') {
    const targetPath = resolveMaintenanceAttachmentPath(doc.attachment);
    return targetPath ? { attachment: doc.attachment, targetPath, fileName: doc.attachment.fileName } : null;
  }
  return resolvePublicEquipmentAttachment(doc.attachment.publicToken);
}

// Painel de configuração (Equipamentos): link e documentos com o acesso atual.
export async function buildQrLinkSettings(client, equipmentId) {
  const equipment = await client.companyEquipment.findUnique({
    where: { id: equipmentId },
    include: { attachments: true, category: true }
  });
  if (!equipment) return null;
  const item = await client.romaneioCatalogItem.findFirst({
    where: { sourceType: 'EQUIPAMENTOS', sourceId: equipmentId, isActive: true },
    select: { publicToken: true }
  });
  return {
    qrUrl: item ? qrPageUrl(item.publicToken) : null,
    documents: (await listQrDocuments(client, equipment, item?.publicToken || '')).map(doc => ({
      key: doc.key,
      group: doc.group,
      label: doc.label,
      fileName: doc.attachment.fileName,
      access: accessOf(equipment.qrDocumentAccess, doc.key)
    }))
  };
}
