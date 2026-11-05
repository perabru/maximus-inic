import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const PUBLIC_KEY='BDS66uPh-zpunTd_yTHnGIpZkZU2J0HN6YHboQ9P6253WGVLwmAxhZmdhll6-tkUrjntZxu9-xcTrs6Z7EctmUQ';
let instance=0;
async function browser({permission='granted',ready=true,ios=false,installed=false,existing=true,saveError=false}={}){
  const names=['window','navigator','Notification','crypto','fetch'];
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const calls=[],saved=[];
  const data={endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys:{p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)}};
  const subscription={endpoint:data.endpoint,toJSON:()=>data,unsubscribe:async()=>(calls.push('unsubscribe'),true)};
  const worker={active:{},pushManager:{getSubscription:async()=>existing?subscription:null,subscribe:async options=>(calls.push('subscribe'),assert.equal(options.userVisibleOnly,true),subscription)}};
  function Notification(){}Notification.permission=permission;Notification.requestPermission=async()=>(calls.push('permission'),'granted');
  const values={
    window:{isSecureContext:true,Notification,PushManager:function(){},matchMedia:()=>({matches:installed})},
    navigator:{userAgent:ios?'iPhone':'Test Browser',platform:'Test',maxTouchPoints:0,standalone:installed,serviceWorker:{getRegistration:async()=>worker,register:async()=>worker,ready:Promise.resolve(worker)}},
    Notification,crypto:webcrypto,
    fetch:async()=>(calls.push('config'),{ok:true,json:async()=>({enabled:true,senderReady:ready,publicKey:PUBLIC_KEY})})
  };
  for(const [name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  const module=await import(`../notifications.js?push-test=${++instance}`);
  const service={savePushSubscription:async(...args)=>{calls.push('save');if(saveError)throw Error('Gravação recusada');saved.push(args);},removePushSubscription:async id=>calls.push(`remove:${id}`)};
  return {module,service,calls,saved,restore(){for(const name of names){const descriptor=originals.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}};
}
test('consulta de estado não solicita permissão',async()=>{
  const b=await browser({permission:'default'});try{const s=await b.module.getNotificationState();assert.equal(s.enabled,false);assert.equal(s.serverReady,true);assert.equal(b.calls.includes('permission'),false);}finally{b.restore();}
});
test('remetente pendente impede permissão e inscrição',async()=>{
  const b=await browser({ready:false,permission:'default'});try{const s=await b.module.getNotificationState();assert.equal(s.setupRequired,true);assert.equal(s.enabled,false);await assert.rejects(b.module.enableNotifications(b.service,{uid:'alice'}),/aguardam/);assert.equal(b.calls.includes('permission'),false);assert.equal(b.calls.includes('subscribe'),false);}finally{b.restore();}
});
test('iOS fora da Tela de Início mostra instrução de instalação',async()=>{
  const b=await browser({ios:true,permission:'default'});try{const s=await b.module.getNotificationState();assert.equal(s.needsInstall,true);assert.equal(s.supported,false);await assert.rejects(b.module.enableNotifications(b.service,{uid:'alice'}),/Tela de Início/);assert.equal(b.calls.includes('permission'),false);}finally{b.restore();}
});
test('iOS instalado pode usar o fluxo de avisos',async()=>{
  const b=await browser({ios:true,installed:true});try{const s=await b.module.getNotificationState();assert.equal(s.needsInstall,false);assert.equal(s.supported,true);}finally{b.restore();}
});
test('permissão bloqueada não cria inscrição',async()=>{
  const b=await browser({permission:'denied'});try{await b.module.getNotificationState();await assert.rejects(b.module.enableNotifications(b.service,{uid:'alice'}),/bloqueados/);assert.equal(b.calls.includes('permission'),false);assert.equal(b.calls.includes('save'),false);}finally{b.restore();}
});
test('ativação exige conta autenticada',async()=>{
  const b=await browser();try{await b.module.getNotificationState();await assert.rejects(b.module.enableNotifications(b.service,null),/Entre na sua conta/);}finally{b.restore();}
});
test('nova inscrição grava hash do endpoint e só exibe ativo após gravar',async()=>{
  const b=await browser({permission:'default',existing:false});try{await b.module.getNotificationState();const state=await b.module.enableNotifications(b.service,{uid:'alice'});assert.equal(state.enabled,true);assert.equal(b.saved.length,1);assert.match(b.saved[0][1],/^[a-f0-9]{64}$/);assert.equal(b.calls.indexOf('permission')<b.calls.indexOf('subscribe'),true);assert.equal(b.calls.indexOf('subscribe')<b.calls.indexOf('save'),true);}finally{b.restore();}
});
test('erro ao associar conta desfaz a inscrição do aparelho',async()=>{
  const b=await browser({saveError:true,existing:false});try{await b.module.getNotificationState();await assert.rejects(b.module.enableNotifications(b.service,{uid:'alice'}),/recusada/);assert.equal(b.calls.includes('unsubscribe'),true);}finally{b.restore();}
});
test('desativação cancela aparelho e remove apenas seu hash privado',async()=>{
  const b=await browser();try{const state=await b.module.disableNotifications(b.service,{uid:'alice'});assert.equal(state.enabled,false);assert.equal(b.calls.includes('unsubscribe'),true);assert.equal(b.calls.some(value=>/^remove:[a-f0-9]{64}$/.test(value)),true);}finally{b.restore();}
});
test('estado identifica permissão concedida e aparelho já inscrito',async()=>{
  const b=await browser();try{const state=await b.module.getNotificationState();assert.equal(state.enabled,true);assert.equal(state.setupRequired,false);}finally{b.restore();}
});
