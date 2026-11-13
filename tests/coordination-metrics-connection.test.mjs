import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Execute the actual service with an in-memory SDK boundary. Every identity and
// record is synthetic; this harness cannot connect to Firebase or the network.
const source=readFileSync(new URL('../firebase-service.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/\bexport (?=(?:const|async function|function)\b)/g,'');
const root='maximusInic/',connectionPath='.info/connected';
const snapshot=value=>({val:()=>value,exists:()=>value!==null&&value!==undefined});
const fixture={
  groups:{research:{name:'Grupo de teste',year:2027,members:{student:true}}},
  'inicBoards/2027':{research:{board:{title:'Banca de teste',date:'2027-10-20',status:'approved'}}},
  'inicResults/2027':{research:{student:{status:'approved'}}},
  tasks:{research:{draft:{title:'Artigo de teste',completed:true}}},
  inactiveUsers:{}
};
function runtime({failConnection=false}={}){
  const user={uid:'coord',email:'coord@example.test'},listeners=[],states=[],attempts=[];
  const context={console,Blob,initializeApp:()=>({}),getApps:()=>[],getApp:()=>({}),
    getAuth:()=>({currentUser:user}),getDatabase:()=>({}),
    setPersistence:()=>Promise.resolve(),getRedirectResult:()=>Promise.resolve(null),
    browserSessionPersistence:{},GoogleAuthProvider:class{setCustomParameters(){}},
    ref:(_,path)=>path,
    onValue:(path,next,error)=>{
      attempts.push(path);
      if(failConnection&&path===connectionPath)throw new Error('Synthetic connection-info failure');
      const listener={path,next,error,live:true,stopCalls:0};listeners.push(listener);
      return()=>{listener.live=false;listener.stopCalls++;};
    }
  };
  vm.createContext(context);vm.runInContext(source,context);
  context.__callback=value=>states.push(value);
  const stop=vm.runInContext('subscribeCoordinationMetrics(2027,__callback)',context);
  const find=path=>{
    const listener=listeners.findLast(item=>item.live&&item.path===path);
    assert.ok(listener,`Missing active listener: ${path}`);return listener;
  };
  const send=(path,value)=>find(path).next(snapshot(value));
  return {listeners,states,attempts,stop,find,send,latest:()=>states.at(-1),
    start:(role='coordinator')=>{send(root+'inactiveUsers/coord',false);send(root+'roles/coord',role);},
    complete:()=>{for(const [path,value]of Object.entries(fixture))send(root+path,value);}
  };
}
function assertCleared(state){
  assert.equal(state.ready,false);assert.equal(state.connected,null);
  for(const key of ['boards','results','tasks'])assert.equal(state[key].length,0,key);
}

test('Firebase connection is independent of the five-source readiness gate',()=>{
  const client=runtime();assert.equal(client.attempts.includes(connectionPath),false);
  client.start();assertCleared(client.latest());
  client.send(connectionPath,true);
  assert.equal(client.latest().connected,true);assert.equal(client.latest().ready,false);
  const entries=Object.entries(fixture);
  for(const [index,[path,value]]of entries.entries()){
    client.send(root+path,value);
    assert.equal(client.latest().ready,index===entries.length-1);
    assert.equal(client.latest().connected,true);
  }
  assert.equal(client.latest().boards.length,1);
  assert.equal(client.latest().results.length,1);
  assert.equal(client.latest().tasks.length,1);
  assert.equal(client.listeners.filter(item=>item.path===connectionPath).length,1);
  client.stop();
  const unknown=runtime();unknown.start();unknown.complete();
  assert.equal(unknown.latest().ready,true);assert.equal(unknown.latest().connected,null);
  unknown.stop();
});

test('disconnect and reconnect preserve the authorized snapshot and live data updates',()=>{
  const client=runtime();client.start();client.complete();client.send(connectionPath,true);
  const complete=client.latest();
  for(const connected of [false,true]){
    client.send(connectionPath,connected);
    assert.equal(client.latest().ready,true);assert.equal(client.latest().connected,connected);
    for(const key of ['boards','results','tasks'])assert.equal(client.latest()[key],complete[key]);
    assert.equal(client.latest().error,undefined);
  }
  client.send(root+'inicBoards/2027',{research:{board:{title:'Banca atualizada',status:'correction'}}});
  assert.equal(client.latest().connected,true);assert.equal(client.latest().ready,true);
  assert.equal(client.latest().boards[0].title,'Banca atualizada');client.stop();
});

test('unknown values and connection-info errors never fake readiness or erase data',()=>{
  const client=runtime();client.start();const connection=client.find(connectionPath);
  connection.error(new Error('Synthetic connection-info failure'));
  assertCleared(client.latest());assert.equal(client.latest().error,undefined);
  client.complete();const complete=client.latest();client.send(connectionPath,true);
  connection.error(new Error('Synthetic connection-info failure'));
  assert.equal(client.latest().connected,null);assert.equal(client.latest().ready,true);
  for(const key of ['boards','results','tasks'])assert.equal(client.latest()[key],complete[key]);
  assert.equal(client.latest().error,undefined);
  for(const value of [null,undefined,'true',1]){
    client.send(connectionPath,value);assert.equal(client.latest().connected,null);
  }
  client.stop();
});

test('a connection-info subscription failure does not block the actual data sources',()=>{
  const client=runtime({failConnection:true});client.start();client.complete();
  assert.equal(client.latest().ready,true);assert.equal(client.latest().connected,null);
  assert.equal(client.latest().boards.length,1);assert.equal(client.latest().error,undefined);
  client.stop();assert.ok(client.listeners.every(item=>!item.live));
});

test('revocation and account exclusion detach connection and suppress queued callbacks',()=>{
  for(const revoke of [client=>client.send(root+'roles/coord','advisor'),client=>client.send(root+'inactiveUsers/coord',true)]){
    const client=runtime();client.start();client.complete();client.send(connectionPath,true);
    const connection=client.find(connectionPath),board=client.find(root+'inicBoards/2027');
    revoke(client);assertCleared(client.latest());assert.ok(client.latest().error);
    assert.equal(connection.live,false);assert.equal(connection.stopCalls,1);
    const count=client.states.length;
    connection.next(snapshot(true));connection.error(new Error('Late connection-info error'));
    board.next(snapshot(fixture['inicBoards/2027']));assert.equal(client.states.length,count);
    client.stop();
  }
});

test('a private data-source failure detaches connection and clears the complete snapshot',()=>{
  const client=runtime();client.start();client.complete();client.send(connectionPath,true);
  const connection=client.find(connectionPath),failure=new Error('Synthetic permission denied');
  client.find(root+'inicResults/2027').error(failure);
  assertCleared(client.latest());assert.equal(client.latest().error,failure);
  assert.equal(connection.live,false);assert.equal(connection.stopCalls,1);
  const count=client.states.length;connection.next(snapshot(true));assert.equal(client.states.length,count);
  client.stop();
});

test('a new authorized generation ignores its old connection listener',()=>{
  const client=runtime();client.start();client.complete();client.send(connectionPath,true);
  const previous=client.find(connectionPath);
  client.send(root+'roles/coord','coordinator');
  assert.equal(previous.live,false);assertCleared(client.latest());
  const next=client.find(connectionPath);assert.notEqual(next,previous);
  const count=client.states.length;previous.next(snapshot(true));assert.equal(client.states.length,count);
  client.complete();assert.equal(client.latest().connected,null);
  next.next(snapshot(false));assert.equal(client.latest().ready,true);assert.equal(client.latest().connected,false);
  assert.equal(client.listeners.filter(item=>item.path===connectionPath&&item.live).length,1);
  client.stop();
});

test('destroy stops every listener and unauthorized accounts never attach connection-info',()=>{
  const client=runtime();client.start();client.complete();client.send(connectionPath,true);
  const connection=client.find(connectionPath),count=client.states.length;
  client.stop();assert.ok(client.listeners.every(item=>!item.live));assert.equal(connection.stopCalls,1);
  connection.next(snapshot(false));connection.error(new Error('Late error'));
  assert.equal(client.states.length,count);
  for(const role of ['student','advisor']){
    const denied=runtime();denied.start(role);
    assert.equal(denied.attempts.includes(connectionPath),false);assertCleared(denied.latest());
    denied.stop();
  }
  const inactive=runtime();inactive.send(root+'inactiveUsers/coord',true);
  assert.equal(inactive.attempts.includes(connectionPath),false);assertCleared(inactive.latest());inactive.stop();
});
