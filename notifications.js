// Web Push subscriptions belong to this device and the authenticated account.
// Permission is requested only by enableNotifications(), from a user click.
const CONFIG_URL = new URL('./notification-config.json',import.meta.url);
const PUSH_HOSTS = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
let configCache=null;
const configuration=typeof window==='undefined'?Promise.resolve(null):fetch(CONFIG_URL,{cache:'no-store'}).then(response=>response.ok?response.json():null).then(config=>(configCache=config)).catch(()=>null);

function environment() {
  const browser=typeof window!=='undefined'&&typeof navigator!=='undefined';
  const ios=browser&&(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  const standalone=browser&&(window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true);
  const needsInstall=Boolean(ios&&!standalone);
  const supported=Boolean(browser&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&!needsInstall);
  return {supported,needsInstall,permission:typeof Notification==='undefined'?'unsupported':Notification.permission};
}
function messageFor(state) {
  if(state.setupRequired)return 'Os avisos aguardam a ativação do remetente. O calendário e as entregas já podem ser usados.';
  if(state.needsInstall)return 'No iPhone ou iPad, adicione o app à Tela de Início e abra-o por lá para ativar os avisos.';
  if(!state.supported)return 'Este navegador não oferece avisos push. Use um navegador compatível ou o aplicativo instalado.';
  if(state.permission==='denied')return 'Os avisos estão bloqueados. Libere as notificações deste site nas configurações do navegador ou do aparelho.';
  return state.enabled?'Avisos ativados neste aparelho.':'Ative os avisos para receber novas datas e lembretes das entregas.';
}
async function registration({create=false}={}) {
  let current=await navigator.serviceWorker.getRegistration(new URL('./',import.meta.url));
  if(!current&&create)current=await navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{scope:new URL('./',import.meta.url).pathname});
  if(!current)return null;
  if(!current.active)current=await navigator.serviceWorker.ready;
  return current;
}
export async function getNotificationState() {
  const config=await configuration;
  const serverReady=Boolean(config?.enabled===true&&config.senderReady===true);
  const state={...environment(),enabled:false,serverReady,setupRequired:!serverReady};
  if(serverReady&&state.supported&&state.permission==='granted'){
    try {state.enabled=Boolean(await (await registration())?.pushManager.getSubscription());}catch{/* Leave the control available for a retry. */}
  }
  return {...state,message:messageFor(state)};
}
function publicKeyBytes(value) {
  if(typeof value!=='string'||!/^B[A-Za-z0-9_-]{86}$/.test(value))throw new Error('Os avisos ainda estão sendo configurados. Tente novamente mais tarde.');
  const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'=');
  const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
  if(bytes.length!==65||bytes[0]!==4)throw new Error('A configuração de avisos não é válida.');
  return bytes;
}
function validEndpoint(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&PUSH_HOSTS.has(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.length>1;}catch{return false;}
}
async function deviceId(endpoint) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function enableNotifications(service,user) {
  if(!user?.uid)throw new Error('Entre na sua conta para ativar os avisos.');
  const config=configCache;
  if(config?.enabled!==true||config.senderReady!==true)throw new Error('Os avisos aguardam a ativação do remetente. O calendário e as entregas já podem ser usados.');
  const state=environment();
  if(!state.supported)throw new Error(messageFor(state));
  if(state.permission==='denied')throw new Error(messageFor(state));
  // Keep this request before network waits, as required by iOS user activation.
  const permission=state.permission==='granted'?'granted':await Notification.requestPermission();
  if(permission!=='granted')return {...state,permission,enabled:false,message:permission==='denied'?messageFor({...state,permission}):'Você pode ativar os avisos quando quiser.'};
  const key=publicKeyBytes(config.publicKey);
  const worker=await registration({create:true});
  if(!worker?.pushManager)throw new Error('Não foi possível preparar os avisos neste aparelho.');
  let subscription=await worker.pushManager.getSubscription();
  try {
    if(subscription&&subscription.options?.applicationServerKey){
      const old=new Uint8Array(subscription.options.applicationServerKey);
      if(old.length!==key.length||old.some((byte,i)=>byte!==key[i])){await subscription.unsubscribe();subscription=null;}
    }
    subscription ||= await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    const data=subscription.toJSON();
    if(!validEndpoint(data.endpoint)||!data.keys?.p256dh||!data.keys?.auth)throw new Error('O serviço de notificações deste navegador não é compatível.');
    await service.savePushSubscription(data,await deviceId(data.endpoint));
  } catch(error) {
    // A subscription without an authenticated owner must not keep receiving.
    try {await subscription?.unsubscribe();}catch{}
    throw error;
  }
  return {supported:true,needsInstall:false,permission:'granted',enabled:true,serverReady:true,setupRequired:false,message:'Avisos ativados neste aparelho.'};
}
export async function disableNotifications(service,user) {
  const state=environment();
  if(!state.supported)return {...state,enabled:false,message:messageFor(state)};
  const worker=await registration();
  const subscription=await worker?.pushManager.getSubscription();
  if(subscription){
    const id=await deviceId(subscription.endpoint);
    const removed=await subscription.unsubscribe();
    if(!removed)throw new Error('Não foi possível desativar os avisos. Tente novamente.');
    // Expired server entries are also pruned after a 404/410 delivery response.
    if(user?.uid)try {await service.removePushSubscription(id);}catch{}
  }
  return {...state,enabled:false,message:'Avisos desativados neste aparelho.'};
}
