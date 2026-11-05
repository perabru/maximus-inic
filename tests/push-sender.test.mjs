import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import webpush from '../scripts/notifications/node_modules/web-push/src/index.js';
import {validEndpoint,validSubscription,localTime,calendarItems,planNotifications} from '../scripts/notifications/core.mjs';
import {dispatchNotifications,main} from '../scripts/notifications/send.mjs';

const now=Date.parse('2027-03-01T12:00:00Z');
const endpoint='https://fcm.googleapis.com/fcm/send/test-only-no-real-subscription';
const device=createHash('sha256').update(endpoint).digest('hex');
const subscription={endpoint,keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:randomBytes(16).toString('base64url')},updatedAt:now};
const fixture=()=>({groups:{g1:{status:'active',advisorId:'prof',members:{alice:true,bob:true},name:'NOME PRIVADO'}},tasks:{g1:{t1:{title:'TEMA PRIVADO',dueDate:'2027-03-01',completed:false}}},events:{g1:{e1:{title:'EVENTO PRIVADO',date:'2027-03-02',description:'DESCRIÇÃO PRIVADA'}}},subscriptions:{alice:{[device]:subscription}}});
function initialized(data){return {...data,deliveries:{lastRun:now-900000,items:Object.fromEntries(calendarItems(data.groups,data.tasks,data.events).map(item=>[item.id,item.version]))}};}

