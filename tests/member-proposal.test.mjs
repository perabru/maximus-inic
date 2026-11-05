import assert from 'node:assert/strict';
import {ref,get,update,query,orderByChild,equalTo} from 'firebase/database';
import {loadService} from './service-runtime.mjs';

// Real browser service, authenticated demo emulator clients, production forbidden
// by loadService. Creating a proposal must never enroll invited peers directly.
export async function runMemberProposalTests({env,db,ok,no,count}) {
 const root='maximusInic',stamp=Date.now();
 const pdf=Buffer.from('%PDF-1.7\nSynthetic term fixture\n%%EOF');
 const person=uid=>({name:uid,email:`${uid}@example.com`,requestedRole:'student',year:'2º ano',createdAt:stamp});
 const metadata=uid=>({uid,year:2027,filename:'termo.pdf',ownerName:uid,size:pdf.length,contentType:'application/pdf',uploadedAt:stamp});
 const file={base64:pdf.toString('base64'),size:pdf.length,contentType:'application/pdf',uploadedAt:stamp};
 const changes={};
 for(const uid of ['mpauthor','mppeer','mpstranger','mpmissing','mpteacher','mpcoord']){
  changes[`users/${uid}`]=person(uid);
  if(uid!=='mpmissing'){changes[`agreements/2027/${uid}`]=metadata(uid);changes[`agreementFiles/2027/${uid}`]=file;}
 }
 for(const uid of ['mpadvisor1','mpadvisor2','mpadvisor3']){
  changes[`users/${uid}`]={...person(uid),requestedRole:'advisor',year:''};
  changes[`roles/${uid}`]='advisor';changes[`advisorDirectory/${uid}`]={uid,name:uid};
 }
 changes['roles/mpteacher']='advisor';changes['roles/mpcoord']='coordinator';
 await env.withSecurityRulesDisabled(context=>update(ref(context.database(),root),changes));
 const value=async path=>{let result;await env.withSecurityRulesDisabled(async context=>{result=(await get(ref(context.database(),`${root}/${path}`))).val();});return result;};
 const check=(name,condition)=>{assert.ok(condition,name);count(name);};
 const rejects=async(name,fn)=>{let rejected=false;try{await fn();}catch{rejected=true;}check(name,rejected);};
 let authorUpdates=0,capturedChanges;
 const author=loadService(db('mpauthor'),'mpauthor',{beforeUpdate:async(target,patch)=>{authorUpdates++;capturedChanges=structuredClone(patch);}});
 const proposalId=await author('createGroup',{name:'Grupo com colegas',topic:'Pesquisa de TCC',advisorIds:['mpadvisor1','mpadvisor2','mpadvisor3'],memberEmails:[' MPPEER@example.com ','mppeer@example.com',' MPAUTHOR@example.com ','newstudent@example.com']});
 check('member proposal: one atomic update creates proposal schedule and every invitation',authorUpdates===1);
 const proposal=await value(`groups/${proposalId}`),tasks=await value(`tasks/${proposalId}`),all=await value('invitations');
 const invites=Object.entries(all).filter(([,invitation])=>invitation.groupId===proposalId).map(([id,invitation])=>({id,...invitation}));
 const memberInvites=invites.filter(invitation=>invitation.type==='member'),advisorInvites=invites.filter(invitation=>invitation.type==='advisor');
 check('member proposal: normalization deduplication and self exclusion leave exactly two peer invitations',memberInvites.length===2&&memberInvites.some(invitation=>invitation.toEmail==='mppeer@example.com')&&memberInvites.some(invitation=>invitation.toEmail==='newstudent@example.com'));
 check('member proposal: three advisors and eight schedule milestones commit with peer invitations',advisorInvites.length===3&&Object.keys(tasks).length===8);
 check('member proposal: peers are pending invitations and never automatic group members',Object.keys(proposal.members).length===1&&proposal.members.mpauthor===true&&!proposal.members.mppeer&&memberInvites.every(invitation=>invitation.status==='pending'&&invitation.toUid===''));
 check('member proposal: invited peer gets no private group index before accepting',!(await value(`userGroups/mppeer/${proposalId}`)));
 check('member proposal: unknown email does not create an account or grant a role',!(await value('users/newstudent'))&&!(await value('roles/newstudent')));
 check('member proposal: all invitation records preserve sender group and server timestamp',invites.every(invitation=>invitation.senderId==='mpauthor'&&invitation.groupName===proposal.name&&typeof invitation.createdAt==='number'&&invitation.createdAt>=stamp));
 check('member proposal: captured update contains group tasks private index and both invite types',Boolean(capturedChanges[`groups/${proposalId}`])&&capturedChanges[`userGroups/mpauthor/${proposalId}`]===true&&Object.keys(capturedChanges).filter(path=>path.startsWith(`tasks/${proposalId}/`)).length===8&&Object.keys(capturedChanges).filter(path=>path.startsWith('invitations/')).length===5);
 const peerInvite=memberInvites.find(invitation=>invitation.toEmail==='mppeer@example.com');
 await ok('member proposal: verified invited email can query its newly created invitation',get(query(ref(db('mppeer'),`${root}/invitations`),orderByChild('toEmail'),equalTo('mppeer@example.com'))));
 await no('member proposal: unverified invited email cannot read a known invitation',get(ref(db('mppeer',false),`${root}/invitations/${peerInvite.id}`)));
 await no('member proposal: unverified email cannot query its incoming invitations',get(query(ref(db('mppeer',false),`${root}/invitations`),orderByChild('toEmail'),equalTo('mppeer@example.com'))));
 await no('member proposal: another student cannot read an invitation addressed to a peer',get(ref(db('mpstranger'),`${root}/invitations/${peerInvite.id}`)));
 await no('member proposal: invited peer cannot read the group before acceptance',get(ref(db('mppeer'),`${root}/groups/${proposalId}`)));
 const peer=loadService(db('mppeer'),'mppeer');
 await ok('member proposal: verified peer with mandatory term accepts the invitation',peer('respondInvitation',peerInvite.id,true));
 check('member proposal: peer acceptance commits membership index and consumed invitation',(await value(`groups/${proposalId}/members/mppeer`))===true&&(await value(`userGroups/mppeer/${proposalId}`))===true&&(await value(`invitations/${peerInvite.id}/status`))==='accepted');
 check('member proposal: peer acceptance leaves all advisor requests pending',advisorInvites.length===3&&await Promise.all(advisorInvites.map(invitation=>value(`invitations/${invitation.id}/status`))).then(statuses=>statuses.every(status=>status==='pending'))&&(await value(`groups/${proposalId}/advisorId`))==='');
 await rejects('member proposal: consumed peer invitation cannot be accepted twice',()=>peer('respondInvitation',peerInvite.id,true));
 await ok('member proposal: matching verified email can find an invitation before account profile registration',get(query(ref(db('newstudent'),`${root}/invitations`),orderByChild('toEmail'),equalTo('newstudent@example.com'))));
 const futureInvite=memberInvites.find(invitation=>invitation.toEmail==='newstudent@example.com');
 const future=loadService(db('newstudent'),'newstudent');
 await rejects('member proposal: future student cannot accept until profile and term exist',()=>future('respondInvitation',futureInvite.id,true));
 await env.withSecurityRulesDisabled(context=>update(ref(context.database(),root),{'users/newstudent':person('newstudent'),'agreements/2027/newstudent':metadata('newstudent'),'agreementFiles/2027/newstudent':file}));
 await ok('member proposal: later registered student with term can accept the existing email invitation',future('respondInvitation',futureInvite.id,true));

 const normalizedLimit=Array.from({length:20},(_,index)=>`peer${index}@example.com`);
 const limitId=await author('createGroup',{name:'Vinte convites',topic:'Pesquisa de TCC',memberEmails:[...normalizedLimit,...normalizedLimit,'MPAUTHOR@example.com']});
 const twenty=Object.values(await value('invitations')).filter(invitation=>invitation.groupId===limitId&&invitation.type==='member');
 check('member proposal: twenty distinct peers are accepted after duplicates and own email are removed',twenty.length===20);
 let invalidWrites=0;
 const invalid=loadService(db('mpauthor'),'mpauthor',{beforeUpdate:async()=>{invalidWrites++;}});
 for(const [name,memberEmails] of [['non-array','mppeer@example.com'],['null',null],['object',{}],['number entry',[42]],['blank entry',['']],['malformed email',['invalid-address']],['whitespace inside email',['a b@example.com']],['excessive email length',[`${'a'.repeat(246)}@example.com`]],['more than twenty peers',[...normalizedLimit,'extra@example.com']]]){
  await rejects(`member proposal: rejects ${name} before writing`,()=>invalid('createGroup',{name:'Inválido',topic:'Pesquisa de TCC',memberEmails}));
 }
 check('member proposal: invalid peer input never reaches the database update',invalidWrites===0);
 const missing=loadService(db('mpmissing'),'mpmissing');
 await rejects('member proposal: peer invitation options cannot bypass mandatory term requirement',()=>missing('createGroup',{name:'Sem termo',topic:'Pesquisa',memberEmails:['mppeer@example.com']}));

 let failedGroupId,failedInviteIds=[];
 const rejectedBatch=loadService(db('mpauthor'),'mpauthor',{beforeUpdate:async(target,patch)=>{
  const groupPath=Object.keys(patch).find(path=>path.startsWith('groups/'));failedGroupId=groupPath.split('/')[1];
  const invitePath=Object.keys(patch).find(path=>path.startsWith('invitations/')&&patch[path].type==='member');
  failedInviteIds=Object.keys(patch).filter(path=>path.startsWith('invitations/')).map(path=>path.split('/')[1]);
  patch[invitePath].senderId='mpstranger';
 }});
 await rejects('member proposal: rejection of one peer invitation rejects the entire proposal batch',()=>rejectedBatch('createGroup',{name:'Deve falhar inteira',topic:'Pesquisa',advisorIds:['mpadvisor1'],memberEmails:['mppeer@example.com']}));
 check('member proposal: rejected batch leaves no partial group schedule or private index',!(await value(`groups/${failedGroupId}`))&&!(await value(`tasks/${failedGroupId}`))&&!(await value(`userGroups/mpauthor/${failedGroupId}`)));
 check('member proposal: rejected batch leaves no peer advisor or request-index residue',await Promise.all(failedInviteIds.map(id=>value(`invitations/${id}`))).then(values=>values.every(result=>result===null))&&!(await value(`advisorRequests/${failedGroupId}`))&&!(await value(`advisorRequestSlots/${failedGroupId}`)));
 const noPeersId=await author('createGroup',{name:'Sem colegas por enquanto',topic:'Pesquisa',memberEmails:[]});
 check('member proposal: optional empty list creates no unsolicited member invitation',!Object.values(await value('invitations')).some(invitation=>invitation.groupId===noPeersId&&invitation.type==='member'));
 const coord=loadService(db('mpcoord'),'mpcoord');
 const coordId=await coord('createGroup',{name:'Grupo da coordenação',topic:'Pesquisa',memberEmails:['mppeer@example.com']});
 check('member proposal: coordinator can atomically create group and invite a peer',Object.values(await value('invitations')).some(invitation=>invitation.groupId===coordId&&invitation.type==='member'&&invitation.toEmail==='mppeer@example.com'));
 const teacher=loadService(db('mpteacher'),'mpteacher');
 const teacherId=await teacher('createGroup',{name:'Grupo do professor',topic:'Pesquisa',memberEmails:['mppeer@example.com']});
 check('member proposal: approved teacher can atomically create self-advised group and peer invitation',(await value(`groups/${teacherId}/advisorId`))==='mpteacher'&&Object.values(await value('invitations')).some(invitation=>invitation.groupId===teacherId&&invitation.type==='member'&&invitation.toEmail==='mppeer@example.com'));
 for(const [label,mutate] of [
  ['foreign creator',group=>{group.createdBy='mpstranger';}],
  ['foreign advisor',group=>{group.advisorId='mpadvisor1';}],
  ['uninvited automatic membership',group=>{group.members.mppeer=true;group.memberNames.mppeer='mppeer';}]
 ]){
  let rejectedGroup;
  const forged=loadService(db('mpteacher'),'mpteacher',{beforeUpdate:async(target,patch)=>{const key=Object.keys(patch).find(path=>path.startsWith('groups/'));rejectedGroup=key.split('/')[1];mutate(patch[key]);}});
  await rejects(`member proposal: post-update advisor check cannot admit ${label}`,()=>forged('createGroup',{name:'Grupo forjado',topic:'Pesquisa',memberEmails:['mppeer@example.com']}));
  check(`member proposal: rejected ${label} leaves no group or invitation`,!(await value(`groups/${rejectedGroup}`))&&!Object.values(await value('invitations')).some(invitation=>invitation.groupId===rejectedGroup));
 }
}
