// Populated states for the final page inventory. Only the disposable runner DB.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const fixturePath=path.join(root,'output/validation/redesign-fixture.json');
const f=JSON.parse(await readFile(fixturePath,'utf8'));
const url=new URL(f.databaseUrl);
if(!url.pathname.startsWith('/filtrovali_redesign_validation_')||!['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Isolated local database required.');
process.env.DATABASE_URL=f.databaseUrl;
const {default:prisma}=await import('../../src/lib/prisma.js');
const plan=await prisma.efetivoPlan.findFirst({where:{kind:'OFFICIAL',status:'ACTIVE'}})||await prisma.efetivoPlan.create({data:{kind:'OFFICIAL',status:'ACTIVE',name:'Planejamento oficial'}});
const participant=await prisma.collaborator.findUniqueOrThrow({where:{code:'VAL-002'}});
await prisma.efetivoMissionPlan.upsert({where:{planId_projectId:{planId:plan.id,projectId:f.project.id}},update:{},create:{planId:plan.id,projectId:f.project.id,scheduleStatus:'CONFIRMED',stage:'EXECUTION',headquartersResponsibleUserId:f.user.id,headquartersResponsibleName:f.user.name,headquartersResponsibleRole:'Gestão',mobilizationDate:new Date('2026-10-01'),executionStartDate:new Date('2026-10-02'),executionEndDate:new Date('2026-10-16'),returnDate:new Date('2026-10-17'),demands:{create:{jobRoleId:participant.jobRoleId,requiredCount:1}},allocations:{create:{collaboratorId:participant.id,jobRoleId:participant.jobRoleId,jobRoleNameSnapshot:'Técnico Validação'}}}});
const romaneio=await prisma.romaneio.findFirst({orderBy:{createdAt:'desc'}});f.romaneioId=romaneio?.id;
async function api(method,pathname,data){
  const response=await fetch(`http://127.0.0.1:${f.port}/api/assinaturas${pathname}`,{method,headers:{Authorization:`Bearer ${f.tokens.admin}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  if(!response.ok)throw new Error(`Fixture API ${method} ${pathname}: ${response.status}`);
  return response.json();
}
const pdf=await PDFDocument.create();const page=pdf.addPage([595,842]);const font=await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('FILTROVALI - DOCUMENTO DE VALIDACAO',{x:48,y:775,size:18,font});
page.drawText('Documento ficticio no banco isolado do redesign.',{x:48,y:740,size:12,font});
const pdfDataUrl=`data:application/pdf;base64,${Buffer.from(await pdf.save()).toString('base64')}`;
if(!f.signatureDraftId){const draft=await api('POST','/documentos',{fileName:'validacao.pdf',title:'Documento de validação com nome extenso',pdfDataUrl});f.signatureDraftId=draft.id;}
if(!f.signaturePublishedId){
  const published=await api('POST','/documentos',{fileName:'convite-validacao.pdf',title:'Documento publicado para conferência',pdfDataUrl});
  const signed=await api('PUT',`/documentos/${published.id}/assinantes`,[{name:'Assinante Validação',email:'signer@example.invalid',position:1}]);
  const signer=signed.signers[0];await api('PUT',`/documentos/${published.id}/campos`,[{signerId:signer.id,pageNumber:1,x:.1,y:.75,width:.45,height:.12}]);
  await api('POST',`/documentos/${published.id}/publicar`,{expiresInDays:15});
  const invitation=await api('GET',`/documentos/${published.id}/assinantes/${signer.id}/link`);
  const link=new URL(invitation.url);f.signaturePublishedId=published.id;f.signaturePublicPath=link.pathname+link.hash;
}
await writeFile(fixturePath,JSON.stringify(f),{mode:0o600});await prisma.$disconnect();
console.log('Final fixtures ready: allocated mission, Romaneio edit, PDF setup, published document and public invitation.');
