import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import AdmZip from "adm-zip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import env from "../../config/env.js";
import { convertDocxToPdf } from "../report-pdf-from-docx.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const maintenanceTemplatePath = path.resolve(
  __dirname,
  "../../../../Modelos/definitivos/Manutenção/Modelo Manutenção.docx",
);

function safeText(value) {
  return value == null ? "" : String(value);
}

function safePath(value) {
  return safeText(value)
    .replace(/[<>:"/\\|?*\n\r]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function safeXml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTextNodes(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling)
    getTextNodes(child, out);
  return out;
}

function elementText(element) {
  return getTextNodes(element)
    .map((node) => node.data || "")
    .join("");
}

function replaceTokenInElement(element, token, replacement) {
  let nodes = getTextNodes(element);
  let full = nodes.map((node) => node.data || "").join("");
  let index = full.indexOf(token);
  while (index >= 0) {
    const end = index + token.length;
    let offset = 0;
    let inserted = false;
    for (const node of nodes) {
      const source = node.data || "";
      const overlapStart = Math.max(offset, index);
      const overlapEnd = Math.min(offset + source.length, end);
      if (overlapStart < overlapEnd) {
        const localStart = overlapStart - offset;
        const localEnd = overlapEnd - offset;
        node.data = inserted
          ? `${source.slice(0, localStart)}${source.slice(localEnd)}`
          : `${source.slice(0, localStart)}${replacement}${source.slice(localEnd)}`;
        inserted = true;
      }
      offset += source.length;
    }
    nodes = getTextNodes(element, []);
    full = nodes.map((node) => node.data || "").join("");
    index = full.indexOf(token);
  }
}

function replacePlaceholders(element, values) {
  Object.entries(values).forEach(([key, value]) => {
    const replacement = safeText(value);
    if (key === "tag") replaceTokenInElement(element, "{{tag}}}", replacement);
    [`{{${key}}}`, `{{ ${key} }}`, `{{${key} }}`, `{{ ${key}}}`].forEach(
      (token) => replaceTokenInElement(element, token, replacement),
    );
  });
}

function findFirstByText(root, tagName, token) {
  return (
    Array.from(root.getElementsByTagName(tagName)).find((node) =>
      elementText(node).includes(token),
    ) || null
  );
}

function closestAncestor(node, tagName) {
  let current = node;
  while (current) {
    if (current.nodeName === tagName) return current;
    current = current.parentNode;
  }
  return null;
}

function removeNode(node) {
  if (node?.parentNode) node.parentNode.removeChild(node);
}

function cloneRows(doc, token, rows, valuesForRow) {
  const templateRow = findFirstByText(doc, "w:tr", token);
  if (!templateRow) return;
  const parent = templateRow.parentNode;
  rows.forEach((row, index) => {
    const clone = templateRow.cloneNode(true);
    replacePlaceholders(clone, valuesForRow(row, index));
    parent.insertBefore(clone, templateRow);
  });
  const table = templateRow.parentNode;
  removeNode(templateRow);
  if (
    !rows.length &&
    table &&
    !Array.from(table.getElementsByTagName("w:tr")).length
  )
    removeNode(table);
}

function nextRelId(relsDoc) {
  let max = 0;
  Array.from(relsDoc.getElementsByTagName("Relationship")).forEach((node) => {
    const match = String(node.getAttribute("Id") || "").match(/^rId(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `rId${max + 1}`;
}

function ensureContentType(zip, extension, mimeType) {
  const entry = zip.getEntry("[Content_Types].xml");
  if (!entry) return;
  const doc = new DOMParser().parseFromString(
    zip.readAsText(entry),
    "text/xml",
  );
  const exists = Array.from(doc.getElementsByTagName("Default")).some(
    (node) =>
      String(node.getAttribute("Extension") || "").toLowerCase() ===
      extension.toLowerCase(),
  );
  if (!exists) {
    const node = doc.createElement("Default");
    node.setAttribute("Extension", extension.toLowerCase());
    node.setAttribute("ContentType", mimeType);
    doc.documentElement.appendChild(node);
    zip.updateFile(
      entry.entryName,
      Buffer.from(new XMLSerializer().serializeToString(doc), "utf8"),
    );
  }
}

function addImageRelationship(zip, relsDoc, asset, prefix) {
  const relId = nextRelId(relsDoc);
  const extension =
    asset.extension || (asset.mimeType === "image/png" ? "png" : "jpg");
  const mediaName = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  zip.addFile(`word/media/${mediaName}`, asset.bytes);
  ensureContentType(zip, extension, asset.mimeType || `image/${extension}`);
  const relation = relsDoc.createElement("Relationship");
  relation.setAttribute("Id", relId);
  relation.setAttribute(
    "Type",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  );
  relation.setAttribute("Target", `media/${mediaName}`);
  relsDoc.documentElement.appendChild(relation);
  return relId;
}

function inlineImageXml(relId, cx, cy, name, drawingId) {
  const label = safeXml(name || "Imagem");
  return `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="${label}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${label}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function appendImageRun(doc, paragraph, relId, asset, widthEmu, drawingId) {
  const width = Math.max(1, Number(asset.width) || 1);
  const height = Math.max(1, Number(asset.height) || 1);
  const heightEmu = Math.max(1, Math.round(widthEmu * (height / width)));
  const drawing = new DOMParser().parseFromString(
    inlineImageXml(relId, widthEmu, heightEmu, asset.label, drawingId),
    "text/xml",
  );
  paragraph.appendChild(
    doc.importNode
      ? doc.importNode(drawing.documentElement, true)
      : drawing.documentElement,
  );
}

function embedImages(zip, doc, model) {
  const relsEntry = zip.getEntry("word/_rels/document.xml.rels");
  if (!relsEntry) return;
  const relsDoc = new DOMParser().parseFromString(
    zip.readAsText(relsEntry),
    "text/xml",
  );
  let drawingId = 7000;

  const photosParagraph = findFirstByText(doc, "w:p", "{{fotos}}");
  if (photosParagraph) {
    const photosRow = closestAncestor(photosParagraph, "w:tr");
    const photosTable = closestAncestor(photosParagraph, "w:tbl");
    if (!model.photos?.length) {
      removeNode(photosRow || photosParagraph);
      if (
        photosTable &&
        !Array.from(photosTable.getElementsByTagName("w:tr")).length
      )
        removeNode(photosTable);
    } else {
      const cell = closestAncestor(photosParagraph, "w:tc");
      if (cell) {
        while (cell.firstChild) cell.removeChild(cell.firstChild);
        for (let index = 0; index < model.photos.length; index += 2) {
          const rowParagraph = doc.createElement("w:p");
          const pPr = doc.createElement("w:pPr");
          const align = doc.createElement("w:jc");
          align.setAttribute("w:val", "center");
          pPr.appendChild(align);
          rowParagraph.appendChild(pPr);
          model.photos.slice(index, index + 2).forEach((asset) => {
            const relId = addImageRelationship(
              zip,
              relsDoc,
              asset,
              "maintenance-photo",
            );
            appendImageRun(
              doc,
              rowParagraph,
              relId,
              asset,
              2857500,
              (drawingId += 1),
            );
          });
          cell.appendChild(rowParagraph);
        }
      }
    }
  }

  const signatureParagraph = findFirstByText(doc, "w:p", "{{assinatura}}");
  if (signatureParagraph) {
    replaceTokenInElement(signatureParagraph, "{{assinatura}}", "");
    if (model.supervisorSignature?.bytes?.length) {
      const relId = addImageRelationship(
        zip,
        relsDoc,
        model.supervisorSignature,
        "maintenance-signature",
      );
      appendImageRun(
        doc,
        signatureParagraph,
        relId,
        model.supervisorSignature,
        1905000,
        (drawingId += 1),
      );
    }
  }

  zip.updateFile(
    relsEntry.entryName,
    Buffer.from(new XMLSerializer().serializeToString(relsDoc), "utf8"),
  );
}

function appendObservationsWhenTemplateHasNoToken(doc, observations) {
  if (!observations || elementText(doc).includes("{{observacoes}}")) return;
  const paragraph = Array.from(doc.getElementsByTagName("w:p")).find((node) =>
    /Observa[cç][oõ]es\s*:/i.test(elementText(node)),
  );
  if (!paragraph) return;
  const run = doc.createElement("w:r");
  const text = doc.createElement("w:t");
  text.appendChild(doc.createTextNode(` ${observations}`));
  run.appendChild(text);
  paragraph.appendChild(run);
}

function clearRemainingPlaceholders(xml) {
  return xml.replace(/\{\{[^}]+\}\}\}?/g, "");
}

export async function buildMaintenanceDocx(model, options = {}) {
  const templateBytes =
    options.templateBytes ||
    (await fs.readFile(options.templatePath || maintenanceTemplatePath));
  const zip = new AdmZip(templateBytes);
  const xmlEntries = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) =>
      /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name),
    );

  for (const entryName of xmlEntries) {
    const entry = zip.getEntry(entryName);
    const doc = new DOMParser().parseFromString(
      zip.readAsText(entry),
      "text/xml",
    );
    const isDocument = /document\.xml$/i.test(entryName);
    if (isDocument) {
      cloneRows(doc, "{{ITEM}}", model.services || [], (service, index) => ({
        ITEM: index + 1,
        serviço: service,
      }));
      cloneRows(
        doc,
        "{{serviço_terceiro}}",
        model.thirdPartyServices || [],
        (service) => ({
          local: service.location,
          serviço_terceiro: service.description,
          data_terceiro: service.date,
          data_terceiros: service.date,
          data: service.date,
        }),
      );
      appendObservationsWhenTemplateHasNoToken(doc, model.observations || "");
      embedImages(zip, doc, model);
    }
    replacePlaceholders(doc, {
      responsavel: model.responsible,
      data: model.date,
      EQUIPAMENTO: model.equipmentName,
      equipamento: model.equipmentName,
      tag: model.equipmentCode,
      observacoes: model.observations,
      supervisor: model.supervisorName,
      assinatura: "",
    });
    zip.updateFile(
      entryName,
      Buffer.from(
        clearRemainingPlaceholders(new XMLSerializer().serializeToString(doc)),
        "utf8",
      ),
    );
  }

  return zip.toBuffer();
}

export function maintenanceDocumentFileName(record) {
  const date =
    record?.maintenanceDate instanceof Date
      ? record.maintenanceDate.toISOString().slice(0, 10)
      : safeText(record?.maintenanceDate).slice(0, 10);
  const base = safePath(
    `Manutenção - ${record?.equipment?.code || ""} - ${date}`,
  );
  return `${base || "Manutenção"}.pdf`;
}

export async function generateMaintenancePdf(model, options = {}) {
  const docxBytes = await buildMaintenanceDocx(model, options);
  const tmpDir = path.join(env.uploadDir, "Equipamentos", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const docxPath = path.join(tmpDir, `maintenance-${stamp}.docx`);
  const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");
  await fs.writeFile(docxPath, docxBytes);
  try {
    await convertDocxToPdf(docxPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(docxPath, { force: true }).catch(() => {});
    await fs.rm(pdfPath, { force: true }).catch(() => {});
  }
}