test('aceita somente provedores HTTPS conhecidos sem credenciais, porta extra ou fragmento',()=>{
  for(const url of [endpoint,'https://updates.push.services.mozilla.com/wpush/v2/test','https://web.push.apple.com/test'])assert.equal(validEndpoint(url),true);
  for(const url of ['http://fcm.googleapis.com/fcm/send/x','https://fcm.googleapis.com.evil.invalid/x','https://evil.invalid/x','https://127.0.0.1/x','https://user:secret@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://web.push.apple.com/x#fragment','https://fcm.googleapis.com/','not-a-url'])assert.equal(validEndpoint(url),false,url);
});
test('valida chaves e tamanho de inscrições',()=>{
  assert.equal(validSubscription(subscription),true);
  assert.equal(validSubscription({...subscription,keys:{p256dh:'invalid',auth:'invalid'}}),false);
  assert.equal(validSubscription({...subscription,endpoint:'https://fcm.googleapis.com/'+ 'a'.repeat(2048)}),false);
});
test('fuso do Brasil respeita a virada de dia, mês e ano',()=>{
  assert.deepEqual(localTime('2027-01-01T02:59:00Z'),{today:'2026-12-31',tomorrow:'2027-01-01',hour:23});
  assert.deepEqual(localTime('2027-03-01T03:00:00Z'),{today:'2027-03-01',tomorrow:'2027-03-02',hour:0});
});
test('primeira execução não avisa todas as datas antigas do cronograma',()=>{
  const data=fixture();data.tasks.g1.t1.dueDate='2027-07-01';data.events.g1.e1.date='2027-07-02';
  const plan=planNotifications({...data,now});assert.equal(plan.batches.length,0);assert.equal(Object.keys(plan.nextItems).length,2);
});
test('primeira execução ainda avisa uma entrega pendente de hoje',()=>assert.equal(planNotifications({...fixture(),now}).batches.length,1));
test('novas datas e alterações geram um único aviso por aparelho',()=>{
  const data=initialized(fixture());data.tasks.g1.t1.dueDate='2027-08-01';data.events.g1.e1.date='2027-09-01';
  const plan=planNotifications({...data,now});assert.equal(plan.batches.length,1);assert.equal(plan.batches[0].keys.length,2);
});
test('horário silencioso preserva alterações para a próxima execução',()=>{
  const data=initialized(fixture());data.tasks.g1.t1.title='Mudou';
  const plan=planNotifications({...data,now:Date.parse('2027-03-02T01:01:00Z')});assert.equal(plan.quiet,true);assert.equal(plan.nextItems,null);assert.equal(plan.batches.length,0);
});
test('lembrete de hoje começa às8h e amanhã a partir das18h',()=>{
  const data=initialized(fixture());
  assert.equal(planNotifications({...data,now:Date.parse('2027-03-01T10:30:00Z')}).batches.length,0);
  assert.equal(planNotifications({...data,now}).batches[0].keys.length,1);
  assert.equal(planNotifications({...data,now:Date.parse('2027-03-01T21:00:00Z')}).batches[0].keys.length,2);
});
test('sem assinatura ou sem vínculo de integrante não há destinatário',()=>{
  const data=fixture();data.subscriptions={prof:{[device]:subscription},stranger:{[device]:subscription}};assert.equal(planNotifications({...data,now}).batches.length,0);
});
test('tarefas concluídas e grupos em exclusão não geram avisos',()=>{
  const data=fixture();data.tasks.g1.t1.completed=true;data.groups.g1.status='deleting';assert.equal(planNotifications({...data,now}).batches.length,0);
});
test('datas inválidas são descartadas sem normalizar para outro dia',()=>{
  const data=fixture();data.tasks.g1.t1.dueDate='2027-02-30';data.events.g1.e1.date='2027-13-10';assert.equal(calendarItems(data.groups,data.tasks,data.events).length,0);
});
test('payload não contém nomes, temas, descrições ou identificadores privados',()=>{
  const plan=planNotifications({...fixture(),now});const payload=JSON.stringify(plan.batches[0].payload);
  for(const value of ['alice','g1','NOME PRIVADO','TEMA PRIVADO','EVENTO PRIVADO','DESCRIÇÃO PRIVADA'])assert.equal(payload.includes(value),false);
  assert.equal(plan.batches[0].payload.url,'portal.html#calendario');
});
test('marcadores de sucesso impedem repetição para o mesmo aparelho',()=>{
  const data=initialized(fixture());const first=planNotifications({...data,now});
  data.deliveries.sent=Object.fromEntries(first.batches.flatMap(batch=>batch.keys.map(key=>[key,now])));
  assert.equal(planNotifications({...data,now:now+900000}).batches.length,0);
});
test('cada dispositivo inscrito recebe somente um aviso agregado por ciclo',()=>{
  const data=fixture();data.subscriptions.alice['a'.repeat(64)]={...subscription,endpoint:'https://web.push.apple.com/test'};
  assert.equal(planNotifications({...data,now}).batches.length,2);
});
test('runner acessa somente cinco namespaces permitidos e guarda confirmação de entrega',async()=>{
  const data=fixture();const reads=[],writes=[],messages=[];
  const map={groups:data.groups,tasks:data.tasks,events:data.events,pushSubscriptions:data.subscriptions,notificationDeliveries:{}};
  const summary=await dispatchNotifications({read:async path=>(reads.push(path),map[path]),write:async(...args)=>writes.push(args),send:async(...args)=>messages.push(args),now});
  assert.deepEqual(reads,['groups','tasks','events','pushSubscriptions','notificationDeliveries']);assert.equal(summary.sent,1);assert.equal(messages.length,1);
  assert.equal(writes.some(([path,changes])=>path==='notificationDeliveries'&&Object.keys(changes).some(key=>key.startsWith('sent/'))),true);
  assert.equal(writes.some(([path])=>/users|messages|evaluations|agreements/.test(path)),false);
});
test('respostas404/410 removem apenas a inscrição expirada',async()=>{
  for(const statusCode of [404,410]){
    const data=fixture(),writes=[];
    const values={groups:data.groups,tasks:data.tasks,events:data.events,pushSubscriptions:data.subscriptions,notificationDeliveries:{}};
    const summary=await dispatchNotifications({read:async p=>values[p],write:async(...args)=>writes.push(args),send:async()=>{throw {statusCode};},now});
    assert.equal(summary.expired,1);assert.equal(summary.failed,0);
    assert.equal(writes.some(([path,value,method])=>path===`pushSubscriptions/alice/${device}`&&value===null&&method==='DELETE'),true);
  }
});
test('falha temporária preserva o checkpoint para nova tentativa',async()=>{
  const data=initialized(fixture());data.tasks.g1.t1.title='Alterou';const writes=[];
  const values={groups:data.groups,tasks:data.tasks,events:data.events,pushSubscriptions:data.subscriptions,notificationDeliveries:data.deliveries};
  const summary=await dispatchNotifications({read:async p=>values[p],write:async(...args)=>writes.push(args),send:async()=>{throw {statusCode:503};},now});
  assert.equal(summary.failed,1);assert.equal(writes.some(([path])=>path.endsWith('/items')||path.endsWith('/lastRun')),false);
});
test('Web Push gera solicitação criptografada válida sem fazer envio de rede',()=>{
  const vapid=webpush.generateVAPIDKeys();const payload='{"title":"Máximu’s · INIC","body":"Abra o calendário."}';
  const request=webpush.generateRequestDetails(subscription,payload,{vapidDetails:{subject:'https://perabru.github.io/maximus-inic/',...vapid},contentEncoding:'aes128gcm',TTL:21600});
  assert.equal(request.endpoint,endpoint);assert.equal(request.method,'POST');assert.equal(Buffer.isBuffer(request.body),true);assert.equal(request.body.includes(Buffer.from('Abra o calendário.')),false);
});
test('configuração não ativada encerra sem secrets nem acesso de rede',async()=>{
  const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Nenhuma rede era esperada');};
  try {const result=await main({});assert.equal(result.awaitingActivation,true);assert.equal(result.configured,false);}finally{globalThis.fetch=original;}
});
