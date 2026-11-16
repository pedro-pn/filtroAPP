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

// Guarda só o que foge do padrão (LOGIN/HIDDEN) e só chaves em formato conhecido.
export function normalizeQrAccess(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, mode] of Object.entries(value).slice(0, MAX_ACCESS_KEYS)) {
    const validKey = ['manual', 'datasheet', 'certificate'].includes(key) || /^doc:[A-Za-z0-9_-]{1,64}$/.test(key);
    if (validKey && ACCESS_VALUES.has(mode) && mode !== QrAccess.PUBLIC) out[key] = mode;
  }
  return out;
}

export function accessOf(accessMap, key) {
  const mode = accessMap?.[key];
  return ACCESS_VALUES.has(mode) ? mode : QrAccess.PUBLIC;
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
    include: { attachments: true, category: { select: { name: true } } }
  });
  if (!equipment?.isActive) return null;
  return { item, equipment };
}

export function downloadPathFor(token, key) {
  return `/api/equipamentos-qr/${encodeURIComponent(token)}/documentos/${encodeURIComponent(key)}/arquivo`;
}

// Conteúdo da página pública (sem ids internos): documentos ocultos não aparecem; os que exigem login
// aparecem sem URL pública.
export async function buildPublicQrPage(client, token) {
  const target = await resolveQrTarget(client, token);
  if (!target) return null;
  const { item, equipment } = target;
  const accessMap = equipment?.qrDocumentAccess || {};
  const documents = equipment
    ? listEquipmentQrDocuments(equipment.attachments)
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
        downloadPath: access === QrAccess.LOGIN ? downloadPathFor(item.publicToken, doc.key) : null
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
export async function resolveQrDownload(client, token, key) {
  const target = await resolveQrTarget(client, token);
  if (!target?.equipment) return null;
  const doc = listEquipmentQrDocuments(target.equipment.attachments).find(entry => entry.key === key);
  if (!doc) return null;
  if (accessOf(target.equipment.qrDocumentAccess, key) === QrAccess.HIDDEN) return null;
  return resolvePublicEquipmentAttachment(doc.attachment.publicToken);
}

// Painel de configuração (Equipamentos): link e documentos com o acesso atual.
export async function buildQrLinkSettings(client, equipmentId) {
  const equipment = await client.companyEquipment.findUnique({
    where: { id: equipmentId },
    include: { attachments: true }
  });
  if (!equipment) return null;
  const item = await client.romaneioCatalogItem.findFirst({
    where: { sourceType: 'EQUIPAMENTOS', sourceId: equipmentId, isActive: true },
    select: { publicToken: true }
  });
  return {
    qrUrl: item ? qrPageUrl(item.publicToken) : null,
    documents: listEquipmentQrDocuments(equipment.attachments).map(doc => ({
      key: doc.key,
      group: doc.group,
      label: doc.label,
      fileName: doc.attachment.fileName,
      access: accessOf(equipment.qrDocumentAccess, doc.key)
    }))
  };
}
