import {createHash} from 'node:crypto';

export const TIME_ZONE='America/Sao_Paulo';
export const PUSH_HOSTS=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[.#$\[\]/]/.test(value);
export function validEndpoint(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&PUSH_HOSTS.has(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.hash&&u.pathname.length>1;}catch{return false;}
}
export function validSubscription(value) {
  return typeof value?.endpoint==='string'&&value.endpoint.length<=2048&&validEndpoint(value.endpoint)&&/^B[A-Za-z0-9_-]{86}=?$/.test(value.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{22}(==)?$/.test(value.keys?.auth||'');
}
export function localTime(now) {
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const today=`${values.year}-${values.month}-${values.day}`;
  const next=new Date(`${today}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
  return {today,tomorrow:next.toISOString().slice(0,10),hour:Number(values.hour)};
}
function validDate(date) {return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(`${date}T12:00:00Z`))&&new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)===date;}
export function calendarItems(groups,tasks,events) {
  const result=[];
  for(const [groupId,group] of Object.entries(record(groups))){
    if(group.status==='deleting')continue;
    const members=Object.keys(record(group.members)).filter(uid=>group.members[uid]===true);
    if(!members.length)continue;
    for(const [kind,bucket] of [['task',record(tasks)[groupId]],['event',record(events)[groupId]]])for(const [id,item] of Object.entries(record(bucket))){
      const date=kind==='task'?item.dueDate:item.date;
      if(!validDate(date)||kind==='task'&&item.completed)continue;
      const version=hash(JSON.stringify([date,item.title||'',kind==='event'?item.description||'':'']));
      result.push({id:hash(`${kind}/${groupId}/${id}`),groupId,kind,date,version,members});
    }
  }
  return result;
}
export function orientationItems(groups,confirmations,now=Date.now()) {
  const result=[];
  for(const [groupId,value] of Object.entries(record(confirmations))){
    const confirmation=record(value),group=record(record(groups)[groupId]);
    if(group.status!=='active'||![confirmation.studentUid,confirmation.advisorUid,confirmation.invitationId].every(identifier)||group.members?.[confirmation.studentUid]!==true||group.advisorId!==confirmation.advisorUid)continue;
    if(typeof confirmation.createdAt!=='number'||!Number.isFinite(confirmation.createdAt)||confirmation.createdAt<=0||confirmation.createdAt>now)continue;
    const version=hash(JSON.stringify([confirmation.studentUid,confirmation.advisorUid,confirmation.invitationId,confirmation.createdAt]));
    result.push({id:hash(`orientation/${groupId}`),groupId,kind:'orientation',version,members:[confirmation.studentUid]});
  }
  return result;
}
export function planNotifications({groups={},tasks={},events={},advisorConfirmations={},subscriptions={},deliveries={},now=Date.now()}) {
  const time=localTime(now),priorItems=record(deliveries.items),sent=record(deliveries.sent);
  const initialized=Number(deliveries.lastRun)>0;
  const items=[...calendarItems(groups,tasks,events),...orientationItems(groups,advisorConfirmations,now)],nextItems=Object.fromEntries(items.map(item=>[item.id,item.version]));
  // Keep changes pending overnight, without sending during quiet hours.
  if(time.hour<7||time.hour>=22)return {batches:[],nextItems:null,quiet:true};
  const devices=new Map();
  for(const item of items){
    const kinds=[];
    if(item.kind==='orientation'){
      // Receipts exist only for accepted requests. A baseline skips old history;
      // subsequent unseen receipts remain pending through quiet hours or retries.
      if(initialized&&priorItems[item.id]!==item.version)kinds.push('orientation');
    }else{
      if(initialized&&priorItems[item.id]!==item.version&&item.date>=time.today)kinds.push('changed');
      if(item.date===time.today&&time.hour>=8)kinds.push('today');
      if(item.date===time.tomorrow&&time.hour>=18)kinds.push('tomorrow');
    }
    for(const uid of item.members)for(const [deviceId,subscription] of Object.entries(record(subscriptions[uid]))){
      if(!/^[a-f0-9]{64}$/.test(deviceId)||!validSubscription(subscription))continue;
      const deviceKey=`${uid}/${deviceId}`;
      for(const kind of kinds){
        const key=hash(`${uid}/${deviceId}/${item.id}/${item.version}/${kind}/${kind==='today'||kind==='tomorrow'?time.today:''}`);
        if(sent[key])continue;
        if(!devices.has(deviceKey))devices.set(deviceKey,{uid,deviceId,subscription,keys:[],kinds:new Set(),sources:new Set()});
        const batch=devices.get(deviceKey);batch.keys.push(key);batch.kinds.add(kind);batch.sources.add(item.kind);
      }
    }
  }
  const batches=Array.from(devices.values()).map(batch=>{
    const orientation=batch.kinds.has('orientation');
    const kind=orientation?'orientation':batch.kinds.has('today')?'today':batch.kinds.has('tomorrow')?'tomorrow':'changed';
    const task=batch.sources.has('task');
    const body=orientation?'Um orientador aceitou sua proposta de TCC. Abra o aplicativo.':kind==='today'?(task?'Há uma entrega do INIC para hoje. Abra seu calendário.':'Há um evento do INIC para hoje. Abra seu calendário.'):kind==='tomorrow'?(task?'Há uma entrega do INIC para amanhã. Confira seu calendário.':'Há um evento do INIC para amanhã. Confira seu calendário.'):'Seu calendário do INIC recebeu novas datas ou alterações. Abra o aplicativo para conferir.';
    return {...batch,kinds:undefined,sources:undefined,payload:{title:'Máximu’s · INIC',body,url:orientation?'portal.html#grupos':'portal.html#calendario',tag:`inic-${hash(batch.keys.join('/')).slice(0,24)}`,kind:orientation?'orientation':task?'task':'event'}};
  });
  return {batches,nextItems,quiet:false};
}
