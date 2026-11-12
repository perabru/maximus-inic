import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the real browser service with an in-memory SDK. This suite tests
// cleanup planning and retries; database authorization is covered separately
// by the Firebase emulator. No network or real Firebase account is used here.
const source=readFileSync(new URL('../firebase-service.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/\bexport (?=(?:const|async function|function)\b)/g,'');
const clone=value=>value===undefined?undefined:structuredClone(value);
const time=1900000000000;
const read=(data,path)=>path.split('/').filter(Boolean).reduce((node,key)=>node?.[key],data)??null;
function assign(data,path,value){
  const keys=path.split('/').filter(Boolean),parents=[];let node=data;
  for(const key of keys.slice(0,-1)){parents.push([node,key]);node=node[key]??={};}
  const last=keys.at(-1);
  if(value===null)delete node[last];else node[last]=value;
  for(const [parent,key]of parents.reverse())if(parent[key]&&typeof parent[key]==='object'&&!Object.keys(parent[key]).length)delete parent[key];
}
function timestamps(value){
  if(!value||typeof value!=='object')return value;
  if(value['.sv']==='timestamp')return time;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,timestamps(item)]));
}
function runtime(data,uid='coord',{beforeUpdate}={}){
  const calls=[],auth={currentUser:{uid,email:`${uid}@example.com`,displayName:uid,providerData:[]}};
  const update=async(target,patch)=>{
    const keys=Object.keys(patch).sort();
    assert.ok(!keys.some((key,index)=>index&&key.startsWith(keys[index-1]+'/')),'multi-location writes never overlap');
    calls.push({target,patch:clone(patch)});
    if(beforeUpdate)await beforeUpdate(target,patch,calls.length,auth);
    const next=clone(data);
    for(const [key,value]of Object.entries(patch))assign(next,`${target}/${key}`,timestamps(clone(value)));
    for(const key of Object.keys(data))delete data[key];Object.assign(data,next);
  };
  const context={console,Blob,initializeApp:()=>({}),getApps:()=>[],getApp:()=>({}),getAuth:()=>auth,getDatabase:()=>({}),
    setPersistence:()=>Promise.resolve(),getRedirectResult:()=>Promise.resolve(null),browserSessionPersistence:{},GoogleAuthProvider:class{setCustomParameters(){}},
    ref:(_,path)=>path,serverTimestamp:()=>({'.sv':'timestamp'}),
    get:async path=>({val:()=>clone(read(data,path)),exists:()=>read(data,path)!==null}),
    update,set:async(path,value)=>update(path.substring(0,path.lastIndexOf('/')),{[path.split('/').at(-1)]:value}),
    updateProfile:async(user,patch)=>Object.assign(user,patch)};
  vm.createContext(context);vm.runInContext(source,context);
  return {calls,auth,call:async(name,...args)=>{context.__args=args;return vm.runInContext(`${name}(...__args)`,context);}};
}
function fixture(){
  const profile=uid=>({name:uid,email:`${uid}@example.com`,year:'2º ano',requestedRole:uid==='teacher'?'advisor':'student',createdAt:1});
  const group=(members,advisorId='teacher')=>({name:'Pesquisa conjunta',topic:'Tema',year:2027,status:'active',createdBy:'student',createdAt:1,advisorId,advisorRequestVersion:1,members:Object.fromEntries(members.map(uid=>[uid,true])),memberNames:Object.fromEntries(members.map(uid=>[uid,uid]))});
  const invitation=(senderId,toEmail='',toUid='',status='pending')=>({groupId:'group',groupName:'Pesquisa conjunta',senderId,senderName:senderId,toEmail,toUid,status,type:toUid?'advisor':'member',createdAt:1});
  return {maximusInic:{
    users:{coord:profile('coord'),otherCoord:profile('otherCoord'),student:profile('student'),peer:profile('peer'),teacher:profile('teacher'),otherTeacher:profile('otherTeacher')},
    roles:{coord:'coordinator',otherCoord:'coordinator',teacher:'advisor',otherTeacher:'advisor'},
    advisorDirectory:{teacher:{uid:'teacher',name:'teacher'},otherTeacher:{uid:'otherTeacher',name:'otherTeacher'}},
    groups:{group:group(['student','peer']),solo:group(['student']),orphanAlias:{...group(['peer']),memberNames:{peer:'peer',student:'Nome antigo'}}},
    userGroups:{student:{group:true,solo:true,missingGroup:true},peer:{group:true,orphanAlias:true}},
    invitations:{byStudent:invitation('student','peer@example.com','','accepted'),toEmail:invitation('peer','STUDENT@EXAMPLE.COM'),oldEmail:invitation('coord','student@example.com','','declined'),toUid:invitation('peer','','student','cancelled'),keep:invitation('peer','other@example.com'),request:invitation('student','','otherTeacher'),keepRequest:invitation('peer','','teacher')},
    invitationIssuedAt:{byStudent:1,toEmail:1,oldEmail:1,toUid:1,keep:1,request:1,keepRequest:1},
    admissions:{group:{student:'toEmail',peer:'byStudent'},missingGroup:{student:'oldInvite'},unrelated:{peer:'keep'}},
    memberRevocations:{missingGroup:{student:10,peer:20}},
    evaluations:{group:{group:{score:8,feedback:'Avaliação coletiva'},members:{student:{score:7},peer:{score:9}}},missingGroup:{members:{student:{score:6}}}},
    inicResults:{2027:{group:{student:{status:'approved'},peer:{status:'approved'}}},2028:{missingGroup:{student:{status:'correction'}}}},
    advisorRequests:{pending:{otherTeacher:'request',teacher:'keepRequest'},orphan:{student:'noInvite'}},
    advisorRequestSlots:{pending:{0:'otherTeacher',1:'teacher'},orphan:{0:'student'}},
    advisorConfirmations:{group:{studentUid:'student',advisorUid:'teacher',invitationId:'receipt'},keep:{studentUid:'peer',advisorUid:'otherTeacher',invitationId:'keptReceipt'}},
    agreements:{2027:{student:{ownerName:'student'},peer:{ownerName:'peer'}}},
    agreementFiles:{2027:{student:{base64:'personal-bytes'},peer:{base64:'peer-bytes'}},2100:{student:{base64:'orphan-personal-bytes'}}},
    agreementReviews:{2027:{student:{status:'approved'},peer:{status:'approved'}}},
    agreementSignatures:{2027:{student:{advisor:{teacher:{signerName:'teacher'}}},peer:{advisor:{teacher:{signerName:'teacher'}}}}},
    agreementAdvisorAccess:{2027:{student:{teacher:'group'},peer:{teacher:'group'}}},
    pushSubscriptions:{student:{device:{endpoint:'private-endpoint'}},peer:{device:{endpoint:'peer-endpoint'}}},
    orientationNotices:{student:{notice:{type:'assigned'}},peer:{notice:{type:'assigned'}}},
    articles:{group:{introduction:{text:'Texto compartilhado',updatedBy:'student',authorName:'student',revision:2}}},
    messages:{group:{message:{text:'Histórico do grupo',senderId:'student',senderName:'student'}}},
    tasks:{group:{task:{title:'Artigo',createdBy:'student'}}},
    proposalFiles:{group:{base64:'shared-proposal'}},
    orientationTransitions:{group:{transition:{oldAdvisorUid:'teacher',actorUid:'coord'}}}
  }};
}
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS',name);}
const value=(data,path)=>read(data,`maximusInic/${path}`);

