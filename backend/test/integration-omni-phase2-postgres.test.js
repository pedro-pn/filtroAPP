import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { createIntegrationQualityRouter } from '../src/routes/integrations/v1/qualidade.js';
import { createIntegrationQualityRecord } from '../src/lib/qualidade/integration-create.js';

// Somente banco descartável explicitamente indicado, com schema completo migrado.
// Não usa DATABASE_URL do ambiente de desenvolvimento/produção.
test('PostgreSQL completo: Bearer HTTP, migração, Prisma, idempotência concorrente e ordem de commit', {
  skip: !process.env.TEST_OMNI_PHASE2_DATABASE_URL
}, async t => {
  const url=process.env.TEST_OMNI_PHASE2_DATABASE_URL;
  assert.match(new URL(url).pathname,/^\/omni_phase2_test(?:_|$)/);
  const pool=new pg.Pool({connectionString:url,max:8});
  const prisma=new PrismaClient({adapter:new PrismaPg(pool,{disposeExternalPool:true})});
  const key='synthetic-postgres-omni-hmac-key-at-least-32';
  const envConfig={apiTokenGlobalMaxPageSize:500,apiTokenHashKeys:{1:key},apiTokenActiveKeyVersion:1};
  const suffix=randomUUID();
  let server;
  t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();});
  const user=await prisma.user.create({data:{username:`omni-${suffix}`,name:'Qualidade fictícia',email:`omni-${suffix}@example.test`,passwordHash:'synthetic',role:'MANAGER',accountType:'ADMIN'}});
  const project=await prisma.project.create({data:{code:`omni-${suffix}`,name:'Projeto fictício',clientName:'Cliente',clientCnpj:'12345678000195',contractCode:'synthetic',location:'Itajaí'}});
  const other=await prisma.project.create({data:{code:`other-${suffix}`,name:'Outro projeto',clientName:'Cliente',clientCnpj:'12345678000195',contractCode:'synthetic',location:'Itajaí'}});
  const scopes=['eventos.read','rdo.relatorios.todos.read','qualidade.registros.create','qualidade.registros.read'];
  const issue=async scopeCodes=>{
    const token=createApiToken({key});
    const credential=await prisma.apiCredential.create({data:{selector:token.selector,secretVerifier:token.verifier,hashKeyVersion:1,secretLastFour:token.secretLastFour,
      name:'Omni teste',purpose:'Validação isolada',recipientName:'Teste',startsAt:new Date(0),projectAccessMode:'SELECTED',createdByUserId:user.id,issuanceRequestId:randomUUID(),maxPageSize:500,
      scopes:{create:scopeCodes.map(scopeCode=>({scopeCode,grantedByUserId:user.id}))},projects:{create:{projectId:project.id,grantedByUserId:user.id}}}});
    return {token:token.token,credential};
  };
  const auth=await issue(scopes);
  const app=express();
  app.use(apiRequestContext(),integrationApiBoundary(),express.json());
  app.use(createApiTokenAuthenticator({prismaClient:prisma,envConfig}));
  app.use('/api/integracoes/v1/qualidade',createIntegrationQualityRouter({prismaClient:prisma,envConfig}));
  app.use('/api/integracoes/v1',createOperationalRouter({prismaClient:prisma,envConfig}));
  const errors=[];
  app.use((error,req,res,next)=>{errors.push(error);next(error);});
  app.use(integrationApiErrorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/integracoes/v1`;
  const request=async(path,{token=auth.token,method='GET',body,idempotencyKey}={})=>{
    const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const body={type:'DESVIO',projectId:project.id,eventDate:'2026-10-28',description:'Mobilização adiada: exemplo fictício.',impact:'MEDIO',actionOwnerEmail:user.email,externalRef:{system:'omni',url:'https://example.test/omni',reference:suffix}};
  const idempotencyKey=randomUUID();
  const received=await Promise.all([request('/qualidade/registros',{method:'POST',body,idempotencyKey}),request('/qualidade/registros',{method:'POST',body,idempotencyKey})]);
  assert.equal(received[0].status,201,JSON.stringify(errors.map(e=>({message:e.message,code:e.code,meta:e.meta}))));assert.deepEqual(received[0],received[1],JSON.stringify(errors.map(e=>({message:e.message,code:e.code,meta:e.meta}))));
  assert.equal(await prisma.qualityRecord.count({where:{projectId:project.id}}),1);
  assert.equal(await prisma.integrationEvent.count({where:{resourceId:received[0].body.id,type:'qualidade.criado'}}),1);
  assert.equal((await prisma.qualityRecordAuditLog.findFirst({where:{recordId:received[0].body.id}})).actorCredentialId,auth.credential.id);
  assert.equal((await request('/qualidade/registros',{method:'POST',body:{...body,description:'Diferente'},idempotencyKey})).status,409);
  assert.equal((await request('/qualidade/registros',{method:'POST',body:{...body,projectId:other.id},idempotencyKey:randomUUID()})).status,403);
  assert.equal((await request('/qualidade/registros',{method:'POST',body:{...body,actionOwnerEmail:'missing@example.test'},idempotencyKey:randomUUID()})).status,422);
  const denied=await issue(['eventos.read']);assert.equal((await request('/qualidade/registros',{token:denied.token,method:'POST',body,idempotencyKey:randomUUID()})).status,403);
  const report=await prisma.report.create({data:{projectId:project.id,reportDate:new Date(),arrivalTime:'08:00',departureTime:'17:00',lunchBreak:'01:00',daytimeCount:1}});
  const states=await request('/rdo/relatorios');assert.equal(states.status,200);assert.equal(states.body.items[0].status,'PENDING');assert.ok(states.body.items[0].submittedAt);
  assert.equal((await request('/rdo/relatorios?status=APPROVED')).body.items.length,0);
  await prisma.report.update({where:{id:report.id},data:{status:'APPROVED'}});
  const legacy=await issue(['rdo.relatorios.read']);const old=await request('/rdo/relatorios',{token:legacy.token});assert.equal(old.body.items[0].status,'APPROVED');assert.equal('submittedAt'in old.body.items[0],false);
  const feed=await request('/eventos');assert.equal(feed.status,200);assert.equal(feed.body.schemaVersion,'1.0');assert.deepEqual(feed.body.items.map(r=>r.type),['qualidade.criado','rdo.criado','rdo.aprovado']);
  assert.equal((await request('/eventos?cursor='+encodeURIComponent(feed.body.page.nextCursor))).body.items.length,0);
  assert.equal((await request('/eventos',{token:denied.token})).body.items.length,0);
  let evidence;
  await prisma.$transaction(async tx=>{
    await tx.qualityRecord.update({where:{id:received[0].body.id},data:{updatedById:user.id}});
    evidence=await tx.qualityEvidence.create({data:{recordId:received[0].body.id,kind:'LINK',url:'https://example.test/first'}});
    await tx.qualityEvidence.create({data:{recordId:received[0].body.id,kind:'LINK',url:'https://example.test/second'}});
  });
  await prisma.qualityEvidence.update({where:{id:evidence.id},data:{label:'Nova identificação'}});
  const baseline=await request('/eventos?cursor='+encodeURIComponent(feed.body.page.nextCursor));
  assert.deepEqual(baseline.body.items.map(r=>r.type),['qualidade.alterado','qualidade.alterado']);
  assert.equal((await prisma.qualityRecordAuditLog.findMany({where:{recordId:received[0].body.id,action:'UPDATED'}})).length,2);


  // Conn A bloqueia o contador antes de B. B não pode confirmar uma sequência
  // maior e aparecer no polling antes da menor, mesmo modificando outro recurso.
  const a=await pool.connect(),b=await pool.connect();
  try{
    await a.query('BEGIN');await a.query('SELECT integration_emit($1,$2,$3,$4)',['rdo.criado',project.id,'rdo','race-a']);
    const hidden=await request('/eventos?cursor='+encodeURIComponent(baseline.body.page.nextCursor));assert.equal(hidden.body.items.length,0);
    await b.query('BEGIN');
    const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending=b.query('SELECT integration_emit($1,$2,$3,$4)',['rdo.criado',project.id,'rdo','race-b']);
    let blocked=false;
    for(let i=0;i<100;i++){
      const state=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if(state?.wait_event_type==='Lock'){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(blocked,true,'segunda conexão aguarda a confirmação da primeira');
    await a.query('COMMIT');await pending;await b.query('COMMIT');
    const resumed=await request('/eventos?cursor='+encodeURIComponent(hidden.body.page.nextCursor));assert.deepEqual(resumed.body.items.map(r=>r.resourceId),['race-a','race-b']);
  }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
  const ctx={credentialId:auth.credential.id,scopes:new Set(scopes),projectAccessMode:'SELECTED',projectIds:new Set([project.id]),projectCodes:new Set([project.code])};
  await assert.rejects(()=>createIntegrationQualityRecord(prisma,{...body,actionOwnerEmail:'missing@example.test'},randomUUID(),ctx),e=>e.statusCode===422);
});
