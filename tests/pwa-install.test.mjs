import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';

const source=()=>readFileSync(new URL('../pwa.js',import.meta.url),'utf8');
const DISMISSED_KEY='INIC_INSTALL_DISMISSED_AT';
const WEEK=7*24*60*60*1000;
const NOW=Date.parse('2026-11-12T22:00:00Z');
const flush=async()=>{await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function browser({device='android',userAgent='',readyState='loading',displayMode='browser',stored={},storageDenied=false,storageWriteDenied=false,protocol='https:',serviceWorker=true,registrationError=false,now=NOW}={}){
  const {document,window:dom}=parseHTML('<!doctype html><html lang="pt-BR"><head></head><body><main><input id="writing" aria-label="Texto em edição"><button type="button" data-install-app hidden>Instalar aplicativo</button><button type="button" data-install-app hidden>Instalar aplicativo</button></main></body></html>');
  let ready=readyState,mode=displayMode,time=now,active=document.body;
  Object.defineProperty(document,'readyState',{get:()=>ready,configurable:true});
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
  Object.defineProperty(document,'activeElement',{get:()=>active,configurable:true});
  dom.HTMLElement.prototype.focus=function(){active=this;};
  const records=new Map(Object.entries(stored).map(([key,value])=>[key,String(value)])),storageCalls=[];
  const localStorage={
    getItem(key){if(storageDenied)throw new Error('Storage access denied');return records.get(key)??null;},
    setItem(key,value){if(storageDenied||storageWriteDenied)throw new Error('Storage access denied');storageCalls.push({key,value:String(value)});records.set(key,String(value));},
    removeItem(key){if(storageDenied)throw new Error('Storage access denied');records.delete(key);}
  };
  const listeners=new Map(),media=new Map(),timers=new Map(),registrations=[];let timerId=0;
  const userAgents={
    android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    iphone:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    ipad:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    desktop:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  };
  const navigator={userAgent:userAgent||userAgents[device]||userAgents.desktop,platform:device==='ipad'?'MacIntel':device==='iphone'?'iPhone':device==='android'?'Linux armv8l':'Win32',maxTouchPoints:device==='desktop'?0:5,userAgentData:{mobile:device==='android'||device==='iphone'},standalone:mode==='standalone'&&['iphone','ipad'].includes(device)};
  if(serviceWorker)navigator.serviceWorker={register:async(...args)=>{registrations.push(args);if(registrationError)throw new Error('Worker unavailable');return {scope:'https://qa.invalid/maximus-inic/'};}};
  const matches=query=>{
    const display=query.match(/display-mode\s*:\s*([a-z-]+)/)?.[1];if(display)return mode===display;
    if(/pointer\s*:\s*coarse|hover\s*:\s*none/.test(query))return device!=='desktop';
    if(/max-width/.test(query))return device!=='desktop';
    return false;
  };
  const matchMedia=query=>{
    if(!media.has(query)){const callbacks=new Set();media.set(query,{media:query,get matches(){return matches(query);},addEventListener(type,callback){if(type==='change')callbacks.add(callback);},removeEventListener(type,callback){if(type==='change')callbacks.delete(callback);},addListener(callback){callbacks.add(callback);},removeListener(callback){callbacks.delete(callback);},callbacks});}
    return media.get(query);
  };
  const setTimeout=(callback,delay=0)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
  const clearTimeout=id=>timers.delete(id);
  const location={protocol,href:protocol+'//qa.invalid/maximus-inic/portal.html',pathname:'/maximus-inic/portal.html',origin:protocol+'//qa.invalid'};
  const window={document,navigator,location,localStorage,matchMedia,setTimeout,clearTimeout,isSecureContext:protocol==='https:',innerWidth:device==='desktop'?1440:390,
    addEventListener(type,callback,options){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push({callback,once:options?.once===true});},
    removeEventListener(type,callback){listeners.set(type,(listeners.get(type)||[]).filter(entry=>entry.callback!==callback));},
    dispatchEvent(event){for(const entry of [...listeners.get(event.type)||[]]){entry.callback.call(window,event);if(entry.once)window.removeEventListener(event.type,entry.callback);}return !event.defaultPrevented;}
  };
  class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const context=vm.createContext({window,document,navigator,location,localStorage,Date:Clock,console,URL,Promise,Map,Set,WeakSet,Event:dom.Event,CustomEvent:dom.CustomEvent,setTimeout,clearTimeout,matchMedia});
  function evaluate(){vm.runInContext(source(),context,{filename:'pwa.js'});}
  async function settle(){for(const [id,timer]of [...timers])if(timer.delay<=5000){timers.delete(id);timer.callback();}await flush();}
  async function readyNow(){ready='interactive';document.dispatchEvent(new dom.Event('DOMContentLoaded'));await settle();}
  function nativePrompt({outcome='accepted',pending=false,promptError=false}={}){
    const choice=deferred(),event=new dom.Event('beforeinstallprompt',{cancelable:true});let calls=0;
    event.prompt=async()=>{calls++;if(promptError)throw new Error('Native install unavailable');if(!pending)choice.resolve({outcome,platform:'web'});return {outcome,platform:'web'};};
    event.userChoice=choice.promise;window.dispatchEvent(event);
    return {event,get calls(){return calls;},resolve:outcome=>choice.resolve({outcome,platform:'web'}),reject:error=>choice.reject(error)};
  }
  function installed(){window.dispatchEvent(new dom.Event('appinstalled'));}
  async function changeMode(next){const previous=new Map([...media].map(([query,mql])=>[query,mql.matches]));mode=next;for(const [query,mql]of media)if(previous.get(query)!==mql.matches)for(const callback of mql.callbacks)callback({media:query,matches:mql.matches});await settle();}
  const find=id=>document.getElementById(id);
  function visible(id='pwa-install-offer'){const item=find(id);return Boolean(item&&!item.hidden);}
  function click(id){const control=find(id);assert.ok(control,'control '+id);control.click();return control;}
  const manual=()=>[...document.querySelectorAll('[data-install-app]')];
  return {document,window,dom,navigator,location,records,storageCalls,registrations,evaluate,settle,readyNow,nativePrompt,installed,changeMode,find,visible,click,manual,setNow(value){time=value;},get active(){return active;}};
}

async function start(options){const b=browser(options);b.evaluate();if(options?.readyState==='loading'||!options?.readyState)await b.readyNow();else await b.settle();return b;}

test('mobile visitors see an installation offer without opening the native prompt automatically',async()=>{
  const b=browser();b.evaluate();const install=b.nativePrompt();assert.equal(install.calls,0);await b.readyNow();
  assert.equal(b.visible(),true);assert.equal(install.event.defaultPrevented,true);assert.equal(install.calls,0);
  assert.match(b.find('pwa-install-title').textContent,/INIC|instal|celular/i);
});

test('iPhone and desktop-mode iPad receive an automatic offer with real home-screen instructions',async()=>{
  for(const device of ['iphone','ipad']){
    const b=await start({device});assert.equal(b.visible(),true,device);
    b.click('pwa-install-primary');await b.settle();assert.equal(b.visible('pwa-install-help'),true);
    assert.match(b.find('pwa-install-help').textContent,/Compartilhar/i);assert.match(b.find('pwa-install-help').textContent,/Tela de In[ií]cio/i);
  }
});

test('desktop users are not interrupted automatically, including when a native prompt becomes available',async()=>{
  const b=await start({device:'desktop'}),install=b.nativePrompt({pending:true});await b.settle();assert.equal(b.visible(),false);assert.equal(install.calls,0);
  const manual=b.manual().find(control=>!control.hidden);assert.ok(manual);manual.click();await b.settle();assert.equal(b.visible(),true);assert.equal(install.calls,1);install.resolve('dismissed');await b.settle();
});

test('installed standalone windows suppress automatic and manual installation offers',async()=>{
  for(const device of ['android','iphone','ipad']){
    const b=await start({device,displayMode:'standalone'}),install=b.nativePrompt();await b.settle();
    assert.equal(b.visible(),false,device);assert.equal(install.calls,0);assert.ok(b.manual().every(control=>control.hidden));
  }
});

test('an already-ready document initializes without waiting for another DOMContentLoaded',async()=>{
  const b=await start({readyState:'complete'});assert.equal(b.visible(),true);assert.equal(b.registrations.length,1);
});

test('repeated document-ready events do not duplicate the offer, listeners or service worker registration',async()=>{
  const b=await start();await b.readyNow();await b.readyNow();assert.equal(b.document.querySelectorAll('#pwa-install-offer').length,1);assert.equal(b.registrations.length,1);
  const install=b.nativePrompt({pending:true});b.click('pwa-install-primary');await b.settle();assert.equal(install.calls,1);install.resolve('dismissed');await b.settle();
});

test('arrival of beforeinstallprompt after rendering enables native installation only on an explicit click',async()=>{
  const b=await start();assert.equal(b.visible(),true);const install=b.nativePrompt({pending:true});await b.settle();assert.equal(install.calls,0);
  b.click('pwa-install-primary');await b.settle();assert.equal(install.calls,1);install.resolve('accepted');await b.settle();assert.equal(b.visible(),false);
});

test('rapid clicks cannot open concurrent native prompts and consume a native event only once',async()=>{
  const b=await start(),install=b.nativePrompt({pending:true});await b.settle();const button=b.click('pwa-install-primary');button.click();button.click();await b.settle();assert.equal(install.calls,1);
  install.resolve('dismissed');await b.settle();b.manual()[0].click();await b.settle();b.click('pwa-install-primary');await b.settle();assert.equal(install.calls,1);assert.equal(b.visible('pwa-install-help'),true);
});

test('native dismissal hides the offer and records a seven-day cooldown without declaring installation',async()=>{
  const b=await start(),install=b.nativePrompt({outcome:'dismissed'});await b.settle();b.click('pwa-install-primary');await b.settle();
  assert.equal(install.calls,1);assert.equal(b.visible(),false);assert.equal(Number(b.records.get(DISMISSED_KEY)),NOW);assert.ok(b.manual().some(control=>!control.hidden));
});

test('native acceptance hides the offer and avoids a second automatic offer on the next page',async()=>{
  const b=await start(),install=b.nativePrompt({outcome:'accepted'});await b.settle();b.click('pwa-install-primary');await b.settle();assert.equal(install.calls,1);assert.equal(b.visible(),false);
  const next=await start({stored:Object.fromEntries(b.records),now:NOW+1000});assert.equal(next.visible(),false);
});

test('close and later both snooze the automatic offer and preserve the explicit install control',async()=>{
  for(const id of ['pwa-install-close','pwa-install-later']){
    const b=await start();b.click(id);await b.settle();assert.equal(b.visible(),false,id);assert.equal(Number(b.records.get(DISMISSED_KEY)),NOW);assert.ok(b.manual().some(control=>!control.hidden));
    const revisit=await start({stored:Object.fromEntries(b.records),now:NOW+WEEK-1});assert.equal(revisit.visible(),false,id);
    const expired=await start({stored:Object.fromEntries(b.records),now:NOW+WEEK+1});assert.equal(expired.visible(),true,id);
  }
});

test('manual installation remains available during cooldown',async()=>{
  const b=await start({stored:{[DISMISSED_KEY]:NOW-60_000}});assert.equal(b.visible(),false);const control=b.manual().find(item=>!item.hidden);assert.ok(control);control.click();await b.settle();assert.equal(b.visible(),true);
});

test('storage restrictions cannot break the offer, dismissal or manual reopening',async()=>{
  const b=await start({storageDenied:true});assert.equal(b.visible(),true);b.click('pwa-install-later');await b.settle();assert.equal(b.visible(),false);
  b.manual()[0].click();await b.settle();assert.equal(b.visible(),true);assert.equal(b.registrations.length,1);
});

test('a failed storage write preserves the current in-memory dismissal over an older stored value',async()=>{
  const old=NOW-WEEK-1000,b=await start({stored:{[DISMISSED_KEY]:old},storageWriteDenied:true});assert.equal(b.visible(),true);
  b.click('pwa-install-later');await b.settle();assert.equal(b.visible(),false);assert.equal(Number(b.records.get(DISMISSED_KEY)),old);
  const install=b.nativePrompt({pending:true});await b.settle();assert.equal(b.visible(),false);assert.equal(install.calls,0);
  b.manual()[0].click();await b.settle();assert.equal(b.visible(),true);assert.equal(install.calls,1);install.resolve('dismissed');await b.settle();
});

test('invalid or future stored timestamps cannot hide the install offer indefinitely',async()=>{
  for(const value of ['not-a-number','Infinity','-5',NOW+WEEK]){
    const b=await start({stored:{[DISMISSED_KEY]:value}});assert.equal(b.visible(),true,value);
  }
});

test('a dismissal from another tab and a restored page respect the shared cooldown',async()=>{
  const b=await start();assert.equal(b.visible(),true);
  const unrelated=new b.dom.Event('storage');unrelated.key='unrelated-setting';b.window.dispatchEvent(unrelated);await b.settle();assert.equal(b.visible(),true);
  b.records.set(DISMISSED_KEY,String(NOW));const event=new b.dom.Event('storage');event.key=DISMISSED_KEY;b.window.dispatchEvent(event);await b.settle();assert.equal(b.visible(),false);
  b.manual()[0].click();await b.settle();assert.equal(b.visible(),true);
  b.window.dispatchEvent(new b.dom.Event('pageshow'));await b.settle();assert.equal(b.visible(),false);
});

test('appinstalled clears pending installation and all prompts and keeps manual controls hidden',async()=>{
  const b=await start(),install=b.nativePrompt({pending:true});await b.settle();const primary=b.find('pwa-install-primary');assert.ok(primary);b.installed();await b.settle();assert.equal(b.visible(),false);assert.ok(b.manual().every(control=>control.hidden));
  primary.click();await b.settle();assert.equal(install.calls,0);assert.equal(Number(b.records.get(DISMISSED_KEY)),NOW);
});

test('a pending native result cannot reopen the offer after appinstalled',async()=>{
  const b=await start(),install=b.nativePrompt({pending:true});await b.settle();b.click('pwa-install-primary');await b.settle();assert.equal(install.calls,1);
  b.installed();install.resolve('dismissed');await b.settle();assert.equal(b.visible(),false);assert.ok(b.manual().every(control=>control.hidden));
});

test('a change to standalone display mode clears an offer already on screen',async()=>{
  const b=await start(),install=b.nativePrompt();await b.settle();assert.equal(b.visible(),true);await b.changeMode('standalone');assert.equal(b.visible(),false);assert.ok(b.manual().every(control=>control.hidden));assert.equal(install.calls,0);
});

test('Android without beforeinstallprompt offers a usable menu guide without implying installation succeeded',async()=>{
  const b=await start();b.click('pwa-install-primary');await b.settle();assert.equal(b.visible(),true);assert.equal(b.visible('pwa-install-help'),true);
  assert.match(b.find('pwa-install-help').textContent,/menu|Chrome/i);assert.match(b.find('pwa-install-help').textContent,/Instalar|Adicionar/i);assert.equal(b.records.has(DISMISSED_KEY),false);
});

test('an iOS in-app browser explains how to open Safari and then use its share action',async()=>{
  const b=await start({device:'iphone',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/550.0]'});
  b.click('pwa-install-primary');await b.settle();assert.equal(b.visible('pwa-install-help'),true);
  const instructions=b.find('pwa-install-help').textContent;assert.match(instructions,/Safari/i);assert.match(instructions,/Compartilhar/i);assert.match(instructions,/Tela de In[ií]cio/i);
});

test('a failed native prompt shows recoverable installation guidance',async()=>{
  const b=await start(),install=b.nativePrompt({promptError:true});await b.settle();b.click('pwa-install-primary');await b.settle();
  assert.equal(install.calls,1);assert.equal(b.visible(),true);assert.equal(b.visible('pwa-install-help'),true);assert.equal(b.find('pwa-install-primary').disabled,false);
  assert.ok(b.find('pwa-install-status').textContent.trim().length>0);
});

test('automatic promotion preserves focus and labels its controls for assistive technology',async()=>{
  const b=browser();b.find('writing').focus();b.evaluate();await b.readyNow();assert.equal(b.active,b.find('writing'));
  const offer=b.find('pwa-install-offer');assert.ok(offer);const title=b.find(offer.getAttribute('aria-labelledby'));assert.ok(title?.textContent.trim());
  assert.ok(b.find('pwa-install-close').getAttribute('aria-label'));assert.equal(b.find('pwa-install-status').getAttribute('role'),'status');
  for(const id of ['pwa-install-primary','pwa-install-later']){assert.equal(b.find(id).type,'button');assert.ok(b.find(id).textContent.trim());}
});

test('service-worker registration is limited to HTTPS and a registration failure does not hide the guide',async()=>{
  const insecure=await start({protocol:'http:'});assert.equal(insecure.registrations.length,0);assert.equal(insecure.visible(),false);
  const unsupported=await start({serviceWorker:false});assert.equal(unsupported.registrations.length,0);
  const failed=await start({registrationError:true});assert.equal(failed.registrations.length,1);assert.equal(failed.visible(),true);failed.click('pwa-install-primary');await failed.settle();assert.equal(failed.visible('pwa-install-help'),true);
});

test('cooldown storage contains only installation preferences',async()=>{
  const b=await start();b.click('pwa-install-later');await b.settle();assert.ok(b.storageCalls.length>0);assert.ok(b.storageCalls.every(call=>call.key===DISMISSED_KEY));
  assert.ok(b.storageCalls.every(call=>Number.isFinite(Number(call.value))));
});