await test('coordination name correction reaches every current group, including old aliases',async()=>{
  const data=fixture();data.maximusInic.groups.group.memberNames.student='Apelido antigo';
  await runtime(data).call('updateUser','student',{name:'Nome corrigido',year:'3º ano'});
  assert.equal(value(data,'users/student/name'),'Nome corrigido');assert.equal(value(data,'groups/group/memberNames/student'),'Nome corrigido');
  assert.equal(value(data,'groups/solo/memberNames/student'),'Nome corrigido');assert.equal(value(data,'messages/group/message/senderName'),'student');
  assert.equal(value(data,'users/student/email'),'student@example.com');assert.equal(value(data,'users/student/createdAt'),1);
});
await test('student and advisor cannot invoke global management or permanent deletion',async()=>{
  for(const uid of ['student','teacher']){
    const data=fixture(),before=clone(data),client=runtime(data,uid);
    await assert.rejects(client.call('deleteUserPermanently','peer'),/Somente a coordenação/);
    await assert.rejects(client.call('updateUser','peer',{name:'Troca'}),/Somente a coordenação/);
    assert.deepEqual(data,before);assert.equal(client.calls.length,0);
  }
});
await test('coordination profiles and the current coordination account are protected',async()=>{
  for(const uid of ['coord','otherCoord']){
    const data=fixture(),before=clone(data),client=runtime(data);
    await assert.rejects(client.call('deleteUserPermanently',uid),/coordenação está protegido/);assert.deepEqual(data,before);assert.equal(client.calls.length,0);
  }
});
await test('older database rules reject the new lock without changing the person',async()=>{
  const data=fixture(),before=clone(data),client=runtime(data,'coord',{beforeUpdate:(_,patch)=>{
    assert.equal(patch['userArchives/student'].status,'deleting');throw Object.assign(new Error('permission_denied'),{code:'PERMISSION_DENIED'});
  }});
  await assert.rejects(client.call('deleteUserPermanently','student'),error=>error.code==='account/deletion-unavailable');assert.deepEqual(data,before);
});
await test('permanent deletion removes personal records, orphan indexes, email invitations and every supported document year',async()=>{
  const data=fixture(),client=runtime(data);await client.call('deleteUserPermanently','student');
  for(const path of ['users/student','roles/student','advisorDirectory/student','userGroups/student','userArchives/student','pushSubscriptions/student','orientationNotices/student','groups/group/members/student','groups/group/memberNames/student','groups/solo/members/student','groups/orphanAlias/memberNames/student','admissions/group/student','admissions/group/peer','admissions/missingGroup/student','memberRevocations/missingGroup/student','evaluations/group/members/student','evaluations/missingGroup/members/student','inicResults/2027/group/student','inicResults/2028/missingGroup/student','advisorRequests/pending/otherTeacher','advisorRequestSlots/pending/0','advisorRequests/orphan/student','advisorRequestSlots/orphan/0','advisorConfirmations/group'])assert.equal(value(data,path),null,path);
  for(let year=2027;year<=2100;year++)for(const resource of ['agreements','agreementFiles','agreementReviews','agreementSignatures','agreementAdvisorAccess'])assert.equal(value(data,`${resource}/${year}/student`),null,`${resource}/${year}`);
  for(const id of ['byStudent','toEmail','oldEmail','toUid','request'])for(const resource of ['invitations','invitationIssuedAt'])assert.equal(value(data,`${resource}/${id}`),null,`${resource}/${id}`);
  assert.equal(value(data,'inactiveUsers/student'),true);assert.equal(client.calls.length,2);
});
await test('deleting a student preserves colleagues and shared authorship without recreating membership',async()=>{
  const data=fixture(),before=clone(data);await runtime(data).call('deleteUserPermanently','student');
  for(const path of ['users/peer','groups/group/advisorId','groups/group/createdBy','groups/group/members/peer','groups/group/memberNames/peer','userGroups/peer','evaluations/group/group','evaluations/group/members/peer','inicResults/2027/group/peer','agreements/2027/peer','agreementFiles/2027/peer','agreementReviews/2027/peer','agreementSignatures/2027/peer','agreementAdvisorAccess/2027/peer','articles','messages','tasks','proposalFiles','orientationTransitions','orientationNotices/peer','pushSubscriptions/peer','invitations/keep','invitations/keepRequest','invitationIssuedAt/keep','admissions/unrelated','advisorRequests/pending/teacher','advisorRequestSlots/pending/1','advisorConfirmations/keep'])assert.deepEqual(value(data,path),value(before,path),path);
  assert.ok(value(data,'groups/solo'),'empty group remains available to coordination');
});
await test('failed cleanup retains a blocked, visible profile and retry completes without another lock',async()=>{
  const data=fixture(),client=runtime(data,'coord',{beforeUpdate:(_,patch,attempt)=>{if(attempt===2)throw new Error('synthetic connection interruption');}});
  await assert.rejects(client.call('deleteUserPermanently','student'),error=>error.code==='account/deletion-incomplete');
  assert.equal(value(data,'users/student/name'),'student');assert.equal(value(data,'inactiveUsers/student'),true);assert.equal(value(data,'userArchives/student/status'),'deleting');
  assert.equal(value(data,'groups/group/members/student'),true);assert.equal(value(data,'agreementFiles/2027/student/base64'),'personal-bytes');
  const lockedAudit=clone(value(data,'userArchives/student'));
  await client.call('deleteUserPermanently','student');assert.equal(value(data,'users/student'),null);assert.equal(client.calls.length,3);
  assert.equal(client.calls[2].patch['userArchives/student'],null);assert.equal(lockedAudit.status,'deleting');
  await client.call('deleteUserPermanently','student');assert.equal(client.calls.length,3,'a completed deletion is idempotent');
});
await test('individual paths are cleared even if a grade appears after the metadata snapshot',async()=>{
  const data=fixture();delete data.maximusInic.evaluations.group.members.student;delete data.maximusInic.inicResults[2027].group.student;delete data.maximusInic.admissions.group.student;
  const client=runtime(data,'coord',{beforeUpdate:(_,patch,attempt)=>{if(attempt!==2)return;
    data.maximusInic.evaluations.group.members.student={score:10};data.maximusInic.inicResults[2027].group.student={status:'approved'};data.maximusInic.admissions.group.student='late-invite';
    for(const path of ['evaluations/group/members/student','inicResults/2027/group/student','admissions/group/student'])assert.equal(patch[path],null,path);
  }});
  await client.call('deleteUserPermanently','student');
  for(const path of ['evaluations/group/members/student','inicResults/2027/group/student','admissions/group/student'])assert.equal(value(data,path),null,path);
});
await test('old archived and interrupted archiving records enter the new irreversible flow',async()=>{
  for(const status of ['archived','archiving','restored']){
    const data=fixture();data.maximusInic.userArchives={student:{uid:'student',role:'student',status,archivedAt:5,archivedBy:'otherCoord',archivedByName:'Antigo',inviteCutoff:5,restoredAt:6}};
    if(status!=='restored')data.maximusInic.inactiveUsers={student:true};
    const client=runtime(data);await client.call('deleteUserPermanently','student');
    assert.equal(client.calls[0].patch['userArchives/student'].status,'deleting');assert.equal(client.calls[0].patch['userArchives/student'].archivedBy,'coord');assert.equal(client.calls[0].patch['userArchives/student'].restoredAt,undefined);
    assert.equal(value(data,'users/student'),null);assert.equal(value(data,'userArchives/student'),null);
  }
});
await test('a group deletion in progress leaves an explicit resumable lock and never resurrects the group',async()=>{
  const data=fixture();data.maximusInic.groups.group.status='deleting';const client=runtime(data);
  await assert.rejects(client.call('deleteUserPermanently','student'),/Conclua a exclusão do grupo/);
  assert.equal(value(data,'userArchives/student/status'),'deleting');assert.equal(value(data,'users/student/name'),'student');
  delete data.maximusInic.groups.group;
  await client.call('deleteUserPermanently','student');assert.equal(value(data,'users/student'),null);assert.equal(value(data,'groups/group'),null);
});
await test('advisor deletion releases orientation and access indexes but keeps colleague signatures',async()=>{
  const data=fixture();data.maximusInic.groups.group.members.teacher=true;data.maximusInic.groups.group.memberNames.teacher='teacher';
  data.maximusInic.userGroups.teacher={group:true};
  const signature=clone(value(data,'agreementSignatures/2027/peer/advisor/teacher'));
  await runtime(data).call('deleteUserPermanently','teacher');
  assert.equal(value(data,'groups/group/advisorId'),'');assert.equal(value(data,'groups/group/members/teacher'),null);assert.equal(value(data,'memberRevocations/group/teacher'),null);
  assert.equal(value(data,'advisorDirectory/teacher'),null);assert.equal(value(data,'roles/teacher'),null);
  assert.equal(value(data,'agreementAdvisorAccess/2027/peer/teacher'),null);assert.equal(value(data,'agreementAdvisorAccess/2027/student/teacher'),null);
  assert.deepEqual(value(data,'agreementSignatures/2027/peer/advisor/teacher'),signature);assert.ok(value(data,'users/peer'));
});
await test('remaining Firebase Auth identity cannot recreate a permanently removed profile',async()=>{
  const data=fixture();await runtime(data).call('deleteUserPermanently','student');
  const student=runtime(data,'student');
  await assert.rejects(student.call('ensureProfile',student.auth.currentUser),error=>error.code==='account/archived');
  await assert.rejects(student.call('saveProfile',{name:'Recriado'}),error=>error.code==='account/archived');
  assert.equal(value(data,'users/student'),null);assert.equal(value(data,'inactiveUsers/student'),true);assert.equal(student.calls.length,0);
});
console.log(`\n${passed} user management runtime scenarios passed.`);
