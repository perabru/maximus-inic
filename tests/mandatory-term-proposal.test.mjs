import assert from 'node:assert/strict';
import {ref,set,get,update,query,orderByChild,equalTo,serverTimestamp} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// This suite is called by security.mjs after the legacy scenarios. Its only
// clients are the guarded demo-maximus-inic emulator clients supplied by it.
export async function runMandatoryTermProposalTests({env,db,ok,no,count}) {
 const root='maximusInic';
 const textProposal={mode:'text',topics:{problem:'Proposta sintética',objective:'',method:'',expectedResult:''}};
 const stamp=Date.now();
 const pdf=Buffer.from('%PDF-1.7\nSynthetic signed-term test fixture\n%%EOF');
 const bytesFile={name:'Termo assinado.pdf',type:'application/pdf',size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)};
 const person=(uid,requestedRole='student')=>({name:uid,email:`${uid.toLowerCase()}@example.com`,requestedRole,year:requestedRole==='student'?'3º ano':'',createdAt:stamp});
 const group=(uid,advisorId='')=>({name:`Grupo ${uid}`,topic:'Pesquisa de teste',description:'',year:2027,advisorId,members:{[uid]:true},memberNames:{[uid]:uid},createdBy:uid,createdAt:stamp,status:'active'});
 const metadata=(uid,year=2027)=>({uid,year,filename:'Termo assinado.pdf',ownerName:uid,size:pdf.length,contentType:'application/pdf',uploadedAt:stamp});
 const document=()=>({base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp});
 const term=(uid,year=2027)=>({[`agreements/${year}/${uid}`]:metadata(uid,year),[`agreementFiles/${year}/${uid}`]:document()});
 const invitation=(groupId,toUid)=>({groupId,groupName:`Grupo ${groupId}`,toEmail:'',toUid,type:'advisor',senderId:'npReady',senderName:'npReady',status:'pending',createdAt:serverTimestamp()});
 const proposal=(uid)=>({...group(uid),advisorRequestPolicy:'first-accept-v1',advisorRequestVersion:0,proposalRequired:true});
 const admin=async(fn)=>env.withSecurityRulesDisabled(async context=>fn(context.database()));
 const value=async(path)=>{
  let result;
  await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});
  return result;
 };
 const reject=async(name,operation)=>{
  let rejected=false;
  try{await operation();}catch{rejected=true;}
  assert.equal(rejected,true,name);
  count(name);
 };
 const assertion=(name,condition)=>{assert.ok(condition,name);count(name);};
 const waitRequirement=(service,predicate)=>new Promise((resolve,rejectPromise)=>{
  let stop=()=>{};
  const timer=setTimeout(()=>{stop();rejectPromise(new Error('Mandatory-term subscription timed out'));},5000);
  stop=service('subscribeAgreements',2027,state=>{
   if(state.error){clearTimeout(timer);stop();rejectPromise(state.error);return;}
   if(predicate(state)){clearTimeout(timer);stop();resolve(state);}
  });
 });

 const students=['npMissing','npReady','npOther','npOrphan','npFile','npMismatch','npWrongYear','npPending','npDeferred','npRejected','npSessionLogout','npSessionUnsub'];
 const advisors=['npAdvisor1','npAdvisor2','npAdvisor3','npAdvisor4'];
 const changes={};
 for(const uid of [...students,...advisors,'npCoord'])changes[`users/${uid}`]=person(uid,advisors.includes(uid)||uid==='npCoord'?'advisor':'student');
 changes['users/npPending']=person('npPending','advisor');
 changes['roles/npCoord']='coordinator';
 changes['notificationWorkers/npWorker']=true;
 for(const uid of advisors){changes[`roles/${uid}`]='advisor';changes[`advisorDirectory/${uid}`]={uid,name:uid};}
 changes['advisorDirectory/npCoord']={uid:'npCoord',name:'npCoord'};
 for(const [gid,uid,advisor] of [['npGate','npMissing','npAdvisor1'],['npReadyGroup','npReady','npAdvisor1'],['npForeignGroup','npOther','npAdvisor2'],['npPendingGroup','npPending','npAdvisor1']]){
  changes[`groups/${gid}`]=group(uid,advisor);
  changes[`userGroups/${uid}/${gid}`]=true;
 }
 changes['tasks/npGate/artigo']={title:'Artigo',dueDate:'2027-07-31',completed:false,completedBy:'',weight:1,createdBy:'npAdvisor1',createdAt:stamp};
 changes['groups/npLegacyProposal']=group('npReady');
 changes['userGroups/npReady/npLegacyProposal']=true;
 for(const uid of ['npReady','npOther','npPending','npDeferred'])Object.assign(changes,term(uid));
 changes['agreements/2027/npOrphan']=metadata('npOrphan');
 changes['agreementFiles/2027/npFile']=document();
 Object.assign(changes,term('npMismatch'),term('npWrongYear',2026));
 changes['agreementFiles/2027/npMismatch'].uploadedAt=stamp-1;
 changes['invitations/npMemberInvite']={groupId:'npReadyGroup',groupName:'Grupo npReady',toEmail:'npmissing@example.com',toUid:'',type:'member',senderId:'npCoord',senderName:'npCoord',status:'pending',createdAt:stamp};
 changes['invitations/npLegacyAdvisorInvite']={groupId:'npLegacyProposal',groupName:'Grupo legado',toEmail:'',toUid:'npAdvisor3',type:'advisor',senderId:'npCoord',senderName:'npCoord',status:'pending',createdAt:stamp};
 await admin(database=>update(ref(database,root),changes));

 const missing=loadService(db('npMissing'),'npMissing');
 const ready=loadService(db('npReady'),'npReady');
 const coordinator=loadService(db('npCoord'),'npCoord');
 const teacher1=loadService(db('npAdvisor1'),'npAdvisor1');
 const teacher2=loadService(db('npAdvisor2'),'npAdvisor2');

 for(const [uid,mode] of [['npSessionLogout','logout'],['npSessionUnsub','unsubscribe']]){
  const authState={currentUser:{uid,email:`${uid.toLowerCase()}@example.com`,displayName:uid,emailVerified:true,providerData:[]}};
  let authListener,releaseRead,reachedRead,paused=false;
  const readGate=new Promise(resolve=>{releaseRead=resolve;});
  const readReached=new Promise(resolve=>{reachedRead=resolve;});
  const session=loadService(db(uid),uid,{authOverrides:{
   getAuth:()=>authState,
   onAuthStateChanged:(_,callback)=>{authListener=callback;return()=>{};},
   get:async target=>{
    if(!paused&&target.toString().split('?')[0].endsWith(`/users/${uid}`)){paused=true;reachedRead();await readGate;}
    return get(target);
   }
  }});
  const observed=[];
  const stop=session('onSession',user=>observed.push(user?.uid||null));
  const pendingSession=authListener(authState.currentUser);
  await readReached;
  if(mode==='logout'){authState.currentUser=null;await authListener(null);}else stop();
  releaseRead();
  await pendingSession;
  assert.deepEqual(observed,mode==='logout'?[null]:[]);
  stop();
  count(`session: delayed profile initialization cannot emit old user after ${mode}`);
 }

 await no('mandatory term: raw new student group is denied before upload',set(ref(db('npMissing'),`${root}/groups/npMissingRaw`),proposal('npMissing')));
 await no('mandatory term: raw topic edits are denied before upload',update(ref(db('npMissing'),`${root}/groups/npGate`),{topic:'Tentativa sem termo'}));
 await no('mandatory term: raw student message is denied before upload',set(ref(db('npMissing'),`${root}/messages/npGate/npBlocked`),{text:'Sem termo',senderId:'npMissing',senderName:'npMissing',createdAt:stamp}));
 await no('mandatory term: raw task completion is denied before upload',update(ref(db('npMissing'),`${root}/tasks/npGate/artigo`),{completed:true,completedBy:'npMissing'}));
 await no('mandatory term: raw member invitation is denied before upload',set(ref(db('npMissing'),`${root}/invitations/npNoTermInvite`),{groupId:'npGate',groupName:'Grupo npMissing',toEmail:'npOther@example.com',toUid:'',type:'member',senderId:'npMissing',senderName:'npMissing',status:'pending',createdAt:serverTimestamp()}));
 await no('mandatory term: raw member admission is denied before upload',set(ref(db('npMissing'),`${root}/admissions/npReadyGroup/npMissing`),'npMemberInvite'));
 for(const [name,args] of [
  ['createGroup',[{name:'Sem termo',topic:'Pesquisa'}]],
  ['updateGroup',['npGate',{topic:'Sem termo'}]],
  ['createDefaultSchedule',['npGate',2027]],
  ['updateTask',['npGate','artigo',{completed:true}]],
  ['sendMessage',['npGate','Sem termo']],
  ['invite',[{groupId:'npGate',toEmail:'npOther@example.com',type:'member'}]],
  ['respondInvitation',['npMemberInvite',true]]
 ])await reject(`mandatory term: actual ${name} requires signed 2027 upload`,()=>missing(name,...args));
 await ok('mandatory term: own profile remains editable before upload',missing('saveProfile',{name:'npMissing',year:'3º ano'}));
 await ok('mandatory term: own agreement metadata stays readable before upload',get(ref(db('npMissing'),`${root}/agreements/2027/npMissing`)));
 const device='d'.repeat(64),pushSubscription={endpoint:'https://fcm.googleapis.com/fcm/send/mandatory-term-fixture',keys:{p256dh:'B'.repeat(87),auth:'C'.repeat(22)}};
 await ok('mandatory term: notification device can register before upload',missing('savePushSubscription',pushSubscription,device));
 const paths=[];
 const missingWatch=loadService(db('npMissing'),'npMissing',{onWatch:path=>paths.push(path)});
 await waitRequirement(missingWatch,state=>state.requirement?.ready===true&&state.requirement.fulfilled===false);
 assertion('mandatory term: absence reaches a ready but unfulfilled state without document bytes',paths.filter(path=>path.includes('/agreementFiles/')).length===3&&paths.filter(path=>path.includes('/agreementFiles/')).every(path=>/\/(size|contentType|uploadedAt)$/.test(path.split('?')[0])));

 for(const [uid,reason] of [['npOrphan','metadata without file'],['npFile','file without metadata'],['npMismatch','mismatched file version'],['npWrongYear','different edition']]){
  const service=loadService(db(uid),uid);
  await no(`mandatory term: server denies ${reason}`,set(ref(db(uid),`${root}/groups/${uid}Raw`),proposal(uid)));
  await reject(`mandatory term: actual service denies ${reason}`,()=>service('createGroup',{name:'Bloqueado',topic:'Pesquisa'}));
  await waitRequirement(service,state=>state.requirement?.ready===true&&state.requirement.fulfilled===false);
  count(`mandatory term: subscription never fulfills for ${reason}`);
 }
 await ok('mandatory term: requested teacher profile can be saved without gaining staff access',missing('saveProfile',{requestedRole:'advisor'}));
 await reject('mandatory term: self-requested teacher cannot bypass service gate',()=>missing('createGroup',{name:'Professor pendente',topic:'Pesquisa'}));
 await no('mandatory term: self-requested teacher cannot bypass server gate',set(ref(db('npMissing'),`${root}/messages/npGate/npPendingBypass`),{text:'Tentativa',senderId:'npMissing',senderName:'npMissing',createdAt:stamp}));
 const pendingTeacher=loadService(db('npPending'),'npPending');
 await reject('mandatory term: pending teacher with an old student term still awaits approval',()=>pendingTeacher('sendMessage','npPendingGroup','Sem aprovação'));
 await no('mandatory term: server blocks pending teacher even with complete term',set(ref(db('npPending'),`${root}/messages/npPendingGroup/npPendingBlocked`),{text:'Tentativa',senderId:'npPending',senderName:'npPending',createdAt:stamp}));
 await ok('mandatory term: approved advisor is exempt from student upload',teacher1('sendMessage','npGate','Orientação disponível'));
 await ok('mandatory term: coordinator is exempt from student upload',coordinator('sendMessage','npGate','Coordenação disponível'));
 await ok('mandatory term: student can restore own requested profile',missing('saveProfile',{requestedRole:'student'}));
 await ok('mandatory term: student uploads required pair while academic access is blocked',missing('uploadAgreement',bytesFile,{year:2027}));
 const fulfilled=await waitRequirement(missing,state=>state.requirement?.ready===true&&state.requirement.fulfilled===true);
 assertion('mandatory term: previously uploaded valid 2027 document fulfills gate',fulfilled.agreements.some(item=>item.id==='npMissing'));
 const downloaded=await coordinator('downloadAgreement','npMissing',2027);
 assertion('mandatory term: coordination can retrieve retained private uploaded document',downloaded.filename==='Termo assinado.pdf'&&Buffer.from(await downloaded.blob.arrayBuffer()).equals(pdf));
 await ok('mandatory term: successful upload unlocks student messages',missing('sendMessage','npGate','Termo enviado'));
 await ok('mandatory term: successful upload unlocks student progress',missing('updateTask','npGate','artigo',{completed:true}));
 await ok('mandatory term: successful upload unlocks accepted membership invitation',missing('respondInvitation','npMemberInvite',true));

 let releaseUpload,reachedUpload;
 const uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
 const uploadReached=new Promise(resolve=>{reachedUpload=resolve;});
 const deferred=loadService(db('npDeferred'),'npDeferred',{beforeUpdate:async(_,patch)=>{
  if(patch['agreements/2027/npDeferred']){reachedUpload();await uploadGate;}
 }});
 const pendingStates=[];
 const stopPending=deferred('subscribeAgreements',2027,state=>pendingStates.push(state.requirement));
 await waitRequirement(deferred,state=>state.requirement?.fulfilled===true);
 const pendingUpload=deferred('uploadAgreement',bytesFile,{year:2027});
 await uploadReached;
 assertion('mandatory term: replacing a valid term closes gate while upload awaits server',pendingStates.at(-1)?.ready===false&&pendingStates.at(-1)?.fulfilled===false);
 await reject('mandatory term: actual academic methods cannot use optimistic pending upload',()=>deferred('createGroup',{name:'Aguardar envio',topic:'Pesquisa'}));
 releaseUpload();
 await ok('mandatory term: deferred replacement completes only after server acknowledgement',pendingUpload);
 await waitRequirement(deferred,state=>state.requirement?.fulfilled===true);
 stopPending();
 count('mandatory term: acknowledged replacement restores fulfilled subscription');

 let releaseRejected,reachedRejected;
 const rejectedGate=new Promise(resolve=>{releaseRejected=resolve;});
 const rejectedReached=new Promise(resolve=>{reachedRejected=resolve;});
 const rejected=loadService(db('npRejected'),'npRejected',{beforeUpdate:async(_,patch)=>{
  if(patch['agreements/2027/npRejected']){reachedRejected();await rejectedGate;}
 }});
 const rejectedStates=[];
 const stopRejected=rejected('subscribeAgreements',2027,state=>rejectedStates.push({fulfilled:state.requirement.fulfilled,hasMetadata:state.agreements.some(item=>item.id==='npRejected')}));
 await waitRequirement(rejected,state=>state.requirement?.ready===true);
 const rejectedUpload=rejected('uploadAgreement',bytesFile,{year:2027});
 const failedUpload=reject('mandatory term: server-rejected upload reports failure',()=>rejectedUpload);
 await rejectedReached;
 // Revoke this synthetic student's completed profile after upload preflight.
 // The SDK will emit its actual optimistic local term before rules reject it.
 await admin(database=>set(ref(database,`${root}/users/npRejected/onboardingRequired`),true));
 releaseRejected();
 await failedUpload;
 await waitRequirement(rejected,state=>state.requirement?.ready===true&&!state.requirement.fulfilled);
 stopRejected();
 assertion('mandatory term: real optimistic rejected metadata never fulfills acceptance gate',rejectedStates.some(state=>state.hasMetadata)&&rejectedStates.every(state=>state.fulfilled===false));
 assertion('mandatory term: rejected upload leaves no retained metadata or file',!(await value('agreements/2027/npRejected'))&&!(await value('agreementFiles/2027/npRejected')));

 for(const [name,advisorIds] of [['four selected advisors',['npAdvisor1','npAdvisor2','npAdvisor3','npAdvisor4']],['duplicate selected advisor',['npAdvisor1','npAdvisor1']],['unapproved selected advisor',['npOther']]])
  await reject(`proposal: actual creation rejects ${name}`,()=>ready('createGroup',{name:'Proposta inválida',topic:'Pesquisa',proposal:textProposal,advisorIds}));
 const proposalId=await ready('createGroup',{name:'Proposta de três orientadores',topic:'Pesquisa de TCC',proposal:textProposal,advisorIds:['npAdvisor1','npAdvisor2','npAdvisor3']});
 let slots=await value(`advisorRequests/${proposalId}`);
 assertion('proposal: actual creation reserves exactly three unique approved candidates',slots&&Object.keys(slots).sort().join(',')==='npAdvisor1,npAdvisor2,npAdvisor3'&&new Set(Object.values(slots)).size===3);
 const invitations=(await get(query(ref(db('npCoord'),`${root}/invitations`),orderByChild('groupId'),equalTo(proposalId)))).val()||{};
 assertion('proposal: all three candidates receive pending invitations bound to server slots',Object.entries(slots).every(([uid,id])=>invitations[id]?.toUid===uid&&invitations[id]?.type==='advisor'&&invitations[id]?.status==='pending'&&invitations[id]?.senderId==='npReady'));
 const fourthId='npFourthAdvisor';
 const requestVersion=await value(`groups/${proposalId}/advisorRequestVersion`);
 const fixedSlots=await value(`advisorRequestSlots/${proposalId}`);
 assertion('proposal: authoritative quota has exactly three distinct fixed positions',fixedSlots&&Object.keys(fixedSlots).sort().join(',')==='0,1,2'&&new Set(Object.values(fixedSlots)).size===3&&Object.values(fixedSlots).every(uid=>Object.hasOwn(slots,uid)));
 await no('proposal: server rejects atomic fourth candidate even using direct SDK',update(ref(db('npReady'),root),{[`advisorRequests/${proposalId}/npAdvisor4`]:fourthId,[`advisorRequestSlots/${proposalId}/3`]:'npAdvisor4',[`groups/${proposalId}/advisorRequestVersion`]:requestVersion+1,[`invitations/${fourthId}`]:invitation(proposalId,'npAdvisor4')}));
 const firstSlot=Object.keys(fixedSlots).find(slot=>fixedSlots[slot]==='npAdvisor1');
 await no('proposal: server rejects replacement of a pending advisor slot',update(ref(db('npReady'),root),{[`advisorRequests/${proposalId}/npAdvisor1`]:'npDuplicateAdvisor',[`advisorRequestSlots/${proposalId}/${firstSlot}`]:'npAdvisor1',[`groups/${proposalId}/advisorRequestVersion`]:requestVersion+1,[`invitations/npDuplicateAdvisor`]:invitation(proposalId,'npAdvisor1')}));
 await reject('proposal: actual invitation cannot exceed three pending candidate choices',()=>ready('invite',{groupId:proposalId,toUid:'npAdvisor4',type:'advisor'}));
 const firstDeclined=slots.npAdvisor3;
 await ok('proposal: candidate may decline without consuming a permanent quota',loadService(db('npAdvisor3'),'npAdvisor3')('respondInvitation',firstDeclined,false));
 const replacement=await ready('invite',{groupId:proposalId,toUid:'npAdvisor4',type:'advisor'});
 slots=await value(`advisorRequests/${proposalId}`);
 assertion('proposal: declined choice can be replaced while keeping three pending candidates',slots&&Object.keys(slots).length===3&&slots.npAdvisor4===replacement&&!slots.npAdvisor3&&(await value(`invitations/${firstDeclined}/status`))==='declined');
 await ok('proposal: selected advisor prepares admission before atomic confirmation',set(ref(db('npAdvisor1'),`${root}/admissions/${proposalId}/npAdvisor1`),slots.npAdvisor1));
 await no('proposal: raw acceptance cannot omit cancellation of other pending candidates',update(ref(db('npAdvisor1'),root),{[`groups/${proposalId}/advisorId`]:'npAdvisor1',[`invitations/${slots.npAdvisor1}/status`]:'accepted',[`advisorConfirmations/${proposalId}`]:{studentUid:'npReady',advisorUid:'npAdvisor1',advisorName:'npAdvisor1',invitationId:slots.npAdvisor1,createdAt:serverTimestamp(),requestVersion:await value(`groups/${proposalId}/advisorRequestVersion`)}}));
 const emptyId=await ready('createGroup',{name:'Proposta sem candidato',topic:'Pesquisa de TCC',proposal:textProposal,advisorIds:[]});
 await no('proposal: standalone raw advisor invitation cannot bypass reserved slots',set(ref(db('npReady'),`${root}/invitations/npNoSlot`),invitation(emptyId,'npAdvisor1')));
 await no('proposal: new student advisor invitation on a legacy group still needs slots',set(ref(db('npReady'),`${root}/invitations/npLegacyNoSlot`),invitation('npLegacyProposal','npAdvisor4')));
 await no('proposal: new coordinator advisor invitation on a legacy group also needs slots',set(ref(db('npCoord'),`${root}/invitations/npLegacyStaffNoSlot`),{...invitation('npLegacyProposal','npAdvisor4'),senderId:'npCoord',senderName:'npCoord'}));
 await ok('proposal: actual advisor can accept an existing unassigned legacy invitation',loadService(db('npAdvisor3'),'npAdvisor3')('respondInvitation','npLegacyAdvisorInvite',true));
 assertion('proposal: legacy invitation acceptance retains first confirmed advisor and acknowledgement',(await value('groups/npLegacyProposal/advisorId'))==='npAdvisor3'&&(await value('advisorConfirmations/npLegacyProposal/advisorUid'))==='npAdvisor3');
 await admin(database=>update(ref(database,root),{'invitations/npLegacyLate':{...invitation('npLegacyProposal','npAdvisor4'),senderId:'npCoord',senderName:'npCoord',createdAt:stamp},'admissions/npLegacyProposal/npAdvisor4':'npLegacyLate'}));
 await no('proposal: an old legacy advisor invitation cannot replace a confirmed advisor',update(ref(db('npAdvisor4'),root),{'groups/npLegacyProposal/advisorId':'npAdvisor4','invitations/npLegacyLate/status':'accepted','advisorConfirmations/npLegacyProposal':{studentUid:'npReady',advisorUid:'npAdvisor4',advisorName:'npAdvisor4',invitationId:'npLegacyLate',createdAt:serverTimestamp(),requestVersion:0}}));
 await no('proposal: server rejects atomic request to an unapproved candidate',update(ref(db('npReady'),root),{[`advisorRequests/${emptyId}/npOther`]:'npUnapproved',[`advisorRequestSlots/${emptyId}/0`]:'npOther',[`groups/${emptyId}/advisorRequestVersion`]:(await value(`groups/${emptyId}/advisorRequestVersion`))+1,[`invitations/npUnapproved`]:invitation(emptyId,'npOther')}));
 await no('proposal: student cannot reserve advisors for another students group',update(ref(db('npReady'),root),{'advisorRequests/npForeignGroup/npAdvisor3':'npForeignRequest','invitations/npForeignRequest':invitation('npForeignGroup','npAdvisor3')}));

 const race=await Promise.allSettled([teacher1('respondInvitation',slots.npAdvisor1,true),teacher2('respondInvitation',slots.npAdvisor2,true)]);
 const acceptedGroup=await value(`groups/${proposalId}`);
 const confirmation=await value(`advisorConfirmations/${proposalId}`);
 const finalInvites=await value('invitations');
 const winner=acceptedGroup.advisorId;
 assertion('proposal: concurrent advisor acceptance permits exactly one winning transaction',race.filter(result=>result.status==='fulfilled').length===1&&['npAdvisor1','npAdvisor2'].includes(winner));
 assertion('proposal: only winning invitation is accepted and other pending choices cancel silently',Object.entries(slots).every(([uid,id])=>finalInvites[id].status===(uid===winner?'accepted':'cancelled')));
 assertion('proposal: acceptance creates one durable student acknowledgement with winning identity',confirmation?.studentUid==='npReady'&&confirmation.advisorUid===winner&&confirmation.advisorName===winner&&confirmation.invitationId===slots[winner]&&typeof confirmation.createdAt==='number');
 await ok('proposal: student reads own acceptance acknowledgement',get(ref(db('npReady'),`${root}/advisorConfirmations/${proposalId}`)));
 await ok('proposal: assigned advisor reads own acceptance acknowledgement',get(ref(db(winner),`${root}/advisorConfirmations/${proposalId}`)));
 await ok('proposal: coordinator can list acceptance acknowledgements',get(ref(db('npCoord'),`${root}/advisorConfirmations`)));
 await ok('proposal: limited notification worker can read accepted-only channel',get(ref(db('npWorker'),`${root}/advisorConfirmations`)));
 await no('proposal: another student cannot read private acceptance acknowledgement',get(ref(db('npOther'),`${root}/advisorConfirmations/${proposalId}`)));
 await no('proposal: worker cannot forge acceptance acknowledgement',set(ref(db('npWorker'),`${root}/advisorConfirmations/npForged`),confirmation));
 await no('proposal: student cannot rewrite accepted advisor acknowledgement',update(ref(db('npReady'),`${root}/advisorConfirmations/${proposalId}`),{advisorUid:'npAdvisor4'}));
 const losingUid=winner==='npAdvisor1'?'npAdvisor2':'npAdvisor1';
 const losingService=losingUid==='npAdvisor1'?teacher1:teacher2;
 await reject('proposal: later advisor acceptance cannot replace the confirmed advisor',()=>losingService('respondInvitation',slots[losingUid],true));
 await reject('proposal: repeated winning acceptance does not create another acknowledgement',()=>(winner==='npAdvisor1'?teacher1:teacher2)('respondInvitation',slots[winner],true));
 assert.deepEqual(await value(`advisorConfirmations/${proposalId}`),confirmation);
 count('proposal: acceptance acknowledgement is stable across repeated and late responses');

 const versionedId=await ready('createGroup',{name:'Proposta concorrente',topic:'Pesquisa de TCC',proposal:textProposal,advisorIds:['npAdvisor1']});
 const versionedSlots=await value(`advisorRequests/${versionedId}`);
 let releaseAcceptance,reachedAcceptance,pausedAcceptance=false;
 const acceptanceGate=new Promise(resolve=>{releaseAcceptance=resolve;});
 const acceptanceReached=new Promise(resolve=>{reachedAcceptance=resolve;});
 const pausedTeacher=loadService(db('npAdvisor1'),'npAdvisor1',{beforeUpdate:async(_,patch)=>{
  if(!pausedAcceptance&&patch[`advisorConfirmations/${versionedId}`]){pausedAcceptance=true;reachedAcceptance();await acceptanceGate;}
 }});
 const staleAcceptance=pausedTeacher('respondInvitation',versionedSlots.npAdvisor1,true);
 const staleRejected=reject('proposal: stale acceptance is rejected after concurrent candidate reservation',()=>staleAcceptance);
 await acceptanceReached;
 const addedDuringAcceptance=await ready('invite',{groupId:versionedId,toUid:'npAdvisor2',type:'advisor'});
 count('proposal: student can reserve another candidate before acceptance transaction commits');
 releaseAcceptance();
 await staleRejected;
 assertion('proposal: stale acknowledgement cannot leave a partially assigned advisor',!(await value(`advisorConfirmations/${versionedId}`))&&(await value(`groups/${versionedId}/advisorId`))===''&&(await value(`invitations/${versionedSlots.npAdvisor1}/status`))==='pending'&&(await value(`invitations/${addedDuringAcceptance}/status`))==='pending');
 await ok('proposal: advisor retries acceptance against fresh candidate version',pausedTeacher('respondInvitation',versionedSlots.npAdvisor1,true));
 assertion('proposal: fresh acceptance binds current version and cancels concurrent candidate',(await value(`advisorConfirmations/${versionedId}/requestVersion`))+1===(await value(`groups/${versionedId}/advisorRequestVersion`))&&(await value(`invitations/${addedDuringAcceptance}/status`))==='cancelled');

 const declinedId=await ready('createGroup',{name:'Proposta de recusa silenciosa',topic:'Pesquisa de TCC',proposal:textProposal,advisorIds:['npAdvisor2']});
 const declinedSlots=await value(`advisorRequests/${declinedId}`);
 await ok('proposal: advisor can decline a received proposal',teacher2('respondInvitation',declinedSlots.npAdvisor2,false));
 assertion('proposal: decline creates no student acknowledgement or assigned advisor',(await value(`invitations/${declinedSlots.npAdvisor2}/status`))==='declined'&&!(await value(`advisorConfirmations/${declinedId}`))&&(await value(`groups/${declinedId}/advisorId`))==='');
 const retryInvite=await ready('invite',{groupId:declinedId,toUid:'npAdvisor3',type:'advisor'});
 assertion('proposal: student can select a new candidate after a decline without losing invitation history',(await value(`advisorRequests/${declinedId}/npAdvisor3`))===retryInvite&&(await value(`invitations/${declinedSlots.npAdvisor2}/status`))==='declined');
 const lockedId=await ready('createGroup',{name:'Proposta bloqueada',topic:'Pesquisa de TCC',proposal:textProposal,advisorIds:['npAdvisor1']});
 await ok('proposal: coordinator locks proposal before deletion',coordinator('updateGroup',lockedId,{status:'deleting'}));
 await reject('proposal: actual advisor requests stop during deletion lock',()=>ready('invite',{groupId:lockedId,toUid:'npAdvisor2',type:'advisor'}));
 await no('proposal: server prevents raw request during deletion lock',update(ref(db('npReady'),root),{[`advisorRequests/${lockedId}/npAdvisor2`]:'npLockedRequest',[`advisorRequestSlots/${lockedId}/1`]:'npAdvisor2',[`groups/${lockedId}/advisorRequestVersion`]:(await value(`groups/${lockedId}/advisorRequestVersion`))+1,'invitations/npLockedRequest':invitation(lockedId,'npAdvisor2')}));
 await ok('proposal: coordinator deletes group and proposal resources atomically',coordinator('deleteGroup',proposalId));
 assertion('proposal: deletion removes advisor requests, fixed slots and acceptance channel',!(await value(`groups/${proposalId}`))&&!(await value(`advisorRequests/${proposalId}`))&&!(await value(`advisorRequestSlots/${proposalId}`))&&!(await value(`advisorConfirmations/${proposalId}`))&&!(await value(`userGroups/npReady/${proposalId}`)));
 const remainingInvites=await value('invitations');
 assertion('proposal: deletion removes all candidate history while preserving uploaded student term',[...Object.values(slots),firstDeclined].every(id=>!remainingInvites?.[id])&&Boolean(await value('agreements/2027/npReady'))&&Boolean(await value('agreementFiles/2027/npReady')));
}
