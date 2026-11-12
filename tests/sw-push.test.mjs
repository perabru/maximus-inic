import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const scope='https://perabru.github.io/maximus-inic/';
function worker(clients=[],globals={}) {
  const handlers=new Map(),shown=[],opened=[],navigated=[];
  const self={location:new URL(scope+'sw.js'),registration:{scope,showNotification:async(...args)=>shown.push(args)},
    clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url),claim:async()=>{}},
    addEventListener:(name,handler)=>handlers.set(name,handler)};
  vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{self,URL,Response,...globals});
  return {handlers,shown,opened,navigated};
}
async function fire(handler,data) {
  let pending;
  handler({...data,waitUntil:promise=>{pending=promise;}});
  await pending;
}
test('push displays a generic branded notification without exposing arbitrary destinations',async()=>{
  const w=worker();
  await fire(w.handlers.get('push'),{data:{json:()=>({title:'untrusted',body:'Há uma entrega para hoje.',url:'https://example.invalid/phishing',tag:'delivery-1'})}});
  assert.equal(w.shown[0][0],'Máximu’s · INIC');
  assert.equal(w.shown[0][1].body,'Há uma entrega para hoje.');
  assert.equal(w.shown[0][1].data.url,scope+'portal.html#calendario');
});
test('malformed push still displays a safe calendar notification',async()=>{
  const w=worker();await fire(w.handlers.get('push'),{data:{json:()=>{throw Error('Malformed');}}});
  assert.equal(w.shown[0][1].data.url,scope+'portal.html#calendario');
  assert.match(w.shown[0][1].body,/calendário/);
});
test('notification click never opens a different origin or another repository path',async()=>{
  for(const url of ['https://example.invalid/','https://perabru.github.io/other/portal.html','javascript:alert(1)']){
    const w=worker();let closed=false;
    await fire(w.handlers.get('notificationclick'),{notification:{data:{url},close:()=>{closed=true;}}});
    assert.equal(closed,true);assert.deepEqual(w.opened,[scope+'portal.html#calendario']);
  }
});
test('notification reuses the portal window and focuses it',async()=>{
  const seen=[];
  const w=worker([{url:scope+'portal.html#inicio',navigate:async url=>seen.push(url),focus:async()=>seen.push('focused')}]);
  await fire(w.handlers.get('notificationclick'),{notification:{data:{url:scope+'portal.html#calendario'},close(){}}});
  assert.deepEqual(seen,[scope+'portal.html#calendario','focused']);assert.deepEqual(w.opened,[]);
});
test('private Firebase and authenticated requests bypass the public cache',()=>{
  const w=worker();let intercepted=false;
  const respondWith=()=>{intercepted=true;};
  w.handlers.get('fetch')({request:new Request('https://fir-ionic-a5e90.firebaseio.com/maximusInic/agreementFiles/2027/student.json'),respondWith});
  w.handlers.get('fetch')({request:new Request(scope+'portal.html',{headers:{Authorization:'Bearer test-only'}}),respondWith});
  assert.equal(intercepted,false);
});
test('activation removes outdated community assets and preserves the current and unrelated caches',async()=>{
  const removed=[];
  const w=worker([],{caches:{keys:async()=>['maximus-inic-public-20261112-7','maximus-inic-community-20261112-8','maximus-inic-community-20261112-9','maximus-inic-community-20261112-10','another-site-cache'],delete:async key=>{removed.push(key);return true;}}});
  await fire(w.handlers.get('activate'),{});
  assert.deepEqual(removed.sort(),['maximus-inic-community-20261112-8','maximus-inic-community-20261112-9','maximus-inic-public-20261112-7']);
});
