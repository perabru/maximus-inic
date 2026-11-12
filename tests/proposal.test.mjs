import {ref,set,get,update,serverTimestamp,push} from 'firebase/database';

// Private proposal ACL, CAS and canonical metadata/file pairs on synthetic accounts.
export async function runProposalTests({env,db,ok,no,count}) {
const stamp=Date.now(),person=uid=>({name:uid,email:uid+'@example.com',requestedRole:'student',year:'3º ano',createdAt:stamp});
const bytes=Buffer.from('%PDF-test proposal'),termMeta=uid=>({uid,year:2027,filename:'termo.pdf',ownerName:uid,size:bytes.length,contentType:'application/pdf',uploadedAt:stamp}),termFile={base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',uploadedAt:stamp};
const group=(uid,advisor='')=>({name:'Proposta de TCC',topic:'Pesquisa',description:'Descrição',year:2027,advisorId:advisor,members:{[uid]:true,prpeer:true},memberNames:{[uid]:uid,prpeer:'prpeer'},createdBy:uid,createdAt:stamp,status:'active',advisorRequestPolicy:'first-accept-v1',advisorRequestVersion:0,proposalRequired:true});
const seed={roles:{prc:'coordinator',pra1:'advisor',pra2:'advisor',prworker:'advisor'},users:Object.fromEntries(['prc','pra1','pra2','prs','prpeer','prout','prworker','prnew'].map(uid=>[uid,person(uid)])),groups:{prg:group('prs'),prg2:group('prout','pra2')},advisorDirectory:{pra1:{uid:'pra1',name:'pra1'},pra2:{uid:'pra2',name:'pra2'}},notificationWorkers:{prworker:true},agreements:{2027:Object.fromEntries(['prs','prpeer','prout','prnew'].map(uid=>[uid,termMeta(uid)]))},agreementFiles:{2027:Object.fromEntries(['prs','prpeer','prout','prnew'].map(uid=>[uid,termFile]))}};
const changes={};
function flatten(prefix,value){if(value!==null&&typeof value==='object')for(const [key,child]of Object.entries(value))flatten(prefix?`${prefix}/${key}`:key,child);else changes[prefix]=value;}
flatten('',seed);
await env.withSecurityRulesDisabled(async ctx=>update(ref(ctx.database(),'maximusInic'),changes));
const at=(uid,path)=>ref(db(uid),'maximusInic/'+path);
const text=(uid='prs',old='')=>({mode:'text',topics:{problem:'Problema de pesquisa',objective:'',method:'',expectedResult:''},version:push(at(uid,'proposalFiles')).key,previousVersion:old,updatedAt:serverTimestamp(),updatedByUid:uid,updatedByName:uid});
const file=(uid='prs',old='')=>({mode:'file',filename:'proposta.pdf',size:bytes.length,contentType:'application/pdf',version:push(at(uid,'proposalFiles')).key,previousVersion:old,updatedAt:serverTimestamp(),updatedByUid:uid,updatedByName:uid});
const fileChanges=m=>({'groups/prg/proposal':m,'proposalFiles/prg':{base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',version:m.version,uploadedAt:serverTimestamp()}});
 await no('student cannot invite advisor before proposal',update(at('prs',''),{['invitations/before']:{groupId:'prg',groupName:'Proposta de TCC',toEmail:'',toUid:'pra1',type:'advisor',senderId:'prs',senderName:'prs',status:'pending',createdAt:serverTimestamp()},['invitationIssuedAt/before']:serverTimestamp(),['advisorRequests/prg/pra1']:'before',['advisorRequestSlots/prg/0']:'pra1',['groups/prg/advisorRequestVersion']:1}));
 await no('student blank proposal denied',set(at('prs','groups/prg/proposal'),{...text(),topics:{problem:' ',objective:'\t',method:'\n',expectedResult:''}}));
 await no('oversize topic denied',set(at('prs','groups/prg/proposal'),{...text(),topics:{...text().topics,problem:'X'.repeat(2001)}}));
 await ok('member submits named text proposal',set(at('prs','groups/prg/proposal'),text()));
 const current=(await get(at('prs','groups/prg/proposal'))).val();
 await no('outsider cannot read proposal',get(at('prout','groups/prg/proposal')));
 await no('uninvited professor cannot read proposal',get(at('pra1','groups/prg/proposal')));
 await no('outsider cannot edit proposal',set(at('prout','groups/prg/proposal'),text('prout',current.version)));
 await no('member cannot forge proposal actor',set(at('prs','groups/prg/proposal'),text('prpeer',current.version)));
 await no('member stale proposal version denied',set(at('prs','groups/prg/proposal'),text('prs','stale-version')));
 await ok('peer member may update proposal',set(at('prpeer','groups/prg/proposal'),text('prpeer',current.version)));
 const peer=(await get(at('prs','groups/prg/proposal'))).val();
 await no('file payload without metadata denied',set(at('prs','proposalFiles/prg'),{base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',version:'-12345678901234567890',uploadedAt:serverTimestamp()}));
 await no('file metadata without payload denied',set(at('prs','groups/prg/proposal'),file('prs',peer.version)));
 const firstFile=file('prs',peer.version);
 await ok('file proposal stored atomically',update(at('prs',''),fileChanges(firstFile)));
 await ok('member reads own file',get(at('prpeer','proposalFiles/prg')));
 await no('outsider cannot read private file',get(at('prout','proposalFiles/prg')));
 await no('worker cannot read private proposal bytes',get(at('prworker','proposalFiles/prg')));
 await no('raw file overwrite without version change denied',set(at('prs','proposalFiles/prg'),{base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',version:firstFile.version,uploadedAt:serverTimestamp()}));
 await ok('coordinator reads private proposal',get(at('prc','proposalFiles/prg')));
 await ok('student may now invite advisor',update(at('prs',''),{['invitations/after']:{groupId:'prg',groupName:'Proposta de TCC',toEmail:'',toUid:'pra1',type:'advisor',senderId:'prs',senderName:'prs',status:'pending',createdAt:serverTimestamp()},['invitationIssuedAt/after']:serverTimestamp(),['advisorRequests/prg/pra1']:'after',['advisorRequestSlots/prg/0']:'pra1',['groups/prg/advisorRequestVersion']:1}));
 await ok('pending candidate reads proposal metadata',get(at('pra1','groups/prg/proposal')));
 await ok('pending candidate reads proposal private bytes',get(at('pra1','proposalFiles/prg')));
 await no('pending candidate cannot alter proposal',update(at('pra1',''),fileChanges(file('pra1',firstFile.version))));
 await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),'maximusInic/invitations/after/status'),'declined'));
 await no('declined candidate loses metadata read',get(at('pra1','groups/prg/proposal')));
 await no('declined candidate loses file read',get(at('pra1','proposalFiles/prg')));
 await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),'maximusInic/groups/prg/advisorId'),'pra1'));
 await ok('assigned professor reads file',get(at('pra1','proposalFiles/prg')));
 const updatedText=text('pra1',firstFile.version);
 await no('text replacement without byte cleanup denied',set(at('pra1','groups/prg/proposal'),updatedText));
 await ok('assigned professor replaces file with text atomically',update(at('pra1',''),{'groups/prg/proposal':updatedText,'proposalFiles/prg':null}));
 await no('text mode no file read remains',get(at('prs','proposalFiles/prg')));
 await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),'maximusInic/inactiveUsers/prs'),true));
 await no('archived student cannot read proposal',get(at('prs','groups/prg/proposal')));
 await no('archived student cannot edit proposal',set(at('prs','groups/prg/proposal'),text('prs',updatedText.version)));
 await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),'maximusInic/inactiveUsers/prs'),null));
 const atomicGroup={...group('prnew'),members:{prnew:true},memberNames:{prnew:'prnew'},advisorRequestVersion:1};
 await no('new student cannot create group without proposal flow marker',set(at('prnew','groups/prmissingMarker'),{...atomicGroup,proposalRequired:null}));
 const atomicFile=file('prnew');
 const atomicPayload={base64:bytes.toString('base64'),size:bytes.length,contentType:'application/pdf',version:atomicFile.version,uploadedAt:serverTimestamp()};
 await ok('new group file proposal and advisor invitation commit together',update(at('prnew',''),{
   'groups/pratomic':{...atomicGroup,proposal:atomicFile},'proposalFiles/pratomic':atomicPayload,'userGroups/prnew/pratomic':true,'peopleDirectory/prnew':{uid:'prnew',name:'prnew',year:'3º ano',role:'student',requestedRole:'student',listedAdvisor:false,groupId:'pratomic'},
   'invitations/pr-atomic-invite':{groupId:'pratomic',groupName:'Proposta de TCC',toEmail:'',toUid:'pra2',type:'advisor',senderId:'prnew',senderName:'prnew',status:'pending',createdAt:serverTimestamp()},
   'invitationIssuedAt/pr-atomic-invite':serverTimestamp(),'advisorRequests/pratomic/pra2':'pr-atomic-invite','advisorRequestSlots/pratomic/0':'pra2'
 }));
 await ok('newly invited candidate reads file committed with group',get(at('pra2','proposalFiles/pratomic')));

}
