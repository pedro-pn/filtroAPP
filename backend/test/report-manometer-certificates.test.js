import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const [{ default: prisma }, { listManometersCompat }, { resolveReportManometers }, { buildRtpDocx }] = await Promise.all([
  import('../src/lib/prisma.js'), import('../src/lib/equipment-compat.js'),
  import('../src/lib/report-equipment-resolve.js'), import('../src/lib/report-rtp.js')
]);

for (const key of ['calibrationCertCode', 'calibrationcertcode']) {
  test(`manometer selection and RTP retain the certificate number and link from ${key}`, async t => {
    const equipment = {
      id: 'manometer-174', code: 'MAN-174', attributes: { scale: '0–20 bar', [key]: 'LP-677-174' },
      calibratedAt: new Date('2026-09-15'), expiresAt: new Date('2027-09-15'),
      attachments: [{ id: 'certificate-174', kind: 'CALIBRATION_CERTIFICATE', fileName: 'certificate.pdf',
        mimeType: 'application/pdf', publicToken: 'certificate-token-174', createdAt: new Date('2026-09-29') }]
    };
    const findMany = prisma.companyEquipment.findMany;
    prisma.companyEquipment.findMany = async () => [equipment];
    t.after(() => { prisma.companyEquipment.findMany = findMany; });

    const [selected] = await listManometersCompat();
    assert.equal(selected.calibrationCertCode, 'LP-677-174');
    const [resolved] = await resolveReportManometers(prisma, [equipment.id]);
    assert.equal(resolved.calibrationCertCode, 'LP-677-174');
    assert.equal(resolved.currentCalibrationCertificate.id, 'certificate-174');

    const zip = new AdmZip(await buildRtpDocx({
      reportType: 'RTP', sequenceNumber: 1, reportDate: '2026-10-24',
      project: { code: 'TEST', name: 'Teste', operator: {} },
      specialConditions: { resolvedManometers: [{
        ...resolved, certCode: resolved.calibrationCertCode, certificate: resolved.currentCalibrationCertificate
      }] }
    }));
    const document = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
    const link = Array.from(document.getElementsByTagName('w:fldSimple'))
      .find(node => node.textContent === 'LP-677-174');
    assert.ok(link, 'the certificate number must be a clickable link in the generated report');
    assert.equal(link.getAttribute('w:instr'), `HYPERLINK "${resolved.currentCalibrationCertificate.publicUrl}"`);
  });
}
