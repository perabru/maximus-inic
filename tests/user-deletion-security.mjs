import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {ref,get,set,update,serverTimestamp} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Synthetic identities and local demo data only. loadService additionally
// rejects any database outside localhost:9000 / demo-maximus-inic.
const env=await initializeTestEnvironment({projectId:'demo-maximus-inic',database:{host:'127.0.0.1',port:9000,rules:readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')}});
const root='maximusInic',stamp=Date.now(),year=2027;
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).database();
const at=(uid,path='')=>ref(db(uid),`${root}${path?'/'+path:''}`);
const admin=operation=>env.withSecurityRulesDisabled(ctx=>operation(ctx.database()));
const value=async path=>{let result;await admin(async database=>{result=(await get(ref(database,`${root}/${path}`))).val();});return result;};
let count=0;
const pass=name=>{count++;console.log('PASS',name);};
const check=(name,test)=>{assert.ok(test,name);pass(name);};
const ok=async(name,promise)=>{const result=await assertSucceeds(promise);pass(name);return result;};
const no=async(name,promise)=>{await assertFails(promise);pass(name);};
const rejects=async(name,promise)=>{await assert.rejects(promise);pass(name);};
const bytes=Buffer.from('%PDF-1.7\nSynthetic deletion fixture\n%%EOF');
const people=['delcoord','delcoord2','dels','delpeer','delteacher','delteacher2','delworker','delretry','delarchived','delarchiving','dellast','delorphan'];
const person=uid=>({name:uid,email:`${uid}@example.com`,requestedRole:['delteacher','delteacher2'].includes(uid)?'advisor':'student',year:'3º ano',createdAt:stamp});
const group=(name,members,advisorId='delteacher')=>({name,topic:'Pesquisa sintética',description:'',year,schoolYear:'3º ano',advisorId,members:Object.fromEntries(members.map(uid=>[uid,true])),memberNames:Object.fromEntries(members.map(uid=>[uid,uid])),createdBy:members[0],createdAt:stamp,status:'active',advisorRequestPolicy:'first-accept-v1',advisorRequestVersion:1});
const invitation=(groupId,senderId,toEmail='',toUid='',status='pending')=>({groupId,groupName:groupId,toEmail,toUid,type:toUid?'advisor':'member',senderId,senderName:senderId,status,createdAt:stamp-5000});
const term=(uid,edition=year)=>({uid,year:edition,filename:'termo.pdf',ownerName:uid,size:bytes.length,contentType:'application/pdf',uploadedAt:stamp});
const file={base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',uploadedAt:stamp};
const archived=(uid,status)=>({uid,role:'student',status,archivedAt:stamp-4000,archivedBy:'delcoord2',archivedByName:'Coordenação antiga',inviteCutoff:stamp-4000});
const changes={};
for(const uid of people)changes[`users/${uid}`]=person(uid);
for(const uid of ['delcoord','delcoord2'])changes[`roles/${uid}`]='coordinator';
for(const uid of ['delteacher','delteacher2']){changes[`roles/${uid}`]='advisor';changes[`advisorDirectory/${uid}`]={uid,name:uid};}
changes['notificationWorkers/delworker']=true;
for(const uid of ['dels','delpeer','delretry','delarchived','delarchiving','dellast']){changes[`agreements/${year}/${uid}`]=term(uid);changes[`agreementFiles/${year}/${uid}`]=file;}
changes['agreementFiles/2100/delorphan']=file;
changes['agreementReviews/2099/delorphan']={status:'approved',reviewerUid:'delcoord',reviewerName:'delcoord',reviewedAt:stamp,uploadedAt:stamp,uploadVersion:'',previousReviewedAt:0,reason:''};
changes['groups/delshared']=group('Grupo compartilhado',['dels','delpeer']);
changes['groups/dellastgroup']=group('Último integrante',['dellast'],'delteacher2');
changes['groups/delrequestgroup']=group('Solicitações de orientação',['dels','delpeer'],'');
changes['groups/delteachergroup']=group('Grupo do professor',['delteacher','delpeer']);
changes['groups/delarchivedgroup']={...group('Pesquisa arquivada',['delpeer']),status:'archived'};
changes['groups/delretrygroup']=group('Grupo com interrupção',['delretry','delpeer']);
changes['groups/dellegacygroup']=group('Cadastro antigo com vínculo remanescente',['delarchived','delpeer']);
changes['groups/delaliasgroup']={...group('Índice de nome antigo',['delpeer']),memberNames:{delpeer:'delpeer',dels:'Apelido antigo'}};
for(const [gid,members]of Object.entries({delshared:['dels','delpeer'],dellastgroup:['dellast'],delrequestgroup:['dels','delpeer'],delteachergroup:['delteacher','delpeer'],delretrygroup:['delretry','delpeer'],dellegacygroup:['delarchived','delpeer']}))for(const uid of members)changes[`userGroups/${uid}/${gid}`]=true;
changes['userGroups/delorphan/missinggroup']=true;
changes['invitations/delreceived']=invitation('delshared','delpeer','dels@example.com');
changes['invitations/deloldemail']=invitation('delshared','delcoord','dels@example.com','','declined');
changes['invitations/delsent']=invitation('delshared','dels','delpeer@example.com','','accepted');
changes['invitations/delrequest']=invitation('delrequestgroup','dels','','delteacher2');
changes['invitations/delkeeprequest']=invitation('delrequestgroup','delpeer','','delteacher');
changes['invitations/delkeep']=invitation('delshared','delpeer','unrelated@example.com');
for(const id of ['delreceived','deloldemail','delsent','delrequest','delkeeprequest','delkeep'])changes[`invitationIssuedAt/${id}`]=stamp-5000;
changes['advisorRequests/delrequestgroup']={delteacher2:'delrequest',delteacher:'delkeeprequest'};
changes['advisorRequestSlots/delrequestgroup']={0:'delteacher2',1:'delteacher'};
changes['advisorConfirmations/delshared']={studentUid:'dels',advisorUid:'delteacher',advisorName:'delteacher',invitationId:'oldreceipt',createdAt:stamp,requestVersion:1};
changes['admissions/delshared']={dels:'delreceived',delpeer:'delsent'};
changes['admissions/missinggroup']={delorphan:'missinginvite'};
changes['memberRevocations/missinggroup']={delorphan:stamp,delpeer:stamp};
changes['evaluations/delshared/group']={score:8,feedback:'Coletivo preservado',updatedBy:'delteacher',updatedAt:stamp,evaluatorName:'delteacher'};
changes['evaluations/delshared/members/dels']={score:7,feedback:'Individual',updatedBy:'delteacher',updatedAt:stamp,evaluatorName:'delteacher'};
changes['evaluations/delshared/members/delpeer']={score:9,feedback:'Colega preservado',updatedBy:'delteacher',updatedAt:stamp,evaluatorName:'delteacher'};
changes['evaluations/missinggroup/members/delorphan']={score:6,feedback:'Órfão',updatedBy:'delteacher',updatedAt:stamp,evaluatorName:'delteacher'};
const result=(uid,gid,edition=year)=>({year:edition,groupId:gid,studentUid:uid,status:'approved',correction:'',updatedByUid:'delteacher',updatedByName:'delteacher',updatedByRole:'advisor',updatedAt:stamp,previousUpdatedAt:0});
changes[`inicResults/${year}/delshared/dels`]=result('dels','delshared');changes[`inicResults/${year}/delshared/delpeer`]=result('delpeer','delshared');changes['inicResults/2028/missinggroup/delorphan']=result('delorphan','missinggroup',2028);
changes[`agreementReviews/${year}/dels`]={status:'approved',reason:'',reviewerUid:'delcoord',reviewerName:'delcoord',reviewedAt:stamp,uploadedAt:stamp,uploadVersion:'',previousReviewedAt:0};
const signature={role:'advisor',signerUid:'delteacher',signerName:'delteacher',signedAt:stamp,uploadVersion:'',uploadedAt:stamp,reviewedAt:stamp,documentSha256:'a'.repeat(64),signaturePng:'',consent:true,groupId:'delshared'};
changes[`agreementSignatures/${year}/dels/advisor/delteacher`]=signature;changes[`agreementSignatures/${year}/delpeer/advisor/delteacher`]=signature;
changes[`agreementAdvisorAccess/${year}/dels/delteacher`]='delshared';changes[`agreementAdvisorAccess/${year}/delpeer/delteacher`]='delshared';
changes['articles/delshared/introduction']={text:'Artigo dos colegas',revision:1,updatedBy:'dels',authorName:'dels',updatedAt:stamp};
changes['messages/delshared/history']={text:'Histórico compartilhado',senderId:'dels',senderName:'dels',createdAt:stamp};
changes['tasks/delshared/task']={title:'Artigo',dueDate:'2027-07-01',completed:false,completedBy:'',weight:1,createdBy:'dels',createdAt:stamp};
changes['pushSubscriptions/dels/device']={endpoint:'https://fcm.googleapis.com/fcm/send/deletion-fixture',keys:{p256dh:'synthetic',auth:'synthetic'},createdAt:stamp};
changes['orientationNotices/dels/notice']={type:'assigned',groupId:'delshared',groupName:'Grupo compartilhado',oldAdvisorName:'',newAdvisorName:'delteacher',reason:'',createdAt:stamp,transitionId:'notice',read:false};
for(const [uid,status]of [['delarchived','archived'],['delarchiving','archiving']]){changes[`inactiveUsers/${uid}`]=true;changes[`userArchives/${uid}`]=archived(uid,status);}
try{
  await env.clearDatabase();await admin(database=>update(ref(database,root),changes));
  const coordinator=loadService(db('delcoord'),'delcoord'),student=loadService(db('dels'),'dels'),teacher=loadService(db('delteacher'),'delteacher'),worker=loadService(db('delworker'),'delworker');
  for(const [name,service]of [['student',student],['advisor',teacher],['worker',worker]]){
    await rejects(`${name} cannot invoke permanent deletion`,service('deleteUserPermanently','delpeer'));
    await no(`${name} cannot directly delete a profile`,set(at(name==='student'?'dels':name==='advisor'?'delteacher':'delworker','users/delpeer'),null));
  }
  await no('coordination cannot delete an active profile without the deletion lock',set(at('delcoord','users/dels'),null));
  await rejects('coordination cannot delete itself',coordinator('deleteUserPermanently','delcoord'));
  await rejects('coordination cannot delete another coordinator',coordinator('deleteUserPermanently','delcoord2'));
  await no('raw operation cannot lock another coordinator',update(at('delcoord'),{'inactiveUsers/delcoord2':true,'userArchives/delcoord2':{...archived('delcoord2','deleting'),archivedAt:serverTimestamp(),archivedBy:'delcoord',archivedByName:'delcoord',inviteCutoff:serverTimestamp()}}));
  for(const resource of ['admissions','memberRevocations','evaluations','inicResults','advisorRequests','advisorRequestSlots','advisorConfirmations','agreementAdvisorAccess']){
    await no(`student cannot enumerate ${resource}`,get(at('dels',resource)));
    if(resource!=='advisorConfirmations')await no(`worker cannot enumerate ${resource}`,get(at('delworker',resource)));
  }
  await no('coordination cannot enumerate every signed PDF at once',get(at('delcoord','agreementFiles')));
  await ok('coordination permanently deletes student using the real service',coordinator('deleteUserPermanently','dels'));
  for(const path of ['users/dels','roles/dels','userArchives/dels','userGroups/dels','pushSubscriptions/dels','orientationNotices/dels','groups/delshared/members/dels','groups/delshared/memberNames/dels','groups/delaliasgroup/memberNames/dels','admissions/delshared/dels','admissions/delshared/delpeer','evaluations/delshared/members/dels',`inicResults/${year}/delshared/dels`,'advisorRequests/delrequestgroup/delteacher2','advisorRequestSlots/delrequestgroup/0','advisorConfirmations/delshared'])check(`deletion clears ${path}`,await value(path)===null);
  for(const resource of ['agreements','agreementFiles','agreementReviews','agreementSignatures','agreementAdvisorAccess'])check(`deletion clears the student's ${resource}`,await value(`${resource}/${year}/dels`)===null);
  for(const id of ['delreceived','deloldemail','delsent','delrequest'])check(`deletion removes invitation and timestamp ${id}`,await value(`invitations/${id}`)===null&&await value(`invitationIssuedAt/${id}`)===null);
  check('candidate sent by another student remains pending',await value('invitations/delkeeprequest/status')==='pending'&&await value('advisorRequests/delrequestgroup/delteacher')==='delkeeprequest'&&await value('advisorRequestSlots/delrequestgroup/1')==='delteacher');
  check('shared article, historical message and task remain',await value('articles/delshared/introduction/text')==='Artigo dos colegas'&&await value('messages/delshared/history/senderId')==='dels'&&await value('tasks/delshared/task/title')==='Artigo');
  check('peer membership, marks and INIC result remain',await value('groups/delshared/members/delpeer')===true&&await value('evaluations/delshared/members/delpeer/score')===9&&await value(`inicResults/${year}/delshared/delpeer/status`)==='approved');
  check('only a UID blocking marker remains for the deleted registration',await value('inactiveUsers/dels')===true&&await value('users/dels')===null&&await value('userArchives/dels')===null);
  await no('deleted auth identity cannot recreate its profile',set(at('dels','users/dels'),person('dels')));
  await no('deleted auth identity cannot drop its blocking marker',set(at('dels','inactiveUsers/dels'),null));
  await no('coordination cannot remove the marker as if restoring a deleted record',set(at('delcoord','inactiveUsers/dels'),null));
  await no('late staff removal cannot recreate a revocation for a deleted profile',set(at('delteacher','memberRevocations/delshared/dels'),serverTimestamp()));
  await rejects('deleted identity cannot ensure a replacement profile',student('ensureProfile',{uid:'dels',email:'dels@example.com',displayName:'dels',providerData:[]}));
  await rejects('deleted registration cannot be restored',coordinator('restoreUser','dels'));
  await ok('repeating a completed deletion succeeds idempotently',coordinator('deleteUserPermanently','dels'));
  let writes=0;const interrupted=loadService(db('delcoord'),'delcoord',{beforeUpdate:async()=>{if(++writes===2){
    await no('concurrent staff grade cannot target a student locked for deletion',set(at('delteacher','evaluations/delretrygroup/members/delretry'),{score:10,feedback:'Tentativa após bloqueio',updatedBy:'delteacher',updatedAt:serverTimestamp(),evaluatorName:'delteacher'}));
    throw new Error('synthetic interruption after blocking');
  }}});
  await rejects('interrupted deletion leaves a resumable lock',interrupted('deleteUserPermanently','delretry'));
  check('failed final write retains the profile, documents and visible deleting state',await value('users/delretry/name')==='delretry'&&await value('inactiveUsers/delretry')===true&&await value('userArchives/delretry/status')==='deleting'&&await value(`agreementFiles/${year}/delretry/base64`)===file.base64);
  await no('staff cannot add a new revocation while permanent deletion is pending',set(at('delteacher','memberRevocations/delshared/delretry'),serverTimestamp()));
  await rejects('partial deletion cannot be restored',coordinator('restoreUser','delretry'));
  await no('partial deletion cannot be changed back to archived',set(at('delcoord','userArchives/delretry/status'),'archived'));
  await ok('retry completes the existing deletion lock',coordinator('deleteUserPermanently','delretry'));
  for(const uid of ['delarchived','delarchiving','dellast','delorphan'])await ok(`service permanently deletes ${uid}`,coordinator('deleteUserPermanently',uid));
  check('last member deletion preserves the group for coordination',await value('groups/dellastgroup/name')==='Último integrante'&&await value('groups/dellastgroup/members/dellast')===null);
  for(const path of ['agreementFiles/2100/delorphan','agreementReviews/2099/delorphan','userGroups/delorphan','admissions/missinggroup/delorphan','memberRevocations/missinggroup/delorphan','evaluations/missinggroup/members/delorphan','inicResults/2028/missinggroup/delorphan'])check(`orphan cleanup removes ${path}`,await value(path)===null);
  const keptSignature=await value(`agreementSignatures/${year}/delpeer/advisor/delteacher`);
  await ok('service permanently deletes a professor and releases orientation',coordinator('deleteUserPermanently','delteacher'));
  check('professor credentials, directory and group role are removed',await value('roles/delteacher')===null&&await value('advisorDirectory/delteacher')===null&&await value('groups/delshared/advisorId')===''&&await value('groups/delteachergroup/members/delteacher')===null);
  check('professor is released from archived groups without deleting their research',await value('groups/delarchivedgroup/advisorId')===''&&await value('groups/delarchivedgroup/status')==='archived'&&await value('groups/delarchivedgroup/members/delpeer')===true);
  check('professor access proof to another student is removed',await value(`agreementAdvisorAccess/${year}/delpeer/delteacher`)===null);
  assert.deepEqual(await value(`agreementSignatures/${year}/delpeer/advisor/delteacher`),keptSignature);pass('signature on the colleague historical document remains intact');
  console.log(`\n${count} permanent deletion security checks passed.`);
}finally{await env.cleanup();}
