import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { makeReductionFormSchema, reductionDefaults, rotationDefaults, buildReductionPayload, makeActionConfirmationSchema } from '../../shared/schemas/api-credential-lifecycle.js';
import { nextAdminSearch, resolveSelectedCredential } from '../src/components/admin/api-tokens/apiAdminNavigation.ts';
import { failedPlaygroundResult, isDownloadCheckResult } from '../src/components/admin/api-tokens/apiRequestFormatting.ts';

const credential = { id:'selected', name:'Teste', purpose:'Consultar registros', recipientName:'Equipe', startsAt:'2026-09-01T12:00:00Z', expiresAt:'2027-01-01T12:00:00Z', version:2, scopeCodes:['qualidade.registros.read','qualidade.excluidos.read'], projectAccess:{mode:'SELECTED',projectIds:['p1','p2']},allowedIpCidrs:['203.0.113.0/24'],allowedFormats:['JSON'],limits:{requestsPerMinute:60,requestsPerDay:1000,rowsPerDay:10000,maxPageSize:100} };

test('reduction validates all policy fields and cannot silently expand privileges', () => {
  const initial = {...reductionDefaults(credential), reason:'Restringir integração'};
  const schema=makeReductionFormSchema(z,credential);
  assert.equal(schema.safeParse(initial).success,true);
  for(const patch of [{scopeCodes:[]},{scopeCodes:['estoque.itens.read']},{projectAccess:{mode:'ALL',projectIds:[]}},{projectAccess:{mode:'SELECTED',projectIds:['p3']}},{allowedIpCidrs:[]},{allowedIpCidrs:['203.0.114.0/24']},{limits:{...credential.limits,maxPageSize:101}},{reason:'curta'},{expiresAt:'2030-01-01T12:00'}]) assert.equal(schema.safeParse({...initial,...patch}).success,false,JSON.stringify(patch));
  const payload=buildReductionPayload(schema.parse({...initial,scopeCodes:['qualidade.registros.read'],projectAccess:{mode:'SELECTED',projectIds:['p1']},limits:{...credential.limits,maxPageSize:50}}));
  assert.equal(payload.expectedVersion,2);assert.equal(payload.limits.maxPageSize,50);assert.deepEqual(payload.scopeCodes,['qualidade.registros.read']);
  assert.equal(new Date(payload.expiresAt).getTime(),new Date(credential.expiresAt).getTime());
});

test('rotation copies the public policy but never auto-confirms perpetual access or copies identifiers', () => {
  const value=rotationDefaults({...credential,expiresAt:null},new Date('2026-09-08T12:00:00Z'));
  assert.equal(value.expiresAt,null);assert.equal(value.neverExpiresConfirmation,'');assert.equal(value.id,undefined);
  assert.deepEqual(value.scopeCodes,credential.scopeCodes);
  const schema=makeActionConfirmationSchema(z,'rotate');
  assert.equal(schema.safeParse({reason:'Renovar integração',confirmation:'ROTACIONAR',overlapMinutes:15}).success,true);
  for(const patch of [{reason:''},{confirmation:''},{overlapMinutes:61}]) assert.equal(schema.safeParse({reason:'Renovar integração',confirmation:'ROTACIONAR',overlapMinutes:15,...patch}).success,false);
});

test('URL navigation retains explicit identities and drops secrets/incompatible cursors', () => {
  const current=new URLSearchParams('etapa=credenciais&credential=selected&detail=selected&cursor=c1&eventCursor=e1&token=never');
  const next=nextAdminSearch(current,{q:'nova busca'});
  assert.equal(next.get('cursor'),null);assert.equal(next.get('credential'),'selected');assert.equal(next.get('token'),null);
  const detail=nextAdminSearch(current,{detail:'second'});assert.equal(detail.get('eventCursor'),null);
  assert.equal(resolveSelectedCredential('missing',[credential],undefined),null);
  assert.equal(resolveSelectedCredential('selected',[],credential),credential);
  assert.equal(resolveSelectedCredential('',[credential],undefined),null);
});

test('failed tests retain only safe diagnostics and never become successful download checks', () => {
  const failed=failedPlaygroundResult({status:429,code:'RATE_LIMITED',message:'Limite atingido.',requestId:'synthetic-request'},7);
  assert.equal(failed.response.status,429);assert.equal(failed.response.requestId,'synthetic-request');assert.equal(failed.response.body.code,'RATE_LIMITED');
  assert.equal(failed.response.body.kind,undefined);assert.equal(failed.request,null);
  const network=failedPlaygroundResult(new Error('Falha de rede'),1);assert.equal(network.response.status,null);assert.equal(network.response.requestId,null);
  for (const status of [400,403,404,409,429,500,503]) {
    const result = failedPlaygroundResult({status,code:'REQUEST_FAILED',message:'Mensagem segura.',requestId:'synthetic-request'},2);
    assert.equal(result.response.status,status);assert.equal(result.response.requestId,'synthetic-request');
    assert.equal(isDownloadCheckResult({...result,response:{...result.response,body:{kind:'DOWNLOAD_CHECK'}}}),false);
  }
  for (const message of ['Bearer exemplo', 'password secret', '/home/private/data', 'user@example.com']) assert.doesNotMatch(JSON.stringify(failedPlaygroundResult({status:400,message},1).response.body), /Bearer|password|secret|\/home\/|user@example/);
});
