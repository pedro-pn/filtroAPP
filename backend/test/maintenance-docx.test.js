import assert from "node:assert/strict";
import test from "node:test";

import AdmZip from "adm-zip";

import { buildMaintenanceDocx } from "../src/lib/operational-reports/maintenance-docx.js";

function fixtureTemplate() {
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    ),
  );
  zip.addFile(
    "word/_rels/document.xml.rels",
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    ),
  );
  zip.addFile(
    "word/document.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>{{responsavel}} | {{data}} | {{EQUIPAMENTO}} | {{tag}}}</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{ITEM}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{serviço}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{local}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{serviço_terceiro}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{data_terceiro}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{fotos}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>Observações: {{observacoes}}</w:t></w:r></w:p>
      <w:p><w:r><w:t>{{assinatura}}</w:t></w:r></w:p><w:p><w:r><w:t>{{supervisor}}</w:t></w:r></w:p>
    </w:body></w:document>`),
  );
  return zip.toBuffer();
}

function visibleText(buffer) {
  return new AdmZip(buffer)
    .readAsText("word/document.xml")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("maintenance DOCX expands checklist and third parties and snapshots supervisor", async () => {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const result = await buildMaintenanceDocx(
    {
      responsible: "Maria Técnica",
      date: "03/09/2026",
      equipmentName: "Unidade de Filtração",
      equipmentCode: "UFI 001",
      services: ["Pintura", "Teste"],
      thirdPartyServices: [
        { location: "Oficina A", description: "Usinagem", date: "02/09/2026" },
        { location: "Oficina B", description: "Solda", date: "03/09/2026" },
      ],
      observations: "Sem vazamentos.",
      photos: [
        {
          bytes: onePixelPng,
          mimeType: "image/png",
          extension: "png",
          width: 1,
          height: 1,
          label: "Foto 1",
        },
      ],
      supervisorName: "João Supervisor",
      supervisorSignature: {
        bytes: onePixelPng,
        mimeType: "image/png",
        extension: "png",
        width: 1,
        height: 1,
        label: "Assinatura",
      },
    },
    { templateBytes: fixtureTemplate() },
  );

  const text = visibleText(result);
  assert.match(
    text,
    /Maria Técnica.*03\/09\/2026.*Unidade de Filtração.*UFI 001/,
  );
  assert.match(text, /1.*Pintura.*2.*Teste/);
  assert.match(
    text,
    /Oficina A.*Usinagem.*02\/09\/2026.*Oficina B.*Solda.*03\/09\/2026/,
  );
  assert.match(text, /Observações: Sem vazamentos/);
  assert.match(text, /João Supervisor/);
  assert.doesNotMatch(text, /\{\{/);

  const zip = new AdmZip(result);
  assert.equal(
    zip
      .getEntries()
      .filter((entry) => entry.entryName.startsWith("word/media/")).length,
    2,
  );
});

test("maintenance DOCX removes optional photo/third-party blocks when empty", async () => {
  const result = await buildMaintenanceDocx(
    {
      responsible: "Maria",
      date: "03/09/2026",
      equipmentName: "Bomba",
      equipmentCode: "UBP 001",
      services: ["Teste"],
      thirdPartyServices: [],
      observations: "",
      photos: [],
      supervisorName: "Supervisor",
      supervisorSignature: null,
    },
    { templateBytes: fixtureTemplate() },
  );
  const text = visibleText(result);
  assert.doesNotMatch(text, /\{\{|Oficina|serviço_terceiro|fotos/);
  assert.match(text, /1.*Teste/);
});

test("official maintenance template accepts the corrected placeholders", async () => {
  const result = await buildMaintenanceDocx({
    responsible: "Responsável do teste",
    date: "03/09/2026",
    equipmentName: "Equipamento do teste",
    equipmentCode: "TAG 001",
    services: ["Pintura", "Teste"],
    thirdPartyServices: [
      { location: "Oficina", description: "Solda", date: "03/09/2026" },
    ],
    observations: "Observação do teste.",
    photos: [],
    supervisorName: "Supervisor do teste",
    supervisorSignature: null,
  });
  const text = visibleText(result);
  assert.match(text, /Responsável do teste/);
  assert.match(text, /Equipamento do teste/);
  assert.match(text, /1.*Pintura.*2.*Teste/);
  assert.match(text, /Oficina.*Solda.*03\/09\/2026/);
  assert.match(text, /Supervisor do teste/);
  assert.doesNotMatch(text, /\{\{/);
});
