import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Drive the actual service with controllable, in-memory SDK subscriptions. No
// Firebase connection or real account is used; late callbacks are intentional.
const source=readFileSync(new URL('../firebase-service.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/\bexport (?=(?:const|async function|function)\b)/g,'');
const person=uid=>({name:`Pessoa ${uid}`,email:`${uid}@example.test`,year:'3º ano'});
const required=['users','roles','inactiveUsers','userArchives'];
const fixture={
  users:{student:person('student'),teacher:person('teacher'),blocked:person('blocked')},
  roles:{coord:'coordinator',teacher:'advisor'},
  inactiveUsers:{blocked:true},
  userArchives:{blocked:{role:'advisor',archivedAt:123}}
};
const snapshot=value=>({val:()=>value,exists:()=>value!==null&&value!==undefined});
function runtime(uid='coord'){
  const user={uid,email:`${uid}@example.test`,emailVerified:true};
  const auth={currentUser:user},listeners=[],authListeners=[],reads=[],states=[];
  const context={console,Blob,initializeApp:()=>({}),getApps:()=>[],getApp:()=>({}),getAuth:()=>auth,getDatabase:()=>({}),
    setPersistence:()=>Promise.resolve(),getRedirectResult:()=>Promise.resolve(null),browserSessionPersistence:{},GoogleAuthProvider:class{setCustomParameters(){}},
    ref:(_,path)=>path,query:(path,...constraints)=>({path,constraints}),orderByChild:key=>({orderByChild:key}),equalTo:value=>({equalTo:value}),limitToLast:count=>({limitToLast:count}),
    get:path=>new Promise((resolve,reject)=>reads.push({path,resolve:value=>resolve(snapshot(value)),reject})),
    onValue:(target,next,error)=>{
      const listener={path:target.path||target,next,error,live:true};listeners.push(listener);
      return()=>{listener.live=false;};
    },
    onAuthStateChanged:(_,next)=>{const listener={next,live:true};authListeners.push(listener);return()=>{listener.live=false;};}
  };
  vm.createContext(context);vm.runInContext(source,context);
  const subscribe=active=>{context.__user=active;context.__callback=value=>states.push(value);return vm.runInContext('subscribeApp(__user,__callback)',context);};
  const find=path=>{const listener=listeners.findLast(item=>item.live&&item.path===`maximusInic/${path}`);assert.ok(listener,`active listener for ${path}`);return listener;};
  const send=(path,value)=>find(path).next(snapshot(value));
  const stop=subscribe(user);
  return {auth,user,listeners,authListeners,reads,states,subscribe,find,send,stop,
    latest:()=>states.at(-1),
    people:()=>required.map(key=>find(key)),
    start:(role='coordinator',active=user)=>{send(`inactiveUsers/${active.uid}`,false);send(`users/${active.uid}`,person(active.uid));send(`roles/${active.uid}`,role);},
    complete:(values=fixture)=>{for(const key of required)send(key,values[key]??null);},
    changeSession:active=>{auth.currentUser=active;for(const listener of authListeners.filter(item=>item.live))listener.next(active);}
  };
}
function permutations(items){return items.length?items.flatMap((item,index)=>permutations(items.filter((_,position)=>position!==index)).map(rest=>[item,...rest])):[[]];}
function assertPending(state){assert.equal(state.usersReady,false);assert.equal(state.usersError,null);assert.equal(state.users.length,0);}
function assertClosed(listeners){assert.ok(listeners.every(listener=>!listener.live));}

test('coordinator waits for all four people sources in every arrival order',()=>{
  for(const order of permutations(required)){
    const client=runtime();client.start();assertPending(client.latest());
    for(const [index,key]of order.entries()){
      client.send(key,fixture[key]);
      if(index<order.length-1)assertPending(client.latest());
    }
    const state=client.latest();assert.equal(state.usersReady,true);assert.equal(state.usersError,null);assert.equal(state.users.length,3);
    assert.equal(state.users.find(person=>person.id==='teacher').role,'advisor');
    const blocked=state.users.find(person=>person.id==='blocked');
    assert.equal(blocked.archived,true);assert.equal(blocked.role,'advisor');assert.equal(blocked.archivedAt,123);
    assert.ok(!('rawUsers'in state));assert.ok(!('userRoles'in state));
    // Unrelated groups, invitations and notices need not finish loading first.
    assert.equal(state.groups.length,0);assert.equal(state.orientationNoticesReady,false);client.stop();
  }
});

test('a genuinely empty database finishes loading successfully',()=>{
  const client=runtime();client.start();client.complete({});
  assert.equal(client.latest().usersReady,true);assert.equal(client.latest().usersError,null);assert.equal(client.latest().users.length,0);client.stop();
});

test('live changes retain readiness and refresh profile, role and archive decoration',()=>{
  const client=runtime();client.start();client.complete();
  client.send('users',{...fixture.users,student:{...person('student'),name:'Nome corrigido'}});
  assert.equal(client.latest().users.find(person=>person.id==='student').name,'Nome corrigido');
  client.send('roles',{...fixture.roles,student:'advisor'});
  assert.equal(client.latest().users.find(person=>person.id==='student').role,'advisor');
  client.send('inactiveUsers',{});client.send('userArchives',{});
  assert.equal(client.latest().users.find(person=>person.id==='blocked').archived,false);
  assert.equal(client.latest().users.find(person=>person.id==='blocked').archive,null);
  assert.equal(client.latest().usersReady,true);assert.equal(client.latest().usersError,null);client.stop();
});

test('every required-source error clears partial or loaded data and rejects late callbacks',()=>{
  for(const key of required)for(const loaded of [false,true]){
    const client=runtime();client.start();
    if(loaded)client.complete();else client.send('users',fixture.users);
    const people=client.people(),error={code:'PERMISSION_DENIED',message:'Acesso de teste encerrado.'};
    client.find(key).error(error);
    assert.equal(client.latest().usersReady,false);assert.equal(client.latest().users.length,0);assert.equal(client.latest().usersError,error);assertClosed(people);
    const count=client.states.length;
    for(const listener of people){listener.next(snapshot(fixture[listener.path.split('/').at(-1)]));listener.error({code:'late'});}
    assert.equal(client.states.length,count);
    client.send('groups',{});assert.equal(client.latest().usersError,error);assert.equal(client.latest().usersReady,false);client.stop();
  }
});

test('students and advisors never subscribe to global people data',()=>{
  for(const role of ['student','advisor']){
    const client=runtime();client.start(role);assertPending(client.latest());
    assert.ok(required.every(key=>!client.listeners.some(listener=>listener.path===`maximusInic/${key}`)));client.stop();
  }
});

test('leaving and regaining coordination drops stale people and requires fresh snapshots',()=>{
  for(const role of ['student','advisor']){
    const client=runtime();client.start();client.complete();const previous=client.people();
    client.send('roles/coord',role);assert.equal(client.latest().role,role);assertPending(client.latest());assertClosed(previous);
    const count=client.states.length;
    for(const listener of previous)listener.next(snapshot(fixture[listener.path.split('/').at(-1)]));
    assert.equal(client.states.length,count);
    client.send('roles/coord','coordinator');assertPending(client.latest());
    for(const listener of previous)listener.next(snapshot(fixture[listener.path.split('/').at(-1)]));
    assertPending(client.latest());client.complete();assert.equal(client.latest().usersReady,true);client.stop();
  }
});

test('a new coordination scope clears a previous people error',()=>{
  const client=runtime();client.start();client.find('users').error({code:'unavailable'});
  assert.ok(client.latest().usersError);client.send('roles/coord','student');assertPending(client.latest());
  client.send('roles/coord','coordinator');assertPending(client.latest());client.complete();assert.equal(client.latest().usersReady,true);client.stop();
});

test('role cancellation immediately removes privileged data and rejects queued role callbacks',()=>{
  const client=runtime();client.start();client.complete();const people=client.people(),role=client.find('roles/coord');
  const error={code:'PERMISSION_DENIED',message:'Papel revogado.'};role.error(error);
  assert.equal(client.latest().role,'student');assert.equal(client.latest().error,error);assertPending(client.latest());assertClosed(people);
  const count=client.states.length;role.next(snapshot('coordinator'));
  for(const listener of people)listener.next(snapshot({}));
  assert.equal(client.states.length,count);client.stop();
});

test('blocking and reactivating the account resets readiness and ignores an old archive fetch',async()=>{
  const client=runtime();client.start();client.complete();const previous=client.people();
  client.send('inactiveUsers/coord',true);assert.equal(client.latest().archived,true);assertPending(client.latest());assertClosed(previous);
  const count=client.states.length;for(const listener of previous)listener.next(snapshot({}));assert.equal(client.states.length,count);
  const archivedRead=client.reads.at(-1);assert.equal(archivedRead.path,'maximusInic/userArchives/coord');
  client.send('inactiveUsers/coord',false);client.send('roles/coord','coordinator');assertPending(client.latest());
  archivedRead.resolve({archivedAt:123,reason:'obsolete'});await Promise.resolve();
  assert.equal(client.latest().archive,null);assert.equal(client.latest().archived,false);
  client.complete();assert.equal(client.latest().usersReady,true);client.stop();
});

test('authoritative inactive-status cancellation clears data and closes the session scope',()=>{
  const client=runtime();client.start();client.complete();const all=[...client.listeners],inactive=client.find('inactiveUsers/coord');
  inactive.error({code:'PERMISSION_DENIED'});assertPending(client.latest());assert.equal(client.latest().profile,null);assert.equal(client.latest().role,'student');assertClosed(all);
  const count=client.states.length;inactive.next(snapshot(false));assert.equal(client.states.length,count);client.stop();
});

test('session changes clear people before a replacement session can load',()=>{
  for(const active of [null,{uid:'next',email:'next@example.test',emailVerified:true}]){
    const client=runtime();client.start();client.complete();const previous=[...client.listeners];
    client.changeSession(active);assertPending(client.latest());assert.equal(client.latest().profile,null);assert.equal(client.latest().role,'student');assert.equal(client.latest().error.code,'PERMISSION_DENIED');assertClosed(previous);
    const count=client.states.length;
    for(const listener of previous){listener.next(snapshot(null));listener.error({code:'late'});}
    assert.equal(client.states.length,count);
    if(active){const stopNext=client.subscribe(active);client.start('coordinator',active);assertPending(client.latest());client.complete({});assert.equal(client.latest().usersReady,true);assert.equal(client.latest().users.length,0);stopNext();}
    client.stop();
  }
});

test('a database callback after auth changes cannot publish old data before the auth observer',()=>{
  const client=runtime();client.start();client.complete();const users=client.find('users');
  client.auth.currentUser={uid:'next'};users.next(snapshot(fixture.users));assertPending(client.latest());assert.equal(client.latest().profile,null);assert.equal(client.latest().error.code,'PERMISSION_DENIED');
  assertClosed(client.listeners);client.stop();
});

test('unsubscribe ignores every queued database and auth callback',async()=>{
  const client=runtime();client.start();client.complete();client.send('inactiveUsers/coord',true);
  const count=client.states.length;client.stop();assertClosed(client.listeners);assertClosed(client.authListeners);
  for(const listener of client.listeners){listener.next(snapshot(null));listener.error({code:'late'});}
  for(const listener of client.authListeners)listener.next(null);
  client.reads.at(-1).resolve({archivedAt:999});await Promise.resolve();assert.equal(client.states.length,count);
});


test('community waits for the coordinator backfill even after the directory snapshot',async()=>{
  const client=runtime();client.start();client.send('peopleDirectory',null);client.complete({});
  assert.equal(client.latest().peopleReady,false);assert.equal(client.latest().peopleError,null);
  const completed=new Set();
  for(let step=0;step<16;step++){for(const read of client.reads)if(!completed.has(read)){completed.add(read);read.resolve(read.path==='maximusInic/roles/coord'?'coordinator':null);}await Promise.resolve();}
  assert.equal(client.latest().peopleReady,true);assert.equal(client.latest().peopleError,null);client.stop();
});

test('community shows a backfill prerequisite error instead of endless loading',()=>{
  const client=runtime();client.start();client.send('peopleDirectory',null);
  const error={code:'PERMISSION_DENIED',message:'Source unavailable'};client.find('users').error(error);
  assert.equal(client.latest().peopleReady,false);assert.equal(client.latest().peopleError,error);
  client.send('peopleDirectory',{});assert.equal(client.latest().peopleError,error);assert.equal(client.latest().peopleReady,false);client.stop();
});
