import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { OPERATIONAL_RESOURCES } from '../src/lib/api-credentials/operational-resources.js';
import { API_SCOPES, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { EVENT_RESOURCE_SCOPES } from '../src/lib/api-credentials/event-feed.js';
import { createIntegrationQualityRecord } from '../src/lib/qualidade/integration-create.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import qualityRouter from '../src/routes/integrations/v1/qualidade.js';
import { integrationApiBoundary } from '../src/middleware/api-request-context.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { buildPlaygroundInput } from '../../shared/schemas/playground-parameters.js';
import { phase2Database } from './helpers/omni-phase2-db.js';

const cursorKey='synthetic-phase2-cursor-key-at-least-32-characters';
const context=(extra={})=>({scopes:new Set(API_SCOPES.map(s=>s.code)),credentialId:'cred',projectAccessMode:'SELECTED',projectIds:new Set(['p1']),projectCodes:new Set(['5850']),maxPageSize:500,cursorKey,...extra});
const payload={type:'DESVIO',projectCode:'5850',eventDate:'2026-10-28',description:'Descrição fictícia',impact:'MEDIO',actionOwnerEmail:'quality@example.test',externalRef:{system:'omni',url:'https://example.test/omni',reference:'ref'}};

test('gatilhos: nove tipos, transições/no-op, datas, exclusão lógica, auditoria e rollback atômico',async()=>{
  const {db,client,rows}=await phase2Database();
  try{
    assert.equal((await rows('IntegrationEvent')).length,0);
    const legacy=(await rows('Report'))[0];
    assert.equal(new Date(legacy.submittedAt).toISOString(),'2026-01-01T00:00:00.000Z');
    assert.equal(new Date(legacy.signedAt).toISOString(),'2026-02-01T00:00:00.000Z');
    await db.exec(`
      INSERT INTO "ReportDraft" VALUES ('draft','p1');
      INSERT INTO "Report" (id,"projectId","updatedAt") VALUES ('r1','p1','2000-01-01');
      UPDATE "Report" SET status='APPROVED' WHERE id='r1';
      UPDATE "Report" SET status='RETURNED' WHERE id='r1';
      UPDATE "Report" SET status='SIGNED' WHERE id='r1';
      INSERT INTO "ProjectWorkflow" VALUES ('w1','p1','EXECUTION',NULL,NULL);
      INSERT INTO "QualityRecord" (id,origin,"projectId","createdById") VALUES ('q1','INTERNO','p1','u1');
      UPDATE "QualityRecord" SET "deletedAt"=now(),"deletedById"='u1' WHERE id='q1';
      INSERT INTO "Romaneio" (id,"projectId",type,"pdfUrl") VALUES ('out','p1','OUTBOUND','private.pdf'),('in','p1','INBOUND','private.pdf');
      UPDATE "Project" SET "operatorId"='u1' WHERE id='p1';
    `);
    const events=await rows('IntegrationEvent');
    assert.deepEqual(events.map(r=>r.type).sort(),Object.keys(EVENT_RESOURCE_SCOPES).sort());
    assert.deepEqual(events.map(r=>String(r.sequence)),events.map((_,i)=>String(i+1)));
    assert.ok(events.every(r=>/^evt_[0-9a-f-]{36}$/.test(r.id)));
    assert.equal(new Set(events.map(r=>r.id)).size,events.length);
    assert.ok(events.every(r=>r.projectId==='p1'&&r.projectCode==='5850'));
    for(const scope of new Set(Object.values(EVENT_RESOURCE_SCOPES).flat())) {
      const page=await listOperationalResources(client,'integration.events.list',{},context({scopes:new Set(['eventos.read',scope])}));
      const expected=Object.entries(EVENT_RESOURCE_SCOPES).filter(([,scopes])=>scopes.includes(scope)).map(([type])=>type);
      assert.deepEqual(page.items.map(r=>r.type).sort(),expected.sort(),scope);
    }
    const dates=(await rows('Report')).find(r=>r.id==='r1');
    for(const field of ['submittedAt','approvedAt','returnedAt','signedAt'])assert.ok(dates[field]);
    assert.ok(new Date(dates.updatedAt)>new Date('2000-01-01'));
    await db.exec(`UPDATE "Report" SET status='SIGNED' WHERE id='r1'; UPDATE "ProjectWorkflow" SET stage='EXECUTION' WHERE id='w1'; UPDATE "QualityRecord" SET "updatedAt"=now() WHERE id='q1'; UPDATE "Romaneio" SET "pdfUrl"='new.pdf' WHERE id='out'; UPDATE "Project" SET "operatorId"='u1' WHERE id='p1';`);
    assert.equal((await rows('IntegrationEvent')).length,9);
    await assert.rejects(()=>db.transaction(async tx=>{await tx.exec(`UPDATE "Report" SET status='RETURNED' WHERE id='r1'`);throw Error('rollback');}));
    assert.equal((await rows('IntegrationEvent')).length,9);
    await db.exec(`UPDATE "ProjectWorkflow" SET "leaderUserId"='u1',"plannerUserId"='u1' WHERE id='w1'`);
    assert.equal((await rows('IntegrationEvent')).length,10);
    const audit=await rows('QualityRecordAuditLog');
    assert.deepEqual(audit.map(r=>r.action),['CREATED','DELETED']);
    assert.ok(audit.every(r=>r.actorUserId==='u1'&&r.actorCredentialId===null));
    await db.transaction(async tx=>{
      await tx.exec(`UPDATE "QualityRecord" SET "updatedById"='u1' WHERE id='q1'; INSERT INTO "QualityEvidence" VALUES ('e1','q1','Uma'),('e2','q1','Duas');`);
    });
    assert.equal((await rows('IntegrationEvent')).length,11,'várias evidências e registro na mesma transação geram uma alteração');
    await db.exec(`UPDATE "QualityEvidence" SET label='Uma' WHERE id='e1'`);
    assert.equal((await rows('IntegrationEvent')).length,11,'evidência inalterada não emite');
    await db.exec(`UPDATE "QualityEvidence" SET label='Nova' WHERE id='e1'`);
    assert.equal((await rows('IntegrationEvent')).length,12,'alteração somente em evidência também emite');

    await db.exec(`UPDATE "ProjectWorkflow" SET stage='CLOSURE' WHERE id='w1'; UPDATE "ProjectWorkflow" SET stage='CLOSURE' WHERE id='w1'; UPDATE "QualityRecord" SET description='Alteração fictícia' WHERE id='q1'; UPDATE "Project" SET "operatorId"=NULL WHERE id='p1'; UPDATE "Report" SET status='PENDING' WHERE id='r1'; INSERT INTO "Romaneio" (id,"projectId",type) VALUES ('later','p1','OUTBOUND'); UPDATE "Romaneio" SET "docxUrl"='later.docx' WHERE id='later';`);
    assert.deepEqual((await rows('IntegrationEvent')).slice(12).map(r=>r.type),['workflow.etapa_alterada','qualidade.alterado','projeto.responsaveis_alterados','rdo.criado','romaneio.emitido']);
  }finally{await db.close();}
});

test('feed: cursor retoma páginas/empates e polling terminal sem perda, escopos/recorte antes de paginar, 410',async()=>{
  const {db,client}=await phase2Database();
  try{
    await db.exec(`INSERT INTO "Report" (id,"projectId") VALUES ('r1','p1'),('r2','p2'); UPDATE "Report" SET status='APPROVED' WHERE id<>'legacy'; UPDATE "Report" SET status='RETURNED' WHERE id<>'legacy'; UPDATE "IntegrationEvent" SET "occurredAt"=date_trunc('second',now());`);
    const ctx=context({scopes:new Set(['eventos.read','rdo.relatorios.read'])});
    const first=await listOperationalResources(client,'integration.events.list',{limit:1},ctx);
    assert.deepEqual(first.items.map(r=>r.type),['rdo.aprovado']);assert.equal(first.page.hasMore,false);assert.ok(first.page.nextCursor);
    assert.deepEqual(Object.keys(first.items[0]).sort(),['id','type','occurredAt','projectId','projectCode','resource','resourceId'].sort());
    const empty=await listOperationalResources(client,'integration.events.list',{cursor:first.page.nextCursor},ctx);assert.deepEqual(empty.items,[]);
    await db.exec(`UPDATE "Report" SET status='APPROVED' WHERE id='r1'`);
    const next=await listOperationalResources(client,'integration.events.list',{cursor:empty.page.nextCursor},ctx);
    assert.equal(next.items.length,1);assert.notEqual(next.items[0].id,first.items[0].id);
    assert.deepEqual((await listOperationalResources(client,'integration.events.list',{cursor:empty.page.nextCursor},ctx)).items,next.items);
    const seen=[];let cursor;
    do{const page=await listOperationalResources(client,'integration.events.list',{limit:1,...(cursor?{cursor}:{})},context());seen.push(...page.items.map(r=>r.id));cursor=page.page.nextCursor;if(!page.page.hasMore)break;}while(true);
    assert.equal(seen.length,4);assert.equal(new Set(seen).size,4);
    for(const changed of [context({credentialId:'cred2'}),context({scopes:new Set(['eventos.read'])}),context({projectAccessMode:'ALL'})])await assert.rejects(()=>listOperationalResources(client,'integration.events.list',{cursor:first.page.nextCursor},changed),e=>e.code==='INVALID_CURSOR');
    await assert.rejects(()=>listOperationalResources(client,'integration.events.list',{cursor:first.page.nextCursor+'x'},ctx),e=>e.code==='INVALID_CURSOR');
    await assert.rejects(()=>listOperationalResources(client,'integration.events.list',{cursor:first.page.nextCursor},context({...ctx,snapshotAt:new Date(Date.now()+31*86400000)})),e=>e.statusCode===410&&e.code==='CURSOR_EXPIRED');
    assert.equal((await listOperationalResources(client,'integration.events.list',{},context({scopes:new Set(['eventos.read'])}))).items.length,0);
    await assert.rejects(()=>listOperationalResources({},'integration.events.list',{},context({scopes:new Set()})),e=>e.statusCode===403);
    const future=context({...ctx,snapshotAt:new Date(Date.now()+31*86400000)});
    assert.deepEqual((await listOperationalResources(client,'integration.events.list',{},future)).items,[],'sem cursor começa na retenção');
  }finally{await db.close();}
});

test('Qualidade: idempotência concorrente, mesma resposta, conflito, FK, origem, auditoria API e evento único',async()=>{
  const {db,client,rows}=await phase2Database();
  try{
    const key=randomUUID();
    const responses=await Promise.all([createIntegrationQualityRecord(client,payload,key,context()),createIntegrationQualityRecord(client,{...payload},key,context())]);
    assert.deepEqual(responses[0],responses[1]);assert.match(responses[0].number,/^D-001\/\d{2}$/);assert.equal(responses[0].status,'EM_TRIAGEM');
    assert.deepEqual(Object.keys(responses[0]).sort(),['id','number','status','createdAt'].sort());
    const row=(await rows('QualityRecord'))[0];assert.equal(row.origin,'OMNI');assert.equal(row.natureId,null);assert.equal(row.actionOwnerUserId,'u1');assert.equal(row.actionOwner,'Qualidade fictícia');assert.deepEqual(row.externalRef,payload.externalRef);
    const audit=await rows('QualityRecordAuditLog');assert.equal(audit.length,1);assert.equal(audit[0].actorCredentialId,'cred');assert.equal(audit[0].actorUserId,null);assert.equal(audit[0].origin,'OMNI');
    assert.deepEqual((await rows('IntegrationEvent')).map(r=>r.type),['qualidade.criado']);
    assert.deepEqual(await createIntegrationQualityRecord(client,Object.fromEntries(Object.entries(payload).reverse()),key,context()),responses[0]);
    await assert.rejects(()=>createIntegrationQualityRecord(client,{...payload,description:'Outra'},key,context()),e=>e.code==='IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
    const other=await createIntegrationQualityRecord(client,payload,key,context({credentialId:'cred2'}));assert.notEqual(other.id,responses[0].id);assert.equal((await rows('IntegrationEvent')).length,2);
  }finally{await db.close();}
});

test('Qualidade: 403/404/422, usuário inativo/ambíguo, corpo/chave inválidos e falha tardia sem efeitos',async()=>{
  const {db,client,rows}=await phase2Database();
  try{
    for(const [body,key,ctx,status] of [[payload,randomUUID(),context({scopes:new Set()}),403],[{...payload,projectCode:'9999'},randomUUID(),context(),403],[{...payload,projectCode:'missing'},randomUUID(),context({projectAccessMode:'ALL'}),404],[{...payload,actionOwnerEmail:'missing@example.test'},randomUUID(),context(),422],[payload,undefined,context(),400],[payload,'bad',context(),400]])await assert.rejects(()=>createIntegrationQualityRecord(client,body,key,ctx),e=>e.statusCode===status);
    for(const extra of [{origin:'OTHER'},{type:'MELHORIA'},{eventDate:'2026-02-30'},{projectId:'p1'},{externalRef:{...payload.externalRef,url:'file:///etc/passwd'}}])await assert.rejects(()=>createIntegrationQualityRecord(client,{...payload,...extra},randomUUID(),context()));
    await db.exec(`UPDATE "User" SET "isActive"=false`);await assert.rejects(()=>createIntegrationQualityRecord(client,payload,randomUUID(),context()),e=>e.statusCode===422);
    await db.exec(`UPDATE "User" SET "isActive"=true; INSERT INTO "User" (id,email) VALUES ('u2','QUALITY@example.test')`);await assert.rejects(()=>createIntegrationQualityRecord(client,payload,randomUUID(),context()),e=>e.statusCode===422);
    assert.equal((await rows('IntegrationEvent')).length,0);assert.equal((await rows('QualityRecord')).length,0);
    await db.exec(`DELETE FROM "User" WHERE id='u2'`);
    const transaction=client.$transaction;client.$transaction=fn=>transaction(tx=>{tx.integrationQualityReceipt.create=()=>{throw Error('late failure');};return fn(tx);});
    await assert.rejects(()=>createIntegrationQualityRecord(client,payload,randomUUID(),context()),/late failure/);
    for(const table of ['IntegrationEvent','QualityRecord','QualityRecordAuditLog','QualityRecordSeq'])assert.equal((await rows(table)).length,0);
  }finally{await db.close();}
});

test('RDO: escopo independente, quatro estados, filtro múltiplo, timestamps, legado idêntico e cursor vinculado',async()=>{
  const stamp=new Date('2026-10-01T00:00:00Z');
  const rows=['PENDING','RETURNED','APPROVED','SIGNED'].map((status,i)=>({id:`r${i}`,status,projectId:'p1',project:{deletedAt:null,code:'5850',name:'Fictício'},deletedAt:null,reportType:'RDO',createdAt:stamp,updatedAt:stamp,submittedAt:stamp,returnedAt:stamp,signedAt:stamp,clientReleasedAt:stamp}));
  function matches(row,where){return Object.entries(where).every(([k,v])=>k==='AND'?v.every(part=>matches(row,part)):k==='OR'?v.some(part=>matches(row,part)):v&&typeof v==='object'&&!(v instanceof Date)?('in'in v?v.in.includes(row[k]):'lte'in v?row[k]<=v.lte&&(!v.gte||row[k]>=v.gte):'gt'in v?row[k]>v.gt:matches(row[k],v)):v instanceof Date?+row[k]===+v:row[k]===v);}
  const calls=[];const client={report:{async findMany(args){calls.push(args);return rows.filter(row=>matches(row,args.where)).slice(0,args.take);}}};
  const legacy=await listOperationalResources(client,'operational.Report.list',{},context({scopes:new Set(['rdo.relatorios.read'])}));assert.deepEqual(legacy.items.map(r=>r.status),['APPROVED']);assert.deepEqual(Object.keys(legacy.items[0]).sort(),Object.keys(OPERATIONAL_RESOURCES.find(r=>r.model==='Report').fields).sort());
  const ctx=context({scopes:new Set(['rdo.relatorios.todos.read'])});const all=await listOperationalResources(client,'operational.Report.list',{},ctx);assert.equal(all.items.length,4);
  for(const field of ['submittedAt','returnedAt','signedAt','clientReleasedAt'])assert.equal(all.items[0][field],stamp.toISOString());
  const filtered=await listOperationalResources(client,'operational.Report.list',{status:'PENDING,RETURNED',updatedSince:stamp.toISOString()},ctx);assert.deepEqual(filtered.items.map(r=>r.status),['PENDING','RETURNED']);
  await assert.rejects(()=>listOperationalResources({},'operational.Report.list',{status:'PENDING'},context({scopes:new Set(['rdo.relatorios.read'])})),e=>e.statusCode===403);
  await assert.rejects(()=>listOperationalResources({},'operational.Report.list',{status:'DRAFT'},ctx));
  await assert.rejects(()=>listOperationalResources({},'operational.Report.list',{projectId:'p2'},ctx),e=>e.statusCode===403);
  const page=await listOperationalResources(client,'operational.Report.list',{limit:1},ctx);await assert.rejects(()=>listOperationalResources({},'operational.Report.list',{cursor:page.page.nextCursor},context({scopes:new Set(['rdo.relatorios.read'])})),e=>e.code==='INVALID_CURSOR');
  assert.ok(calls.every(c=>c.select.project&&c.take<=501));
});

test('rotas reais: boundary permite POST Qualidade e guards exigem escopos, incluindo alternativo de RDO',()=>{
  let allowed=false;integrationApiBoundary()({method:'POST',originalUrl:'/api/integracoes/v1/qualidade/registros',headers:{'content-type':'application/json'}},{},()=>{allowed=true;});assert.equal(allowed,true);
  for(const [router,path,scopes,pass] of [[qualityRouter,'/registros',[],false],[qualityRouter,'/registros',['qualidade.registros.create'],true],[createOperationalRouter(),'/rdo/relatorios',['rdo.relatorios.todos.read'],true],[createOperationalRouter(),'/eventos',[],false]]){
    const route=router.stack.find(l=>l.route?.path===path&&(path!=='/registros'||l.route.methods.post)).route;let next=false;const res={setHeader(){},status(code){this.code=code;return this;},json(){}};
    route.stack[0].handle({query:{},apiAuth:{scopeCodes:new Set(scopes)}},res,()=>{next=true;});assert.equal(next,pass);if(!pass)assert.equal(res.code,403);
  }
});

test('Playground: header tipado, criação idempotente, feed, envelope e estados de RDO',async()=>{
  const {db,client}=await phase2Database();
  try{
    const op=publicApiOperations().find(o=>o.operationId==='quality.records.create');const input=buildPlaygroundInput(op,{writeMode:'LIVE',bodyJson:JSON.stringify(payload),'Idempotency-Key':randomUUID()});
    client.apiCredential={async findUnique(){return {id:'cred',projectAccessMode:'SELECTED',maxPageSize:100,requestsPerMinute:60,requestsPerDay:1000,rowsPerDay:10000,scopes:[...context().scopes].map(scopeCode=>({scopeCode})),projects:[{projectId:'p1',project:{code:'5850'}}]};}};
    const transaction=client.$transaction;client.$transaction=action=>typeof action==='function'?transaction(tx=>action({...tx,apiUsageBucket:client.apiUsageBucket})):Promise.all(action);
    client.apiUsageBucket={async upsert({create}){return {id:create.windowKind};},async updateMany(){return {count:1};},async update(){}};client.apiCredentialEvent={async create(){}};client.apiRequestLog={async create(){}};client.apiCredential.updateMany=async()=>({count:1});
    const result=await executePlaygroundOperation(client,'cred',input,{cursorKey});assert.equal(result.response.status,201);assert.equal(result.response.body.status,'EM_TRIAGEM');assert.match(result.request.curl,/Idempotency-Key:/);assert.deepEqual(result.request.headers,input.headers);
    assert.deepEqual((await executePlaygroundOperation(client,'cred',input,{cursorKey})).response.body,result.response.body);
    const feed=await executePlaygroundOperation(client,'cred',{operationId:'integration.events.list',query:{}},{cursorKey});assert.deepEqual(feed.response.body.items.map(r=>r.type),['qualidade.criado']);assert.equal(feed.response.body.schemaVersion,'1.0');
    const report=publicApiOperations().find(o=>o.operationId==='operational.Report.list');assert.deepEqual(report.scopeAlternatives,[['rdo.relatorios.todos.read']]);assert.deepEqual(report.parameters.find(p=>p.name==='status').options,['PENDING','RETURNED','APPROVED','SIGNED']);
  }finally{await db.close();}
});
