import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import webpush from 'web-push';
import {planNotifications} from './core.mjs';

const DATABASE='https://fir-ionic-a5e90.firebaseio.com/maximusInic';
const API_KEY='AIzaSyDESrp6AWsqZfU9QJ3f2XdiGtQNRR5LrtE';
const ROOT_URL='https://perabru.github.io/maximus-inic/';
const identifiers=value=>typeof value==='string'&&value.length<=128&&!/[.#$\[\]/]/.test(value);
export async function dispatchNotifications({read,write,send,now=Date.now()}) {
  const [groups,tasks,events,subscriptions,deliveries]=await Promise.all(['groups','tasks','events','pushSubscriptions','notificationDeliveries'].map(read));
  const plan=planNotifications({groups:groups||{},tasks:tasks||{},events:events||{},subscriptions:subscriptions||{},deliveries:deliveries||{},now});
  if(plan.quiet)return {sent:0,expired:0,failed:0,quiet:true};
  let sent=0,expired=0,failed=0;
  // One message per opted-in device for this pass, even when several tasks change.
  for(const batch of plan.batches){
    if(!identifiers(batch.uid))continue;
    try {
      await send({endpoint:batch.subscription.endpoint,keys:batch.subscription.keys},JSON.stringify(batch.payload),{TTL:21600,urgency:'normal',timeout:15000,topic:batch.payload.tag});
      const changes=Object.fromEntries(batch.keys.map(key=>[`sent/${key}`,now]));
      await write('notificationDeliveries',changes,'PATCH');
      sent++;
    }catch(error){
      if(error?.statusCode===404||error?.statusCode===410){
        await write(`pushSubscriptions/${batch.uid}/${batch.deviceId}`,null,'DELETE');expired++;
      }else failed++;
    }
  }
  // Keep failed changes pending for a retry. Successful device markers prevent
  // duplicates if the run is interrupted before the checkpoint is committed.
  if(!failed){
    await write('notificationDeliveries/items',plan.nextItems,'PUT');
    await write('notificationDeliveries/lastRun',now,'PUT');
  }
  const old=Object.entries(deliveries?.sent||{}).filter(([,stamp])=>typeof stamp==='number'&&stamp<now-90*86400000);
  if(old.length)await write('notificationDeliveries',Object.fromEntries(old.map(([key])=>[`sent/${key}`,null])),'PATCH');
  return {sent,expired,failed,quiet:false};
}
async function firebaseClients(email,password) {
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`O acesso do remetente foi recusado (${response.status}). Verifique os secrets e a conta técnica.`);
  const session=await response.json();
  if(!session.idToken)throw new Error('O serviço de acesso não retornou uma sessão válida.');
  const request=async(path,{method='GET',body}={})=>{
    if(path.split('/').some(part=>!identifiers(part)))throw new Error('Caminho interno de avisos inválido.');
    const url=new URL(`${DATABASE}/${path}.json`);url.searchParams.set('auth',session.idToken);
    const result=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!result.ok)throw new Error(`O banco recusou a operação do remetente (${result.status}).`);
    return result.json();
  };
  return {read:path=>request(path),write:(path,body,method)=>request(path,{body,method})};
}
export async function main(env=process.env) {
  const config=JSON.parse(await readFile(new URL('../../notification-config.json',import.meta.url),'utf8'));
  if(config.enabled!==true||config.senderReady!==true||['INIC_NOTIFY_EMAIL','INIC_NOTIFY_PASSWORD','INIC_VAPID_PUBLIC_KEY','INIC_VAPID_PRIVATE_KEY'].some(key=>!env[key])){
    const summary={configured:false,awaitingActivation:true};
    console.log(JSON.stringify({message:'Remetente aguardando ativação administrativa',...summary}));return summary;
  }
  if(config.publicKey!==env.INIC_VAPID_PUBLIC_KEY)throw new Error('A chave pública do aplicativo precisa corresponder à do remetente.');
  webpush.setVapidDetails(ROOT_URL,env.INIC_VAPID_PUBLIC_KEY,env.INIC_VAPID_PRIVATE_KEY);
  const client=await firebaseClients(env.INIC_NOTIFY_EMAIL,env.INIC_NOTIFY_PASSWORD);
  const summary=await dispatchNotifications({...client,send:(...args)=>webpush.sendNotification(...args)});
  // Counts only: no recipient ids, subscriptions, document contents or tokens.
  console.log(JSON.stringify({message:'Verificação de avisos concluída',...summary}));
  if(summary.failed)process.exitCode=1;
  return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error?.message||'Não foi possível executar o remetente.');process.exitCode=1;});
